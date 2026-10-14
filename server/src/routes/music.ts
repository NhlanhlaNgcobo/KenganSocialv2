import express, { Request, Response } from 'express';
import { withWorkspace } from '../middleware/withWorkspace';
import { getSongFile, getSong, getSongGenres, searchSongs } from '../services/songs-library.js';

/**
 * Songs with vocals by independent artists (ccMixter + Openverse, CC BY / CC0 only).
 *  GET /api/music/songs/genres   → genres, vocal filters, licences
 *  GET /api/music/songs          → ?genre=&vocals=any|female|male&q=&page=&explicit=1
 *  GET /api/music/songs/file/:id → the mp3 (cached on disk)
 */
const router = express.Router();
router.use(withWorkspace);

function fail(res: Response, label: string, error: any) {
    console.error(`[Music] ${label} failed:`, error.message);
    res.status(error.status || 502).json({ error: error.status ? error.message : 'The music library is unavailable right now.' });
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

router.get('/songs/genres', (_req: Request, res: Response) => {
    res.json({ success: true, ...getSongGenres() });
});

router.get('/songs', async (req: Request, res: Response) => {
    try {
        const result = await searchSongs({
            genre: text(req.query.genre, 40),
            vocals: text(req.query.vocals, 10) || 'any',
            q: text(req.query.q, 80),
            page: Number(req.query.page) || 1,
            explicit: req.query.explicit === '1',
        });
        res.json({ success: true, ...result });
    } catch (error: any) {
        fail(res, 'Song search', error);
    }
});

router.get('/songs/file/:id', async (req: Request, res: Response) => {
    try {
        const track = await getSong(String(req.params.id));
        if (!track) return res.status(404).json({ error: 'Song not found' });
        const file = await getSongFile(track);
        res.setHeader('Cache-Control', 'private, max-age=86400');
        res.type('audio/mpeg').sendFile(file);
    } catch (error: any) {
        fail(res, 'Song download', error);
    }
});

export default router;
