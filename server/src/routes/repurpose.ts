import express from 'express';
import type { Request, Response } from 'express';
import { withWorkspace } from '../middleware/withWorkspace';
import { checkLimit, planRateLimit } from '../middleware/planGate';
import { fetchArticle } from '../services/repurpose/extract.js';
import { generateDrafts, PLATFORMS, TONES } from '../services/repurpose/generate.js';

/**
 * Repurpose: one source (article link, pasted text or a clip transcript) → native
 * posts per platform. Scheduling uses the existing /api/schedule endpoints.
 *  GET  /api/repurpose/options
 *  POST /api/repurpose   { source: { type: 'url'|'text', url?, text?, title? }, platforms, tone, audience?, cta? }
 */
const router = express.Router();

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

router.get('/options', withWorkspace, (_req: Request, res: Response) => {
    res.json({
        platforms: Object.entries(PLATFORMS as Record<string, { label: string; schedulable: boolean }>).map(([id, p]) => ({ id, label: p.label, schedulable: p.schedulable })),
        tones: TONES,
    });
});

router.post('/', withWorkspace, planRateLimit(), checkLimit('aiCalls'), async (req: Request, res: Response) => {
    const body = req.body || {};
    const source = body.source || {};
    const platforms: string[] = Array.isArray(body.platforms) ? body.platforms.filter((p: unknown) => typeof p === 'string' && (PLATFORMS as any)[p]).slice(0, 7) : [];
    if (!platforms.length) return res.status(400).json({ error: 'Choose at least one platform.' });
    const tone = (TONES as string[]).includes(body.tone) ? body.tone : 'Friendly';

    try {
        let title = text(source.title, 200);
        let content = '';
        let origin: Record<string, string> | null = null;
        if (source.type === 'url') {
            const article = await fetchArticle(text(source.url, 600));
            title = article.title || title;
            content = [article.description, article.text].filter(Boolean).join('\n\n');
            origin = { url: article.url, siteName: article.siteName };
        } else {
            content = text(source.text, 14000);
            if (content.length < 80) return res.status(400).json({ error: 'Add a bit more text (a paragraph or more) to repurpose.' });
        }

        const result = await generateDrafts({ title, text: content, platforms, tone, audience: text(body.audience, 120), cta: text(body.cta, 160) });
        res.json({ success: true, title, origin, ...result });
    } catch (error: any) {
        const status = error.status || 500;
        if (status >= 500) console.error('[Repurpose] Failed:', error.message);
        res.status(status).json({ error: status >= 500 ? 'The writer is unavailable right now. Try again in a minute.' : error.message });
    }
});

export default router;
