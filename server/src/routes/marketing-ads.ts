import express, { Request } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { FieldValue } from 'firebase-admin/firestore';
import { v4 as uuidv4 } from 'uuid';
import { checkLimit, consumeUsage, planRateLimit, refundUsage, requirePlan } from '../middleware/planGate';
import { CREDIT_COSTS } from '../utils/planLimits';
import { deleteFile, uploadFile } from '../services/storage.service.js';
import { aiConfigured } from '../services/marketing/brand-ai.js';
import { AD_GOALS, analyzeAdStructure, normalizeAd, planAds } from '../services/marketing/ad-plan.js';
import { AD_LAYOUTS, FORMATS, adHtml } from '../services/marketing/ad-templates.js';
import { renderHtml } from '../services/marketing/carousel-render.js';
import { fontFaceCss } from '../services/marketing/fonts.js';
import { generateImage, imageGenerationAvailable, imageProviders } from '../services/marketing/image-gen.js';
import { inChromeQueue } from '../services/marketing/chrome-queue.js';
import { productImage } from '../services/video-ads/cutout.js';
import { fail, requireEditor, route, storedFileAsDataUrl, workspaceRef } from '../services/marketing/http';

/**
 * Image Ad Studio (mounted at /api/marketing/ads; the parent router has resolved the workspace).
 *  GET    /options                    formats, goals, layouts, which image tiers are available
 *  GET    /                           recent ad sets
 *  POST   /                           multipart: optional "product" image + fields
 *                                       { goal, formats: "1:1,4:5,9:16", count 1-6, imagery none|free|fast|best,
 *                                         idea, productName, productDescription, swipeId? (Recreate) } → 202 { id }
 *  GET    /:id                        one ad set (poll while status = running)
 *  PATCH  /:id/ads/:index             edited copy/layout → re-rendered in every format (no AI cost)
 *  POST   /:id/variations             { count 1-4 } → more concepts, different angles (charged like a new set)
 *  DELETE /:id
 *
 * Data: workspaces/{id}/adSets/{setId}. Files: storage under workspaces/{id}/ads/{setId}/…
 * Paid plans only: every generation is charged in AI credits, which the Starter plan doesn't have.
 */

const router = express.Router();
// Paid plans only (Nano and up), for every route including the list.
router.use(requirePlan('nano'));

const adSets = (req: Request) => workspaceRef(req).collection('adSets');
const swipes = (req: Request) => workspaceRef(req).collection('adSwipes');
const kitDoc = (req: Request) => workspaceRef(req).collection('brandKit').doc('current');
const storagePath = (req: Request, id: string) => `workspaces/${(req as any).workspaceId}/ads/${id}`;
const IMAGERY = ['none', 'free', 'fast', 'best'] as const;
const AD_FORMATS = ['1:1', '4:5', '9:16'] as const;
const IMAGE_CREDITS: Record<string, number> = { none: 0, free: 0, fast: CREDIT_COSTS.fastImage, best: CREDIT_COSTS.bestImage };
const STALE_MS = 15 * 60 * 1000;
const MAX_ADS_PER_SET = 12;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

const iso = (v: any) => v?.toDate?.()?.toISOString?.() || v || null;
const publicSet = (id: string, d: any) => ({ id, ...d, createdAt: iso(d.createdAt), updatedAt: iso(d.updatedAt) });

function parseSettings(b: any) {
    const formats = String(b.formats || '1:1')
        .split(',')
        .map((f) => f.trim())
        .filter((f): f is (typeof AD_FORMATS)[number] => (AD_FORMATS as readonly string[]).includes(f));
    return {
        goal: AD_GOALS[b.goal as keyof typeof AD_GOALS] ? b.goal : 'sales',
        formats: formats.length ? [...new Set(formats)] : ['1:1'],
        count: Math.max(1, Math.min(6, Number(b.count) || 3)),
        imagery: (IMAGERY as readonly string[]).includes(b.imagery) ? b.imagery : 'none',
        idea: String(b.idea || '').trim().slice(0, 500),
        productName: String(b.productName || '').trim().slice(0, 80),
        productDescription: String(b.productDescription || '').trim().slice(0, 300),
        swipeId: typeof b.swipeId === 'string' && /^[\w-]{6,64}$/.test(b.swipeId) ? b.swipeId : null,
    };
}

/** Credits: 1 for the writing, 1 to read a reference ad, plus each AI backdrop at its tier. */
function setCredits(req: Request) {
    const s = parseSettings(req.body || {});
    return 1 + (s.swipeId ? 1 : 0) + s.count * (IMAGE_CREDITS[s.imagery] || 0);
}

/** Taller format first: the backdrop is generated at that shape and cropped for the others. */
const generationAspect = (formats: string[]) => (formats.includes('9:16') ? '9:16' : formats.includes('4:5') ? '4:5' : '1:1');

function backdropPrompt(kit: any, prompt: string) {
    const palette = [kit.colors?.primary, kit.colors?.secondary, kit.colors?.accent].filter(Boolean).join(', ');
    return [
        prompt,
        kit.style?.imagery ? `Style: ${kit.style.imagery}.` : '',
        palette ? `Colour palette leaning on ${palette}.` : '',
        'Photographic advertising backdrop. No text, letters, words, numbers, logos or watermarks anywhere. Leave calm space for overlaid text.',
    ]
        .filter(Boolean)
        .join(' ');
}

async function dataUrlFor(buffer: Buffer, format: string) {
    const { width, height } = FORMATS[format as keyof typeof FORMATS] || FORMATS['1:1'];
    const jpg = await sharp(buffer).resize(width, height, { fit: 'cover', position: 'attention' }).jpeg({ quality: 88 }).toBuffer();
    return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

async function bufferFromStored(url: string | null | undefined, workspaceId: string) {
    const data = await storedFileAsDataUrl(url, { workspaceId });
    return data ? Buffer.from(data.split(',')[1], 'base64') : null;
}

/** Renders the given ads in every format of the set and stores the PNGs. Returns updated ads. */
async function renderAds(req: Request, id: string, set: any, kit: any, ads: any[], only?: number[]) {
    const workspaceId = (req as any).workspaceId;
    const indexes = only?.length ? only : ads.map((_, i) => i);
    const [logo, logoOnDark, product, fontCss] = await Promise.all([
        storedFileAsDataUrl(kit.logo?.primary, { maxWidth: 600, workspaceId }),
        storedFileAsDataUrl(kit.logo?.onDark, { maxWidth: 600, workspaceId }),
        storedFileAsDataUrl(set.product?.url, { workspaceId }),
        fontFaceCss([kit.fonts?.heading, kit.fonts?.body]),
    ]);
    const pages: { index: number; format: string; html: string; width: number; height: number }[] = [];
    for (const index of indexes) {
        const ad = ads[index];
        const backdrop = ad.imageUrl ? await bufferFromStored(ad.imageUrl, workspaceId) : null;
        for (const format of set.settings.formats) {
            const { width, height } = FORMATS[format as keyof typeof FORMATS];
            const image = backdrop ? await dataUrlFor(backdrop, format) : null;
            const html = adHtml(ad, { kit, format, image, product, productCutout: !!set.product?.cutout, logo, logoOnDark, fontCss });
            pages.push({ index, format, html, width, height });
        }
    }
    const buffers = await inChromeQueue(() => renderHtml(pages));
    const next = ads.map((a) => ({ ...a, renders: { ...(a.renders || {}) } }));
    for (const [i, p] of pages.entries()) {
        const url = await uploadFile(buffers[i], `${storagePath(req, id)}/renders`, 'image/png');
        const old = next[p.index].renders[p.format];
        if (old) deleteFile(old).catch(() => {});
        next[p.index].renders[p.format] = url;
    }
    return next;
}

/** Writes concepts, makes their backdrops, renders them. Used for new sets and for variations. */
async function produce(req: Request, ref: FirebaseFirestore.DocumentReference, set: any, kit: any, count: number, structure: any, existing: any[]) {
    const update = (data: Record<string, unknown>) => ref.update({ ...data, updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
    const { settings } = set;
    const withImages = settings.imagery !== 'none' && imageGenerationAvailable();
    await update({ stage: 'Writing your ads', progress: 12 });
    const concepts = await planAds({
        kit,
        product: { name: settings.productName, description: settings.productDescription, hasPhoto: !!set.product?.url, cutout: !!set.product?.cutout },
        idea: settings.idea,
        goal: settings.goal,
        count,
        withImages,
        structure,
        avoid: existing.map((a) => ({ angle: a.angle, headline: a.headline })),
    });
    const notes: string[] = [];
    const fresh: any[] = concepts.map((c) => ({ ...c, imageUrl: null, renders: {} }));
    const wanted = fresh.map((a, i) => (a.imagePrompt ? i : -1)).filter((i) => i >= 0);
    for (const [n, i] of wanted.entries()) {
        await update({ stage: `Creating backdrop ${n + 1} of ${wanted.length}`, progress: 25 + Math.round((n / Math.max(1, wanted.length)) * 45) });
        try {
            const img = await generateImage({ prompt: backdropPrompt(kit, fresh[i].imagePrompt), tier: settings.imagery, aspect: generationAspect(settings.formats) as any });
            const jpg = await sharp(img.buffer).jpeg({ quality: 90 }).toBuffer();
            fresh[i].imageUrl = await uploadFile(jpg, `${storagePath(req, ref.id)}/backdrops`, 'image/jpeg');
            fresh[i].imageModel = `${img.provider}:${img.model}`;
        } catch (error: any) {
            console.warn('[Ads] Backdrop failed:', error.message);
            if (!notes.length) notes.push(error.status === 503 ? error.message : 'An AI backdrop could not be made, so that ad uses your product photo or brand colours instead.');
        }
    }
    await update({ stage: 'Designing your ads', progress: 75 });
    const all = [...existing, ...fresh];
    const rendered = await renderAds(req, ref.id, set, kit, all, fresh.map((_, i) => existing.length + i));
    return { ads: rendered, notes };
}

async function loadSet(req: Request) {
    const ref = adSets(req).doc(String(req.params.id));
    const snap = await ref.get();
    if (!snap.exists) throw fail(404, 'Ad set not found.');
    const data = snap.data() as any;
    const started = (data.updatedAt || data.createdAt)?.toDate?.()?.getTime?.() || 0;
    if (data.status === 'running' && started && Date.now() - started > STALE_MS) {
        const failed = { status: data.ads?.length ? 'done' : 'failed', stage: 'Interrupted', error: 'This was interrupted. Try again.' };
        await ref.update(failed).catch(() => {});
        return { ref, data: { ...data, ...failed } };
    }
    return { ref, data };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/options', route(async (_req, res) => {
    const providers = imageProviders();
    res.json({
        formats: AD_FORMATS.map((id) => ({ id, label: FORMATS[id].label, width: FORMATS[id].width, height: FORMATS[id].height })),
        goals: Object.entries(AD_GOALS).map(([id, description]) => ({ id, description })),
        layouts: Object.entries(AD_LAYOUTS).map(([id, description]) => ({ id, description })),
        imagery: { none: true, free: providers.pollinations, fast: providers.pollinations || providers.openrouter, best: providers.openrouter || providers.pollinations },
        credits: { writing: 1, reference: 1, ...IMAGE_CREDITS },
        aiAvailable: aiConfigured(),
    });
}));

router.get('/', route(async (req, res) => {
    const snap = await adSets(req).orderBy('createdAt', 'desc').limit(24).get();
    res.json({
        sets: snap.docs.map((d) => {
            const s = d.data();
            const first = s.ads?.[0]?.renders || {};
            return { id: d.id, title: s.title || 'Ads', status: s.status, stage: s.stage, progress: s.progress, count: s.ads?.length || 0, cover: first[s.settings?.formats?.[0]] || Object.values(first)[0] || null, createdAt: iso(s.createdAt) };
        }),
    });
}));

router.post('/', requireEditor, planRateLimit(), upload.single('product'), checkLimit('aiCalls', setCredits), route(async (req, res) => {
    if (!aiConfigured()) throw fail(503, 'AI is not set up on the server yet. Add OPENROUTER_API_KEY or GEMINI_API_KEY to server/.env.');
    const settings = parseSettings(req.body || {});
    if (!settings.idea && !settings.productName && !(req as any).file) throw fail(400, 'Add a product or describe what the ad is about.');
    if (settings.imagery !== 'none' && !imageGenerationAvailable()) settings.imagery = 'none';

    let swipe: any = null;
    if (settings.swipeId) {
        const snap = await swipes(req).doc(settings.swipeId).get();
        if (!snap.exists) throw fail(404, 'That saved ad was not found. Pick it again from your swipe file.');
        swipe = { id: snap.id, ...snap.data() };
    }

    const id = uuidv4();
    const ref = adSets(req).doc(id);
    // The product photo: background removed when it's on a plain backdrop, otherwise kept as is.
    let product: any = null;
    const file = (req as any).file;
    if (file) {
        const img = await productImage(file.buffer);
        const buffer = Buffer.from(img.src.split(',')[1], 'base64');
        product = { url: await uploadFile(buffer, `${storagePath(req, id)}/product`, 'image/webp'), cutout: img.cutout, width: img.width, height: img.height };
    }

    const title = settings.productName || settings.idea.slice(0, 48) || 'Ads';
    const set = { settings, product, reference: swipe ? { swipeId: swipe.id, competitor: swipe.competitor || '', previewUrl: swipe.previewUrl || null } : null };
    await ref.set({ status: 'running', stage: 'Starting', progress: 4, title, ...set, ads: [], createdBy: (req as any).uid, createdAt: FieldValue.serverTimestamp() });
    res.status(202).json({ id });

    const update = (data: Record<string, unknown>) => ref.update({ ...data, updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
    try {
        const kit: any = (await kitDoc(req).get()).data() || {};
        let structure = swipe?.structure || null;
        if (swipe && !structure) {
            await update({ stage: 'Reading the reference ad', progress: 8 });
            const buffer = await bufferFromStored(swipe.imageUrl, (req as any).workspaceId);
            if (!buffer) throw fail(410, 'The saved ad image could not be read. Upload it to your swipe file again.');
            structure = await analyzeAdStructure(buffer);
            await swipes(req).doc(swipe.id).update({ structure }).catch(() => {});
        }
        const { ads, notes } = await produce(req, ref, set, kit, settings.count, structure, []);
        await update({ status: 'done', stage: 'Done', progress: 100, ads, notes, structure: structure || null });
    } catch (error: any) {
        console.error('[Ads] Failed:', error.message);
        // Nothing was delivered, so the credits go back.
        await refundUsage((req as any).workspaceId, (req as any).plan || 'starter', 'aiCalls', setCredits(req));
        await update({ status: 'failed', stage: 'Failed', error: error.status ? error.message : 'The ads could not be made. Try again.' });
    }
}));

router.get('/:id', route(async (req, res) => {
    const { data } = await loadSet(req);
    res.json({ set: publicSet(String(req.params.id), data) });
}));

router.patch('/:id/ads/:index', requireEditor, route(async (req, res) => {
    const { ref, data } = await loadSet(req);
    if (data.status !== 'done') throw fail(409, 'Wait until the ads have finished.');
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= data.ads.length) throw fail(404, 'Ad not found.');
    const current = data.ads[index];
    const edited = normalizeAd({ ...current, ...req.body, imagePrompt: current.imagePrompt });
    const ads = [...data.ads];
    ads[index] = { ...current, ...edited };
    const kit: any = (await kitDoc(req).get()).data() || {};
    const next = await renderAds(req, String(req.params.id), data, kit, ads, [index]);
    await ref.update({ ads: next, updatedAt: FieldValue.serverTimestamp() });
    res.json({ set: publicSet(String(req.params.id), { ...data, ads: next }) });
}));

// Charged once the count and tier are known (below), like a new set of that size.
router.post('/:id/variations', requireEditor, planRateLimit(), route(async (req, res) => {
    const { ref, data } = await loadSet(req);
    if (data.status !== 'done') throw fail(409, 'Wait until the ads have finished.');
    const count = Math.max(1, Math.min(4, Number(req.body?.count) || 3, MAX_ADS_PER_SET - data.ads.length));
    if (data.ads.length >= MAX_ADS_PER_SET) throw fail(400, `A set holds up to ${MAX_ADS_PER_SET} ads. Start a new set for more.`);
    const credits = 1 + count * (IMAGE_CREDITS[data.settings.imagery] || 0);
    const usage = await consumeUsage((req as any).workspaceId, (req as any).plan || 'starter', 'aiCalls', credits);
    if (!usage.ok) return res.status(usage.status).json(usage.body);
    await ref.update({ status: 'running', stage: 'Writing variations', progress: 10, updatedAt: FieldValue.serverTimestamp() });
    res.status(202).json({ id: ref.id });

    try {
        const kit: any = (await kitDoc(req).get()).data() || {};
        const { ads, notes } = await produce(req, ref, data, kit, count, data.structure || null, data.ads);
        await ref.update({ status: 'done', stage: 'Done', progress: 100, ads, notes, updatedAt: FieldValue.serverTimestamp() });
    } catch (error: any) {
        console.error('[Ads] Variations failed:', error.message);
        await refundUsage((req as any).workspaceId, (req as any).plan || 'starter', 'aiCalls', credits);
        await ref.update({ status: 'done', stage: 'Done', progress: 100, notes: [error.status ? error.message : 'The variations could not be made. Try again.'], updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
    }
}));

router.delete('/:id', requireEditor, route(async (req, res) => {
    const { ref, data } = await loadSet(req);
    if (data.status === 'running') throw fail(409, 'These ads are still being made.');
    await ref.delete();
    const files = [data.product?.url, ...(data.ads || []).flatMap((a: any) => [a.imageUrl, ...Object.values(a.renders || {})])];
    for (const url of files) if (url) deleteFile(url as string).catch(() => {});
    res.json({ success: true });
}));

export default router;
