import express, { Request } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { checkLimit, consumeUsage, planRateLimit } from '../middleware/planGate';
import { CREDIT_COSTS } from '../utils/planLimits';
import { deleteFile, uploadFile } from '../services/storage.service.js';
import { aiConfigured } from '../services/marketing/brand-ai.js';
import { GOALS, normalizeSlide, planCarousel, sourceFromSite } from '../services/marketing/carousel-plan.js';
import { FORMATS, LAYOUTS } from '../services/marketing/carousel-templates.js';
import { renderSlides } from '../services/marketing/carousel-render.js';
import { extractBrandFromWebsite } from '../services/marketing/brand-extract.js';
import { generateImage, imageGenerationAvailable, imageProviders } from '../services/marketing/image-gen.js';
import { inChromeQueue } from '../services/marketing/chrome-queue.js';
import { fail, requireEditor, route, storedFileAsDataUrl, workspaceRef } from '../services/marketing/http';

/**
 * Carousel studio (mounted at /api/marketing/carousels; the parent router has already
 * resolved the workspace).
 *  GET    /options                     formats, goals, layouts, which image tiers are available
 *  POST   /                            { source: {type: website|topic|text, topic?, text?}, goal, format,
 *                                        slideCount, imagery: none|free|fast|best, extra } → 202 { id }
 *  GET    /                            recent carousels
 *  GET    /:id                         one carousel (poll while status = running)
 *  PATCH  /:id                         { caption, hashtags, title }
 *  PATCH  /:id/slides/:index           edited slide fields → re-rendered (no AI cost)
 *  POST   /:id/slides/:index/image     { prompt? } → new AI image for that slide, re-rendered
 *  DELETE /:id
 */

const router = express.Router();

const carousels = (req: Request) => workspaceRef(req).collection('carousels');
const kitDoc = (req: Request) => workspaceRef(req).collection('brandKit').doc('current');
const storagePath = (req: Request, id: string) => `workspaces/${(req as any).workspaceId}/carousels/${id}`;
const IMAGERY = ['none', 'free', 'fast', 'best'] as const;

/** AI credits per generated image: paid image models cost far more than a text generation. */
const IMAGE_CREDITS: Record<string, number> = { none: 0, free: 0, fast: CREDIT_COSTS.fastImage, best: CREDIT_COSTS.bestImage };

/** Credits for a new carousel: 1 for the writing, plus each slide image at its tier. */
function carouselCredits(req: Request): number {
    const b = req.body || {};
    const imagery = IMAGERY.includes(b.imagery) ? b.imagery : 'none';
    const slides = Math.max(4, Math.min(10, Number(b.slideCount) || 7));
    return 1 + slides * (IMAGE_CREDITS[imagery] || 0);
}
// A carousel still "running" after this long was interrupted (e.g. a server restart).
const STALE_MS = 15 * 60 * 1000;

function iso(v: any) {
    return v?.toDate?.()?.toISOString?.() || v || null;
}

function publicCarousel(id: string, d: any) {
    return { id, ...d, createdAt: iso(d.createdAt), updatedAt: iso(d.updatedAt) };
}

/** Style hint appended to every image prompt so imagery matches the brand. */
function imagePromptFor(kit: any, prompt: string) {
    const palette = [kit.colors?.primary, kit.colors?.secondary, kit.colors?.accent].filter(Boolean).join(', ');
    return [
        prompt,
        kit.style?.imagery ? `Style: ${kit.style.imagery}.` : '',
        kit.style?.mood?.length ? `Mood: ${kit.style.mood.join(', ')}.` : '',
        palette ? `Colour palette leaning on ${palette}.` : '',
        'No text, letters, words, numbers, logos or watermarks anywhere in the image. Leave calm space for overlaid text.',
    ]
        .filter(Boolean)
        .join(' ');
}

/** The brand's best references as data URLs (for providers that accept them). */
async function referenceDataUrls(req: Request, count = 3) {
    const snap = await workspaceRef(req).collection('brandReferences').orderBy('createdAt', 'desc').limit(count).get();
    const out: string[] = [];
    for (const d of snap.docs) {
        const url = await storedFileAsDataUrl(d.data().previewUrl, { maxWidth: 768, jpeg: true, workspaceId: (req as any).workspaceId });
        if (url) out.push(url);
    }
    return out;
}

async function makeImage(req: Request, kit: any, prompt: string, tier: string, format: string, carouselId: string) {
    const references = await referenceDataUrls(req);
    const img = await generateImage({ prompt: imagePromptFor(kit, prompt), tier: tier as any, aspect: format as any, references });
    const { width, height } = FORMATS[format as keyof typeof FORMATS] || FORMATS['4:5'];
    // Fit to the slide once; store the fitted JPEG (smaller, and what gets rendered).
    const fitted = await sharp(img.buffer).resize(width, height, { fit: 'cover', position: 'attention' }).jpeg({ quality: 88 }).toBuffer();
    const url = await uploadFile(fitted, `${storagePath(req, carouselId)}/images`, 'image/jpeg');
    return { url, dataUrl: `data:image/jpeg;base64,${fitted.toString('base64')}`, provider: img.provider, model: img.model, cost: img.cost };
}

async function logoDataUrls(kit: any, workspaceId: string) {
    const [logo, logoOnDark] = await Promise.all([storedFileAsDataUrl(kit.logo?.primary, { maxWidth: 600, workspaceId }), storedFileAsDataUrl(kit.logo?.onDark, { maxWidth: 600, workspaceId })]);
    return { logo, logoOnDark };
}

/** Renders the given slide indexes and uploads them; returns updated slides. */
async function renderAndStore(req: Request, id: string, kit: any, format: string, slides: any[], imageData: (string | null)[], only?: number[]) {
    const logos = await logoDataUrls(kit, (req as any).workspaceId);
    const rendered = await inChromeQueue(() => renderSlides(slides, { kit, format, images: imageData, ...logos }, only));
    const next = [...slides];
    for (const r of rendered) {
        const url = await uploadFile(r.buffer, `${storagePath(req, id)}/slides`, 'image/png');
        if (next[r.index].renderUrl) deleteFile(next[r.index].renderUrl).catch(() => {});
        next[r.index] = { ...next[r.index], renderUrl: url, renderedAt: new Date().toISOString() };
    }
    return next;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/options', route(async (_req, res) => {
    const providers = imageProviders();
    res.json({
        formats: Object.entries(FORMATS as Record<string, { label: string; width: number; height: number }>).map(([id, f]) => ({ id, label: f.label, width: f.width, height: f.height })),
        goals: Object.entries(GOALS).map(([id, description]) => ({ id, description })),
        layouts: Object.entries(LAYOUTS).map(([id, description]) => ({ id, description })),
        imagery: {
            none: true,
            free: providers.pollinations,
            fast: providers.pollinations || providers.openrouter,
            best: providers.openrouter || providers.pollinations,
        },
        aiAvailable: aiConfigured(),
    });
}));

router.get('/', route(async (req, res) => {
    const snap = await carousels(req).orderBy('createdAt', 'desc').limit(24).get();
    res.json({
        carousels: snap.docs.map((d) => {
            const c = d.data();
            const stale = c.status === 'running' && Date.now() - (c.createdAt?.toDate?.()?.getTime?.() || Date.now()) > STALE_MS;
            if (stale) {
                c.status = 'failed';
                c.stage = 'Interrupted';
            }
            return { id: d.id, title: c.title || 'Carousel', status: c.status, stage: c.stage, progress: c.progress, format: c.settings?.format, slideCount: c.slides?.length || 0, cover: c.slides?.[0]?.renderUrl || null, createdAt: iso(c.createdAt) };
        }),
    });
}));

router.post('/', requireEditor, planRateLimit(), checkLimit('aiCalls', carouselCredits), route(async (req, res) => {
    if (!aiConfigured()) throw fail(503, 'AI is not set up on the server yet. Add OPENROUTER_API_KEY or GEMINI_API_KEY to server/.env.');
    const b = req.body || {};
    const sourceType = ['website', 'topic', 'text'].includes(b.source?.type) ? b.source.type : 'topic';
    const topic = String(b.source?.topic || '').trim().slice(0, 300);
    const pasted = String(b.source?.text || '').trim().slice(0, 12000);
    if (sourceType === 'topic' && topic.length < 3) throw fail(400, 'Describe what the carousel is about.');
    if (sourceType === 'text' && pasted.length < 80) throw fail(400, 'Paste at least a paragraph of text (80+ characters).');
    const settings = {
        source: { type: sourceType, topic: sourceType === 'topic' ? topic : '', textLength: pasted.length },
        goal: GOALS[b.goal as keyof typeof GOALS] ? b.goal : 'educate',
        format: FORMATS[b.format as keyof typeof FORMATS] ? b.format : '4:5',
        slideCount: Math.max(4, Math.min(10, Number(b.slideCount) || 7)),
        imagery: IMAGERY.includes(b.imagery) ? b.imagery : 'none',
        extra: String(b.extra || '').trim().slice(0, 400),
    };
    if (settings.imagery !== 'none' && !imageGenerationAvailable()) settings.imagery = 'none';

    const id = uuidv4();
    const ref = carousels(req).doc(id);
    await ref.set({ status: 'running', stage: 'Writing your slides', progress: 5, settings, title: '', slides: [], createdBy: (req as any).uid, createdAt: FieldValue.serverTimestamp() });
    res.status(202).json({ id });

    const update = (data: Record<string, unknown>) => ref.update({ ...data, updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
    const notes: string[] = [];
    try {
        const kit: any = (await kitDoc(req).get()).data() || {};

        // Source material.
        let source = '';
        if (sourceType === 'website') {
            if (kit.site?.source) source = kit.site.source;
            else if (kit.website) {
                await update({ stage: 'Reading your website', progress: 8 });
                const site: any = await inChromeQueue(() => extractBrandFromWebsite(kit.website));
                source = sourceFromSite(site).slice(0, 12000);
                await kitDoc(req).set({ site: { url: site.url, readAt: new Date().toISOString(), source, socials: site.socials || [] } }, { merge: true });
            } else throw fail(400, 'Add your website in the brand kit first (Marketing → Brand), or choose another source.');
        } else if (sourceType === 'topic') {
            source = `Topic: ${topic}`;
        } else source = pasted;

        // 1. Plan the slides.
        await update({ stage: 'Writing your slides', progress: 15 });
        // Up to 2 AI images per carousel keeps cost and time down; templates carry the rest.
        const imageSlots = settings.imagery === 'none' ? 0 : 2;
        const plan = await planCarousel({ kit, source, goal: settings.goal, slideCount: settings.slideCount, imageSlots, extra: settings.extra });
        await update({ title: plan.title, caption: plan.caption, hashtags: plan.hashtags, stage: 'Planning done', progress: 35 });

        // 2. AI imagery for the slides that asked for it.
        const imageData: (string | null)[] = plan.slides.map(() => null);
        const slides: any[] = plan.slides.map((s) => ({ ...s, imageUrl: null }));
        const wanted = slides.map((s, i) => (s.imagePrompt ? i : -1)).filter((i) => i >= 0);
        for (const [n, i] of wanted.entries()) {
            await update({ stage: `Creating image ${n + 1} of ${wanted.length}`, progress: 35 + Math.round((n / Math.max(1, wanted.length)) * 30) });
            try {
                const img = await makeImage(req, kit, slides[i].imagePrompt, settings.imagery, settings.format, id);
                slides[i] = { ...slides[i], imageUrl: img.url, imageModel: `${img.provider}:${img.model}` };
                imageData[i] = img.dataUrl;
            } catch (error: any) {
                console.warn('[Carousel] Image failed:', error.message);
                if (!notes.length) notes.push(error.status === 503 ? error.message : 'An AI image could not be made, so that slide uses a text layout.');
                if (slides[i].layout === 'image') slides[i] = { ...slides[i], layout: 'statement' };
            }
        }

        // 3. Render with the brand kit.
        await update({ stage: 'Designing your slides', progress: 70 });
        const rendered = await renderAndStore(req, id, kit, settings.format, slides, imageData);
        await update({ status: 'done', stage: 'Done', progress: 100, slides: rendered, notes, brandSnapshot: { colors: kit.colors || null, fonts: kit.fonts || null } });
    } catch (error: any) {
        console.error('[Carousel] Failed:', error.message);
        await update({ status: 'failed', stage: 'Failed', error: error.status ? error.message : 'The carousel could not be made. Try again.' });
    }
}));

async function loadCarousel(req: Request) {
    const ref = carousels(req).doc(String(req.params.id));
    const snap = await ref.get();
    if (!snap.exists) throw fail(404, 'Carousel not found.');
    const data = snap.data() as any;
    const started = data.createdAt?.toDate?.()?.getTime?.() || 0;
    if (data.status === 'running' && started && Date.now() - started > STALE_MS) {
        const failed = { status: 'failed', stage: 'Failed', error: 'This carousel was interrupted. Delete it and make it again.' };
        await ref.update(failed).catch(() => {});
        return { ref, data: { ...data, ...failed } };
    }
    return { ref, data };
}

router.get('/:id', route(async (req, res) => {
    const { data } = await loadCarousel(req);
    res.json({ carousel: publicCarousel(String(req.params.id), data) });
}));

router.patch('/:id', requireEditor, route(async (req, res) => {
    const { ref } = await loadCarousel(req);
    const b = req.body || {};
    const updates: Record<string, unknown> = {};
    if (typeof b.caption === 'string') updates.caption = b.caption.slice(0, 2200);
    if (typeof b.title === 'string') updates.title = b.title.slice(0, 80);
    if (Array.isArray(b.hashtags)) updates.hashtags = b.hashtags.map((h: unknown) => String(h).replace(/^#/, '').replace(/\s+/g, '').slice(0, 40)).filter(Boolean).slice(0, 15);
    if (!Object.keys(updates).length) throw fail(400, 'Nothing to save.');
    await ref.update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
    res.json({ carousel: publicCarousel(String(req.params.id), (await ref.get()).data()) });
}));

/** Images already on a carousel, as data URLs, so a single slide can be re-rendered. */
async function existingImages(slides: any[], only: number, workspaceId: string) {
    return Promise.all(slides.map((s, i) => (i === only && s.imageUrl ? storedFileAsDataUrl(s.imageUrl, { workspaceId }) : Promise.resolve(null))));
}

router.patch('/:id/slides/:index', requireEditor, route(async (req, res) => {
    const { ref, data } = await loadCarousel(req);
    if (data.status !== 'done') throw fail(409, 'Wait until the carousel has finished.');
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= data.slides.length) throw fail(404, 'Slide not found.');
    const current = data.slides[index];
    const edited = normalizeSlide({ ...current, ...req.body, imagePrompt: current.imagePrompt });
    const slides = [...data.slides];
    slides[index] = { ...current, ...edited, imageUrl: current.imageUrl || null };
    const kit: any = (await kitDoc(req).get()).data() || {};
    const images = await existingImages(slides, index, (req as any).workspaceId);
    const next = await renderAndStore(req, String(req.params.id), kit, data.settings.format, slides, images, [index]);
    await ref.update({ slides: next, updatedAt: FieldValue.serverTimestamp() });
    res.json({ carousel: publicCarousel(String(req.params.id), { ...data, slides: next }) });
}));

// A single new image, charged at its tier once the tier is known (below).
router.post('/:id/slides/:index/image', requireEditor, planRateLimit(), route(async (req, res) => {
    const { ref, data } = await loadCarousel(req);
    if (data.status !== 'done') throw fail(409, 'Wait until the carousel has finished.');
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= data.slides.length) throw fail(404, 'Slide not found.');
    if (!imageGenerationAvailable()) throw fail(503, 'Image generation is not set up yet. Add POLLINATIONS_API_KEY (free) or OPENROUTER_API_KEY to server/.env.');
    const current = data.slides[index];
    const prompt = String(req.body?.prompt || current.imagePrompt || current.headline || '').trim().slice(0, 600);
    if (!prompt) throw fail(400, 'Describe the image you want.');
    const tier = IMAGERY.includes(req.body?.tier) && req.body.tier !== 'none' ? req.body.tier : data.settings.imagery !== 'none' ? data.settings.imagery : 'fast';
    const usage = await consumeUsage((req as any).workspaceId, (req as any).plan || 'starter', 'aiCalls', IMAGE_CREDITS[tier] || 1);
    if (!usage.ok) return res.status(usage.status).json(usage.body);
    const kit: any = (await kitDoc(req).get()).data() || {};
    const img = await makeImage(req, kit, prompt, tier, data.settings.format, String(req.params.id));
    if (current.imageUrl) deleteFile(current.imageUrl).catch(() => {});
    const slides = [...data.slides];
    // A slide that gets an image becomes an image layout unless it is the cover.
    slides[index] = { ...current, imagePrompt: prompt, imageUrl: img.url, imageModel: `${img.provider}:${img.model}`, layout: current.layout === 'cover' ? 'cover' : 'image' };
    const images = slides.map((_, i) => (i === index ? img.dataUrl : null));
    const next = await renderAndStore(req, String(req.params.id), kit, data.settings.format, slides, images, [index]);
    await ref.update({ slides: next, updatedAt: FieldValue.serverTimestamp() });
    res.json({ carousel: publicCarousel(String(req.params.id), { ...data, slides: next }) });
}));

router.delete('/:id', requireEditor, route(async (req, res) => {
    const { ref, data } = await loadCarousel(req);
    if (data.status === 'running') throw fail(409, 'This carousel is still being made.');
    await ref.delete();
    for (const s of data.slides || []) for (const url of [s.renderUrl, s.imageUrl]) if (url) deleteFile(url).catch(() => {});
    res.json({ success: true });
}));

export default router;
