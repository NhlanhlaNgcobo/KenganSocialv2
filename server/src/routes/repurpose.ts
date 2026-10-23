import { features, YOUTUBE_LINK_IMPORT_OFF } from '../utils/features';
import express from 'express';
import type { Request, Response } from 'express';
import { withWorkspace } from '../middleware/withWorkspace';
import { checkLimit, consumeUsage, planRateLimit } from '../middleware/planGate';
import { MAX_SOURCE_MINUTES, transcriptionMinutes } from '../utils/planLimits';
import { probe } from '../services/ffmpeg-runner.js';
import { getUploadPath } from '../services/manual-edit.service.js';
import { fetchArticle, fetchYouTubeText, isYouTubeUrl, transcribeUpload } from '../services/repurpose/extract.js';
import { generateDrafts, PLATFORMS, TONES } from '../services/repurpose/generate.js';

/**
 * Repurpose: one source (article link, pasted text or a clip transcript) → native
 * posts per platform. Scheduling uses the existing /api/schedule endpoints.
 *  GET  /api/repurpose/options
 *  POST /api/repurpose   { source: { type: 'url'|'text'|'upload', url?, text?, uploadId?, title? }, platforms, tone, audience?, cta?, rightsConfirmed? }
 * An uploaded video (uploadId from /api/video/manual-edit/upload) is transcribed: the fallback when YouTube blocks a link.
 * A YouTube video link is read from its captions (or transcribed) and needs rightsConfirmed: true.
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
        if (source.type === 'url' && isYouTubeUrl(source.url)) {
            if (!features.youtubeLinkImport()) return res.status(403).json({ error: YOUTUBE_LINK_IMPORT_OFF, code: 'YOUTUBE_LINK_IMPORT_OFF' });
            if (body.rightsConfirmed !== true) {
                return res.status(400).json({ error: 'Confirm that you own this video or have permission to repurpose it.' });
            }
            const video = await fetchYouTubeText(text(source.url, 600), (req as any).plan);
            title = video.title || title;
            content = [video.description ? `Video description: ${String(video.description).slice(0, 600)}` : '', video.text].filter(Boolean).join('\n\n');
            origin = { url: text(source.url, 600), siteName: video.channel || 'YouTube', kind: 'youtube', textSource: video.source };
        } else if (source.type === 'upload') {
            const filePath = typeof source.uploadId === 'string' ? getUploadPath(source.uploadId, (req as any).uid) : null;
            if (!filePath) return res.status(400).json({ error: 'Upload the video first. If you already did, upload it again.' });
            const plan = (req as any).plan;
            const seconds = (await probe(filePath).catch(() => ({ duration: 0 }))).duration || 0;
            const maxMinutes = (MAX_SOURCE_MINUTES as any)[plan] ?? 0;
            if (seconds / 60 > Math.max(maxMinutes, 10)) {
                return res.status(402).json({ error: `This video is ${Math.round(seconds / 60)} minutes long. Your plan transcribes videos of up to ${Math.max(maxMinutes, 10)} minutes here.` });
            }
            const usage = await consumeUsage((req as any).workspaceId, plan, 'transcribeMinutes', transcriptionMinutes(seconds));
            if (!usage.ok) return res.status(usage.status).json(usage.body);
            content = await transcribeUpload(filePath, { plan, workspaceId: (req as any).workspaceId });
            title = title || text(source.name, 150) || 'Video';
            origin = { url: '', siteName: 'Uploaded video', kind: 'upload', textSource: 'transcription' };
        } else if (source.type === 'url') {
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
        // No AI provider configured is a setup problem, not a temporary outage: say so.
        if (/No AI provider is configured/i.test(error.message || '')) {
            return res.status(503).json({ error: 'AI is not set up on the server yet. Add OPENROUTER_API_KEY or GEMINI_API_KEY to server/.env.' });
        }
        const status = error.status || 500;
        if (status >= 500) console.error('[Repurpose] Failed:', error.message);
        res.status(status).json({ error: status >= 500 ? 'The writer is unavailable right now. Try again in a minute.' : error.message, ...(error.code ? { code: error.code } : {}) });
    }
});

export default router;
