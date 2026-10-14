import express, { Request, Response } from 'express';
import axios from 'axios';
import { withWorkspace } from '../middleware/withWorkspace';

/**
 * Stock media for the editor.
 *  - Music and images: Openverse (https://api.openverse.org) — free, no API key, CC-licensed.
 *    Anonymous limits are 20 req/min and 200 req/day, so searches are cached.
 *  - Video b-roll: Pexels (free key from https://www.pexels.com/api/) when PEXELS_API_KEY is set.
 *
 * Files are streamed through /file/:provider/:id. The server resolves the download URL
 * from the provider's own API by ID, so clients can never make it fetch arbitrary URLs.
 */
const router = express.Router();

const PEXELS_API_KEY = process.env.PEXELS_API_KEY || '';
const OPENVERSE = 'https://api.openverse.org/v1';
const OPENVERSE_AUDIO_LICENSES = 'by,cc0,pdm';
const MAX_FILE_BYTES = 300 * 1024 * 1024;
const CACHE_MS = 10 * 60 * 1000;

const cache = new Map<string, { expires: number; data: unknown }>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.data as T;
    const data = await load();
    cache.set(key, { expires: Date.now() + CACHE_MS, data });
    if (cache.size > 500) cache.delete(cache.keys().next().value as string);
    return data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function providerError(res: Response, label: string, error: any) {
    const status = error.response?.status;
    console.error(`[Assets] ${label} failed:`, status || '', error.message);
    if (status === 429) return res.status(429).json({ error: `${label}: rate limit reached, try again in a minute.` });
    return res.status(502).json({ error: `${label} is unavailable right now.` });
}

router.use(withWorkspace);

// GET /api/assets/music?q=
router.get('/music', async (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim().slice(0, 100) || 'upbeat';
    try {
        const assets = await cached(`music:${q}`, async () => {
            const { data } = await axios.get(`${OPENVERSE}/audio/`, {
                // CC BY / CC0 / PD only. BY-SA is "commercial" too, but music synced to video is an
                // adaptation under CC 4.0, so it would force the user's video under BY-SA.
                params: { q, page_size: 20, license: OPENVERSE_AUDIO_LICENSES, extension: 'mp3', mature: false },
                timeout: 15000,
            });
            return (data.results || []).map((r: any) => ({
                id: r.id,
                title: r.title || 'Untitled track',
                artist: r.creator || 'Unknown artist',
                duration: r.duration ? r.duration / 1000 : null,
                license: `${String(r.license || '').toUpperCase()} ${r.license_version || ''}`.trim(),
                attribution: r.attribution || '',
                fileUrl: `/api/assets/file/openverse-audio/${r.id}`,
                source: 'openverse',
            }));
        });
        res.json({ success: true, assets });
    } catch (error: any) {
        providerError(res, 'Openverse music search', error);
    }
});

// GET /api/assets/images?q=
router.get('/images', async (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim().slice(0, 100) || 'city';
    try {
        const assets = await cached(`images:${q}`, async () => {
            const { data } = await axios.get(`${OPENVERSE}/images/`, {
                params: { q, page_size: 20, license_type: 'commercial', mature: false },
                timeout: 15000,
            });
            return (data.results || []).map((r: any) => ({
                id: r.id,
                title: r.title || 'Untitled image',
                thumb: r.thumbnail,
                width: r.width,
                height: r.height,
                license: `${String(r.license || '').toUpperCase()} ${r.license_version || ''}`.trim(),
                attribution: r.attribution || '',
                fileUrl: `/api/assets/file/openverse-image/${r.id}`,
                source: 'openverse',
            }));
        });
        res.json({ success: true, assets });
    } catch (error: any) {
        providerError(res, 'Openverse image search', error);
    }
});

/** Picks an MP4 no larger than 1080p, preferring the source's native orientation. */
function pickPexelsFile(video: any) {
    const files = (video.video_files || []).filter((f: any) => f.file_type === 'video/mp4' && f.link);
    const fitting = files.filter((f: any) => Math.max(f.width || 0, f.height || 0) <= 1920);
    return (fitting.length ? fitting : files).sort((a: any, b: any) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0];
}

// GET /api/assets/broll?q=&orientation=portrait|landscape|square
router.get('/broll', async (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim().slice(0, 100) || 'creator';
    const orientation = ['portrait', 'landscape', 'square'].includes(String(req.query.orientation)) ? String(req.query.orientation) : 'portrait';

    if (!PEXELS_API_KEY) {
        return res.json({
            success: true,
            assets: [],
            notice: 'Video b-roll needs a free Pexels API key: sign up at pexels.com/api and set PEXELS_API_KEY in server/.env. Images and music work without a key.',
        });
    }

    try {
        const assets = await cached(`broll:${orientation}:${q}`, async () => {
            const { data } = await axios.get('https://api.pexels.com/videos/search', {
                params: { query: q, per_page: 15, orientation },
                headers: { Authorization: PEXELS_API_KEY },
                timeout: 15000,
            });
            return (data.videos || []).map((video: any) => ({
                id: String(video.id),
                title: video.user?.name ? `Video by ${video.user.name}` : 'Pexels video',
                thumb: video.image,
                duration: video.duration,
                license: 'Pexels License',
                attribution: `Video by ${video.user?.name || 'unknown'} on Pexels`,
                fileUrl: `/api/assets/file/pexels-video/${video.id}`,
                source: 'pexels',
            }));
        });
        res.json({ success: true, assets });
    } catch (error: any) {
        providerError(res, 'Pexels video search', error);
    }
});

async function resolveFileUrl(provider: string, id: string): Promise<string | null> {
    if (provider === 'openverse-audio' || provider === 'openverse-image') {
        if (!UUID.test(id)) return null;
        const kind = provider === 'openverse-audio' ? 'audio' : 'images';
        const { data } = await axios.get(`${OPENVERSE}/${kind}/${id}/`, { timeout: 15000 });
        if (kind === 'audio' && !OPENVERSE_AUDIO_LICENSES.split(',').includes(String(data.license || '').toLowerCase())) return null;
        return data.url || null;
    }
    if (provider === 'pexels-video') {
        if (!/^\d{1,12}$/.test(id) || !PEXELS_API_KEY) return null;
        const { data } = await axios.get(`https://api.pexels.com/videos/videos/${id}`, { headers: { Authorization: PEXELS_API_KEY }, timeout: 15000 });
        return pickPexelsFile(data)?.link || null;
    }
    return null;
}

// GET /api/assets/file/:provider/:id — streams the licensed file to the editor
router.get('/file/:provider/:id', async (req: Request, res: Response) => {
    const provider = String(req.params.provider);
    const id = String(req.params.id);
    try {
        const url = await cached(`file:${provider}:${id}`, () => resolveFileUrl(provider, id));
        if (!url || !/^https:\/\//i.test(url)) return res.status(404).json({ error: 'Asset not found' });

        const upstream = await axios.get(url, {
            responseType: 'stream',
            timeout: 60000,
            maxRedirects: 5,
            beforeRedirect: (options: any) => {
                if (options.protocol !== 'https:') throw new Error('Refusing non-HTTPS redirect');
            },
        });
        const length = Number(upstream.headers['content-length'] || 0);
        if (length > MAX_FILE_BYTES) {
            upstream.data.destroy();
            return res.status(413).json({ error: 'This file is too large to import.' });
        }
        res.setHeader('Content-Type', upstream.headers['content-type'] || 'application/octet-stream');
        if (length) res.setHeader('Content-Length', String(length));
        let sent = 0;
        upstream.data.on('data', (chunk: Buffer) => {
            sent += chunk.length;
            if (sent > MAX_FILE_BYTES) upstream.data.destroy(new Error('File too large'));
        });
        upstream.data.on('error', () => res.destroy());
        upstream.data.pipe(res);
    } catch (error: any) {
        providerError(res, 'Asset download', error);
    }
});

export default router;
