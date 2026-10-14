import express, { Request, Response } from 'express';
import { withWorkspace } from '../middleware/withWorkspace';
import { getSummary, getTrack, getTrackFile, searchLibrary } from '../services/music-library.js';

/**
 * Royalty-free music library (Kevin MacLeod / incompetech.com, CC BY 4.0).
 *  GET /api/music            → genres, moods, lengths, licence
 *  GET /api/music/tracks     → ?genre=&mood=&q=&length=short|medium|long&page=
 *  GET /api/music/file/:id   → the mp3 (cached on disk, supports Range)
 */
const router = express.Router();
router.use(withWorkspace);

function fail(res: Response, label: string, error: any) {
    console.error(`[Music] ${label} failed:`, error.message);
    res.status(error.status || 502).json({ error: error.status ? error.message : 'The music library is unavailable right now.' });
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

router.get('/', async (_req: Request, res: Response) => {
    try {
        res.json({ success: true, ...(await getSummary()) });
    } catch (error: any) {
        fail(res, 'Summary', error);
    }
});

router.get('/tracks', async (req: Request, res: Response) => {
    try {
        const result = await searchLibrary({
            genre: text(req.query.genre, 40),
            mood: text(req.query.mood, 40),
            q: text(req.query.q, 100),
            length: text(req.query.length, 10),
            page: Number(req.query.page) || 1,
        });
        res.json({ success: true, ...result });
    } catch (error: any) {
        fail(res, 'Search', error);
    }
});

router.get('/file/:id', async (req: Request, res: Response) => {
    try {
        const track = await getTrack(String(req.params.id));
        if (!track) return res.status(404).json({ error: 'Track not found' });
        const file = await getTrackFile(track);
        res.setHeader('Cache-Control', 'private, max-age=86400');
        res.type('audio/mpeg').sendFile(file);
    } catch (error: any) {
        fail(res, 'Download', error);
    }
});

export default router;
