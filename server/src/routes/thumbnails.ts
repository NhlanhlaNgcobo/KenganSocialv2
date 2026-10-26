import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import { db } from '../utils/firestore';
import { withWorkspace } from '../middleware/withWorkspace';
import { checkLimit, consumeUsage, planRateLimit, refundUsage } from '../middleware/planGate';
import { CREDIT_COSTS } from '../utils/planLimits';
import { aiConfigured } from '../services/gemini-json.js';
import { getUploadPath } from '../services/manual-edit.service.js';
import { loadClipBrand } from '../services/clips/brand.js';
import { background, backgroundsAvailable, candidate, candidates, headlines } from '../services/thumbnails/index.js';
import { FORMATS, STYLES, frameImage, renderThumbnail } from '../services/thumbnails/render.js';
import { aiFeature } from '../config/ai-features';

/**
 * Thumbnails for TikTok covers and YouTube (Clips and the video editor).
 *  GET  /api/thumbnails/options
 *  POST /api/thumbnails/candidates  { uploadId, start?, end? }   the most clickable stills, scored
 *  POST /api/thumbnails/headlines   { title?, hook?, caption?, transcript? }
 *  POST /api/thumbnails/background  { prompt, format }           AI background (uses AI credits)
 *  POST /api/thumbnails/render      { candidateId, format, headline, highlight?, style, brand?, label? } → PNG
 */
const router = express.Router();
router.use(withWorkspace);

const uid = (req: Request) => (req as any).uid as string;

router.get('/options', (_req: Request, res: Response) => {
    res.json({ formats: Object.keys(FORMATS), styles: STYLES, backgrounds: backgroundsAvailable() });
});

router.post('/candidates', planRateLimit(), async (req: Request, res: Response) => {
    const uploadId = String(req.body?.uploadId || '');
    const sourcePath = uploadId ? getUploadPath(uploadId, uid(req)) : null;
    if (!sourcePath || !fs.existsSync(sourcePath)) return res.status(404).json({ error: 'That video is no longer available here. Open it again and retry.' });
    const start = Math.max(0, Number(req.body?.start) || 0);
    const end = Number(req.body?.end) > start ? Number(req.body.end) : null;
    try {
        res.json(await candidates({ sourcePath, start, end, owner: uid(req) }));
    } catch (error: any) {
        console.error('[Thumbnails] candidates failed:', error.message);
        res.status(error.status || 500).json({ error: error.message || 'Frames could not be picked from this video.' });
    }
});

router.post('/headlines', planRateLimit(), async (req: Request, res: Response) => {
    const s = (v: unknown, n: number) => String(v || '').slice(0, n);
    // AI headline ideas cost a credit; without credits (or AI) they are built from the clip's own words.
    const ai = aiFeature('thumbnailHeadlines') && aiConfigured() && (await consumeUsage((req as any).workspaceId, (req as any).plan || 'starter', 'aiCalls', CREDIT_COSTS.headlines)).ok;
    res.json(await headlines({ title: s(req.body?.title, 200), hook: s(req.body?.hook, 300), caption: s(req.body?.caption, 600), transcript: s(req.body?.transcript, 4000), allowAi: ai }));
});

// An AI background is a fast-quality image: the same credits as one in a carousel.
router.post('/background', planRateLimit(), checkLimit('aiCalls', CREDIT_COSTS.fastImage), async (req: Request, res: Response) => {
    const prompt = String(req.body?.prompt || '').trim().slice(0, 400);
    if (!prompt) {
        await refundUsage((req as any).workspaceId, (req as any).plan || 'starter', 'aiCalls', CREDIT_COSTS.fastImage);
        return res.status(400).json({ error: 'Describe the background you want.' });
    }
    try {
        res.json(await background({ prompt, format: req.body?.format === 'tiktok' ? 'tiktok' : 'youtube', owner: uid(req) }));
    } catch (error: any) {
        await refundUsage((req as any).workspaceId, (req as any).plan || 'starter', 'aiCalls', CREDIT_COSTS.fastImage);
        res.status(error.status || 502).json({ error: error.message || 'The background could not be generated.' });
    }
});

router.post('/render', planRateLimit(), async (req: Request, res: Response) => {
    const entry = candidate(String(req.body?.candidateId || ''), uid(req));
    if (!entry) return res.status(404).json({ error: 'Pick a frame again: this one has expired.' });
    const format = req.body?.format === 'tiktok' ? 'tiktok' : 'youtube';
    const headline = String(req.body?.headline || '').trim().slice(0, 80);
    let accent = /^#[0-9a-f]{6}$/i.test(req.body?.accent || '') ? String(req.body.accent) : undefined;
    let logo: string | null = null;
    try {
        if (req.body?.brand && (req as any).workspaceId) {
            const brand = await loadClipBrand(db, (req as any).workspaceId).catch(() => null);
            if (brand?.accent) accent = brand.accent;
            if (brand?.logoPath && fs.existsSync(brand.logoPath)) logo = `data:image/png;base64,${fs.readFileSync(brand.logoPath).toString('base64')}`;
        }
        const image = await frameImage(entry.path, format, entry.face);
        const png = await renderThumbnail({
            image,
            format,
            headline,
            highlight: String(req.body?.highlight || '').slice(0, 40),
            style: String(req.body?.style || 'punch'),
            accent,
            logo,
            label: String(req.body?.label || '').slice(0, 24),
        });
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.send(png);
    } catch (error: any) {
        console.error('[Thumbnails] render failed:', error.message);
        res.status(500).json({ error: 'The thumbnail could not be made. Try again.' });
    }
});

export default router;
