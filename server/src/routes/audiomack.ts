import crypto from 'crypto';
import express, { Request, Response } from 'express';
import { withWorkspace } from '../middleware/withWorkspace';
import { AudiomackNotConfiguredError, audiomackConfigured, getPlayUrl, searchSongs } from '../services/audiomack.js';

/**
 * Audiomack guide tracks for the editor (stream-only, never exported).
 *  GET  /api/audiomack/status       → { configured }
 *  GET  /api/audiomack/search?q=    → { configured, tracks }
 *  POST /api/audiomack/play/:id     → { url }  (short-lived stream URL)
 */
const router = express.Router();
router.use(withWorkspace);

function fail(res: Response, label: string, error: any) {
    if (error instanceof AudiomackNotConfiguredError) {
        return res.status(503).json({ error: error.message });
    }
    console.error(`[Audiomack] ${label} failed:`, error.message);
    res.status(502).json({ error: 'Audiomack is unavailable right now.' });
}

router.get('/status', (_req: Request, res: Response) => {
    res.json({ configured: audiomackConfigured() });
});

router.get('/search', async (req: Request, res: Response) => {
    if (!audiomackConfigured()) return res.json({ configured: false, tracks: [] });

    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (query.length < 2) return res.status(400).json({ error: 'Type at least 2 characters to search Audiomack.' });
    if (query.length > 120) return res.status(400).json({ error: 'Search is too long.' });

    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        res.json({ configured: true, tracks: await searchSongs(query, page) });
    } catch (error: any) {
        fail(res, 'Search', error);
    }
});

router.post('/play/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid Audiomack track id.' });

    try {
        // Stable per-user session id for Audiomack's play accounting, without exposing the uid.
        const sessionId = crypto.createHash('sha256').update(String((req as any).uid)).digest('hex').slice(0, 32);
        res.json({ url: await getPlayUrl(id, sessionId) });
    } catch (error: any) {
        fail(res, 'Play', error);
    }
});

export default router;
