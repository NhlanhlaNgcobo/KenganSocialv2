import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import axios from 'axios';
import { FieldValue } from 'firebase-admin/firestore';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../utils/firestore';
import { withWorkspace } from '../middleware/withWorkspace';
import { checkLimit, planRateLimit } from '../middleware/planGate';
import { deleteFile, uploadFile } from '../services/storage.service.js';
import { PLAN_LIMITS } from '../utils/planLimits';
import { contrastRatio, extractBrandFromWebsite } from '../services/marketing/brand-extract.js';
import { aiConfigured, analyzeStyle, analyzeVoice, normalizeStyle, normalizeVoice, tagReference } from '../services/marketing/brand-ai.js';
import { buildBusinessProfile, normalizeBusiness, voiceSamplesFromSite } from '../services/marketing/business-profile.js';
import { sourceFromSite } from '../services/marketing/carousel-plan.js';
import { inChromeQueue } from '../services/marketing/chrome-queue.js';
import { fail, requireEditor, requireWorkspace, route } from '../services/marketing/http';
import carouselRoutes from './marketing-carousels';
import videoAdRoutes from './marketing-video-ads';

/**
 * Marketing tab, phase 1: brand kit, brand voice and the reference image library.
 *  GET    /api/marketing/brand                 brand kit + completeness
 *  PUT    /api/marketing/brand                 save edits (partial)
 *  POST   /api/marketing/brand/import          { url } → suggestions from a website (not saved)
 *  POST   /api/marketing/brand/logo            multipart "file" or { dataUrl }, ?variant=primary|onDark → saved
 *  DELETE /api/marketing/brand/logo/:variant
 *  POST   /api/marketing/brand/voice/analyze   { samples[] } → voice profile (not saved)
 *  GET    /api/marketing/references
 *  POST   /api/marketing/references            multipart "files" (up to 10 images)
 *  DELETE /api/marketing/references/:id
 *  POST   /api/marketing/references/style      learn a style profile from the folder → saved
 *  POST   /api/marketing/setup/website         { url } → background job: read site, business profile,
 *                                               fill brand kit + voice (like the launch-video inspector)
 *  GET    /api/marketing/jobs/:id              job progress/result
 *
 * Data: workspaces/{id}/brandKit/current and workspaces/{id}/brandReferences/{refId}.
 * Files: storage under workspaces/{id}/brand/…
 */

const router = express.Router();

const MAX_REFERENCES = 50;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const HEX = /^#[0-9a-f]{6}$/i;
const COLOR_ROLES = ['primary', 'secondary', 'accent', 'background', 'text'] as const;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 10 },
    fileFilter: (_req, file, cb) => cb(null, [...IMAGE_TYPES, 'image/svg+xml'].includes(file.mimetype)),
});

router.use(withWorkspace, requireWorkspace);
router.use('/carousels', carouselRoutes);
router.use('/video-ads', videoAdRoutes);

const kitRef = (req: Request) => db.collection('workspaces').doc((req as any).workspaceId).collection('brandKit').doc('current');
const refsCol = (req: Request) => db.collection('workspaces').doc((req as any).workspaceId).collection('brandReferences');
const brandPath = (req: Request, folder: string) => `workspaces/${(req as any).workspaceId}/brand/${folder}`;

const EMPTY_KIT = {
    name: '',
    tagline: '',
    website: '',
    logo: { primary: null as string | null, onDark: null as string | null },
    colors: { primary: null, secondary: null, accent: null, background: null, text: null, extra: [] as string[] },
    fonts: { heading: null, body: null },
    voice: null,
    style: null,
};

function completeness(kit: any) {
    const checks = [
        { id: 'name', label: 'Brand name', done: !!kit.name },
        { id: 'logo', label: 'Logo', done: !!kit.logo?.primary },
        { id: 'colors', label: 'Brand colours', done: !!kit.colors?.primary && !!kit.colors?.background },
        { id: 'fonts', label: 'Fonts', done: !!kit.fonts?.heading },
        { id: 'voice', label: 'Brand voice', done: !!kit.voice?.summary },
        { id: 'business', label: 'Business profile', done: !!(kit.business?.oneLiner || kit.business?.whatYouSell) },
        { id: 'references', label: '3+ reference images', done: (kit.referenceCount || 0) >= 3 },
        { id: 'style', label: 'Style profile', done: !!kit.style?.summary },
    ];
    return { score: Math.round((checks.filter((c) => c.done).length / checks.length) * 100), checks };
}

async function loadKit(req: Request) {
    const [snap, count] = await Promise.all([kitRef(req).get(), refsCol(req).count().get()]);
    const kit = { ...EMPTY_KIT, ...(snap.data() || {}), referenceCount: count.data().count };
    return { kit, completeness: completeness(kit) };
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const font = (v: unknown) => {
    const s = text(v, 60);
    return s === undefined ? undefined : s.replace(/[^\w\s\-.]/g, '') || null;
};

// ─── Brand kit ───────────────────────────────────────────────────────────────

router.get('/brand', route(async (req, res) => {
    res.json({ ...(await loadKit(req)), aiAvailable: aiConfigured() });
}));

router.put('/brand', requireEditor, route(async (req, res) => {
    const body = req.body || {};
    const updates: Record<string, unknown> = {};

    for (const key of ['name', 'tagline', 'website'] as const) {
        const v = text(body[key], key === 'tagline' ? 200 : 120);
        if (v !== undefined) updates[key] = v;
    }
    if (body.colors && typeof body.colors === 'object') {
        for (const role of COLOR_ROLES) {
            if (role in body.colors) {
                const v = body.colors[role];
                if (v !== null && !HEX.test(String(v))) throw fail(400, `"${role}" must be a colour like #1a2b3c.`);
                updates[`colors.${role}`] = v ? String(v).toLowerCase() : null;
            }
        }
        if (Array.isArray(body.colors.extra)) updates['colors.extra'] = body.colors.extra.filter((c: unknown) => HEX.test(String(c))).slice(0, 8);
    }
    if (body.fonts && typeof body.fonts === 'object') {
        for (const role of ['heading', 'body'] as const) {
            const v = font(body.fonts[role]);
            if (v !== undefined) updates[`fonts.${role}`] = v;
        }
    }
    if ('voice' in body) updates.voice = body.voice ? normalizeVoice(body.voice) : null;
    if ('business' in body) updates.business = body.business ? normalizeBusiness({ ...body.business, updatedAt: new Date().toISOString() }) : null;
    if ('style' in body) updates.style = body.style ? normalizeStyle(body.style) : null;
    if (!Object.keys(updates).length) throw fail(400, 'Nothing to save.');

    const ref = kitRef(req);
    // update() needs an existing doc; create it with the empty shape first.
    if (!(await ref.get()).exists) await ref.set({ ...EMPTY_KIT, createdAt: FieldValue.serverTimestamp() });
    await ref.update({ ...updates, updatedAt: FieldValue.serverTimestamp(), updatedBy: (req as any).uid });
    res.json(await loadKit(req));
}));

async function readWebsite(url: string) {
    try {
        return (await inChromeQueue(() => extractBrandFromWebsite(url))) as any;
    } catch (error: any) {
        if (/public|private|not allowed|invalid url|ENOTFOUND|resolve/i.test(error.message)) throw fail(400, 'That website could not be reached. Check the address.');
        throw fail(502, 'The website could not be read. It may block automated visits; you can fill the brand kit in by hand.');
    }
}

router.post('/brand/import', requireEditor, planRateLimit(), route(async (req, res) => {
    const url = text(req.body?.url, 500);
    if (!url) throw fail(400, 'Paste your website address.');
    const { copy, screenshots, ...suggestion } = await readWebsite(url);
    res.json({
        suggestion: {
            ...suggestion,
            contrast: suggestion.colors.text && suggestion.colors.background ? contrastRatio(suggestion.colors.text, suggestion.colors.background) : null,
        },
    });
}));

/** Stores a logo as PNG. SVGs are rasterised so no script-capable files are ever served. */
async function storeLogo(req: Request, buffer: Buffer, mime: string, variant: 'primary' | 'onDark') {
    if (buffer.length > 5 * 1024 * 1024) throw fail(400, 'Logos must be under 5 MB.');
    let png: Buffer;
    try {
        const input = sharp(buffer, { density: mime === 'image/svg+xml' ? 300 : undefined, animated: false });
        png = await input.rotate().resize(1200, 1200, { fit: 'inside', withoutEnlargement: mime !== 'image/svg+xml' }).png().toBuffer();
    } catch {
        throw fail(400, 'That file is not an image we can read.');
    }
    const url = await uploadFile(png, brandPath(req, 'logos'), 'image/png');
    const ref = kitRef(req);
    const before = (await ref.get()).data();
    if (!before) await ref.set({ ...EMPTY_KIT, createdAt: FieldValue.serverTimestamp() });
    await ref.update({ [`logo.${variant}`]: url, updatedAt: FieldValue.serverTimestamp(), updatedBy: (req as any).uid });
    const old = before?.logo?.[variant];
    if (old) deleteFile(old).catch(() => {});
    return url;
}

const dataUrlParts = (dataUrl: string) => {
    const m = String(dataUrl || '').match(/^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/i);
    return m ? { mime: m[1].toLowerCase(), buffer: Buffer.from(m[2], 'base64') } : null;
};

router.post('/brand/logo', requireEditor, upload.single('file'), route(async (req, res) => {
    const variant = req.query.variant === 'onDark' ? 'onDark' : 'primary';
    const file = req.file ? { buffer: req.file.buffer, mime: req.file.mimetype } : dataUrlParts(req.body?.dataUrl);
    if (!file) throw fail(400, 'Choose a PNG, JPG, WebP or SVG logo.');
    await storeLogo(req, file.buffer, file.mime, variant);
    res.json(await loadKit(req));
}));

router.delete('/brand/logo/:variant', requireEditor, route(async (req, res) => {
    const variant = req.params.variant === 'onDark' ? 'onDark' : 'primary';
    const ref = kitRef(req);
    const old = (await ref.get()).data()?.logo?.[variant];
    if (old) {
        await ref.update({ [`logo.${variant}`]: null, updatedAt: FieldValue.serverTimestamp() });
        deleteFile(old).catch(() => {});
    }
    res.json(await loadKit(req));
}));

router.post('/brand/voice/analyze', requireEditor, planRateLimit(), checkLimit('aiCalls'), route(async (req, res) => {
    if (!aiConfigured()) throw fail(503, 'AI is not set up on the server yet. Add OPENROUTER_API_KEY or GEMINI_API_KEY to server/.env.');
    const samples = (Array.isArray(req.body?.samples) ? req.body.samples : [])
        .map((s: unknown) => String(s || '').trim())
        .filter((s: string) => s.length >= 20)
        .slice(0, 10);
    if (samples.length < 2) throw fail(400, 'Add at least 2 samples (posts, captions or website copy), each a sentence or more.');
    const kit = (await kitRef(req).get()).data() || {};
    res.json({ voice: await analyzeVoice(samples, { brandName: kit.name }) });
}));

// ─── Reference library ──────────────────────────────────────────────────────

router.get('/references', route(async (req, res) => {
    const snap = await refsCol(req).orderBy('createdAt', 'desc').limit(MAX_REFERENCES).get();
    res.json({ references: snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.()?.toISOString?.() || null })), max: MAX_REFERENCES, aiAvailable: aiConfigured() });
}));

router.post('/references', requireEditor, upload.array('files', 10), route(async (req, res) => {
    const files = ((req.files as Express.Multer.File[]) || []).filter((f) => IMAGE_TYPES.includes(f.mimetype));
    if (!files.length) throw fail(400, 'Choose JPG, PNG, WebP or GIF images (up to 15 MB each).');
    const existing = (await refsCol(req).count().get()).data().count;
    if (existing + files.length > MAX_REFERENCES) throw fail(400, `The library holds up to ${MAX_REFERENCES} images. Remove some first (${existing} saved).`);

    const created: any[] = [];
    for (const file of files) {
        try {
            const image = sharp(file.buffer, { animated: false }).rotate();
            const meta = await image.metadata();
            const preview = await image.clone().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
            const thumb = await image.clone().resize(400, 400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
            const [url, previewUrl, thumbUrl] = await Promise.all([
                uploadFile(file.buffer, brandPath(req, 'references'), file.mimetype),
                uploadFile(preview, brandPath(req, 'references/preview'), 'image/jpeg'),
                uploadFile(thumb, brandPath(req, 'references/thumb'), 'image/jpeg'),
            ]);
            const ref = refsCol(req).doc(uuidv4());
            const doc = {
                url,
                previewUrl,
                thumbUrl,
                name: String(file.originalname || 'image').slice(0, 120),
                width: meta.width || null,
                height: meta.height || null,
                bytes: file.size,
                caption: '',
                tags: [] as string[],
                status: aiConfigured() ? 'tagging' : 'ready',
                uploadedBy: (req as any).uid,
                createdAt: FieldValue.serverTimestamp(),
            };
            await ref.set(doc);
            created.push({ id: ref.id, ...doc, createdAt: new Date().toISOString(), buffer: preview });
        } catch (error: any) {
            console.warn('[Marketing] Reference upload skipped:', file.originalname, error.message);
        }
    }
    if (!created.length) throw fail(400, 'None of those images could be read.');
    res.status(201).json({ references: created.map(({ buffer, ...rest }) => rest) });

    // AI captions and tags in the background; the library shows them when they arrive.
    if (aiConfigured()) {
        for (const c of created) {
            tagReference(c.buffer)
                .then((t) => refsCol(req).doc(c.id).update({ ...t, status: 'ready' }))
                .catch((error) => {
                    console.warn('[Marketing] Tagging failed:', error.message);
                    return refsCol(req).doc(c.id).update({ status: 'ready' }).catch(() => {});
                });
        }
    }
}));

router.delete('/references/:id', requireEditor, route(async (req, res) => {
    const ref = refsCol(req).doc(String(req.params.id));
    const snap = await ref.get();
    if (!snap.exists) throw fail(404, 'Image not found.');
    const data = snap.data() || {};
    await ref.delete();
    for (const url of [data.url, data.previewUrl, data.thumbUrl]) if (url) deleteFile(url).catch(() => {});
    res.json({ success: true });
}));

/** Learns the shared visual style of the reference folder and saves it on the brand kit. */
router.post('/references/style', requireEditor, planRateLimit(), checkLimit('aiCalls'), route(async (req, res) => {
    if (!aiConfigured()) throw fail(503, 'AI is not set up on the server yet. Add OPENROUTER_API_KEY or GEMINI_API_KEY to server/.env.');
    const snap = await refsCol(req).orderBy('createdAt', 'desc').limit(12).get();
    if (snap.size < 3) throw fail(400, 'Add at least 3 reference images first.');
    // Preview URLs are written only by this server (our storage), so fetching them back is safe.
    const buffers: Buffer[] = [];
    for (const d of snap.docs) {
        try {
            const { data } = await axios.get(d.data().previewUrl, { responseType: 'arraybuffer', timeout: 15000, maxContentLength: 5 * 1024 * 1024 });
            buffers.push(Buffer.from(data));
        } catch (error: any) {
            console.warn('[Marketing] Could not read reference', d.id, error.message);
        }
    }
    if (buffers.length < 3) throw fail(502, 'The reference images could not be read back from storage.');
    const style = await analyzeStyle(buffers);
    const ref = kitRef(req);
    if (!(await ref.get()).exists) await ref.set({ ...EMPTY_KIT, createdAt: FieldValue.serverTimestamp() });
    await ref.update({ style, updatedAt: FieldValue.serverTimestamp(), updatedBy: (req as any).uid });
    res.json(await loadKit(req));
}));

// ─── Set up from website (launch-video style: read → understand → apply) ─────

const jobsCol = (req: Request) => db.collection('workspaces').doc((req as any).workspaceId).collection('marketingJobs');
const aiAllowed = (plan: string) => aiConfigured() && ((PLAN_LIMITS as any)[plan]?.aiCalls ?? 0) !== 0;

router.post('/setup/website', requireEditor, planRateLimit(), route(async (req, res) => {
    const url = text(req.body?.url, 500);
    if (!url) throw fail(400, 'Paste your website address.');
    const job = jobsCol(req).doc(uuidv4());
    const stage = (stageName: string, progress: number, extra: Record<string, unknown> = {}) =>
        job.set({ stage: stageName, progress, ...extra, updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
    await job.set({ type: 'website-setup', url, status: 'running', stage: 'Reading your website', progress: 5, createdAt: FieldValue.serverTimestamp(), createdBy: (req as any).uid });
    res.status(202).json({ jobId: job.id });

    const plan = (req as any).plan;
    const notes: string[] = [];
    try {
        // 1. Read the site: copy, screenshots, logo, colours, fonts, socials.
        const site = await readWebsite(url);

        // 2. Understand the business and how it sounds.
        let business: any = null;
        let voice: any = null;
        if (aiAllowed(plan)) {
            await stage('Understanding your business', 45);
            try {
                business = await buildBusinessProfile(site);
            } catch (error: any) {
                console.warn('[Marketing] Business profile failed:', error.message);
                notes.push('The AI could not build a business profile this time.');
            }
            const samples = voiceSamplesFromSite(site);
            if (samples.length >= 2) {
                await stage('Learning how your brand sounds', 65);
                try {
                    voice = await analyzeVoice(samples, { brandName: site.name });
                } catch (error: any) {
                    console.warn('[Marketing] Voice from site failed:', error.message);
                }
            } else notes.push('Your site has too little written copy to learn a brand voice from; add sample posts in Brand voice.');
        } else {
            notes.push(aiConfigured() ? 'The business profile and brand voice use AI, which is on the Nano plan and up.' : 'AI is not set up on the server yet, so only the visual brand kit was filled in.');
        }

        // 3. Apply: fill what's empty, never overwrite the user's own edits.
        await stage('Saving your brand', 85);
        const ref = kitRef(req);
        const current: any = (await ref.get()).data() || { ...EMPTY_KIT };
        if (!(await ref.get()).exists) await ref.set({ ...EMPTY_KIT, createdAt: FieldValue.serverTimestamp() });
        const updates: Record<string, unknown> = {};
        const applied: string[] = [];
        const kept: string[] = [];
        const fill = (field: string, label: string, currentValue: unknown, value: unknown) => {
            if (value === null || value === undefined || value === '') return;
            if (currentValue) kept.push(label);
            else {
                updates[field] = value;
                applied.push(label);
            }
        };
        fill('name', 'Brand name', current.name, site.name);
        fill('tagline', 'Tagline', current.tagline, site.tagline);
        updates.website = site.url;
        for (const role of COLOR_ROLES) fill(`colors.${role}`, `${role[0].toUpperCase()}${role.slice(1)} colour`, current.colors?.[role], site.colors?.[role]);
        if (!current.colors?.extra?.length && site.colors?.extra?.length) updates['colors.extra'] = site.colors.extra;
        fill('fonts.heading', 'Heading font', current.fonts?.heading, site.fonts?.heading);
        fill('fonts.body', 'Body font', current.fonts?.body, site.fonts?.body);
        if (voice) fill('voice', 'Brand voice', current.voice?.summary, voice);
        // The business profile always refreshes from the latest read of the site.
        if (business) {
            updates.business = business;
            applied.push('Business profile');
        }
        // What carousels "from your website" are made from, so they don't re-read the site each time.
        updates.site = { url: site.url, readAt: new Date().toISOString(), source: sourceFromSite(site).slice(0, 12000), socials: site.socials || [] };
        await ref.update({ ...updates, updatedAt: FieldValue.serverTimestamp(), updatedBy: (req as any).uid });

        if (!current.logo?.primary && site.logos?.length) {
            const logo = dataUrlParts(site.logos[0].dataUrl);
            if (logo) {
                try {
                    await storeLogo(req, logo.buffer, logo.mime, 'primary');
                    applied.push('Logo');
                } catch (error: any) {
                    console.warn('[Marketing] Logo from site failed:', error.message);
                }
            }
        } else if (current.logo?.primary) kept.push('Logo');

        await job.set(
            {
                status: 'done',
                stage: 'Done',
                progress: 100,
                result: { applied, kept, notes, socials: site.socials || [], business: business || null, logos: site.logos.length },
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
    } catch (error: any) {
        console.error('[Marketing] Website setup failed:', error.message);
        await job.set({ status: 'failed', stage: 'Failed', error: error.status ? error.message : 'Something went wrong reading your website.', updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
    }
}));

router.get('/jobs/:id', route(async (req, res) => {
    const snap = await jobsCol(req).doc(String(req.params.id)).get();
    if (!snap.exists) throw fail(404, 'Job not found.');
    const { createdAt, updatedAt, ...data } = snap.data() as any;
    res.json({ job: { id: snap.id, ...data } });
}));

export default router;
