import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { withWorkspace } from '../middleware/withWorkspace';
import { analyzeLyrics } from '../services/lyrics/analyze.js';

/**
 * POST /api/lyrics/analyze (multipart)
 *  - file      optional audio (transcribed with Whisper, or an OpenRouter audio model)
 *  - lyrics    optional pasted lyrics; LRC timestamps are honoured
 *  - duration  song length in seconds (measured in the browser)
 *  - energy    optional mean loudness 0..1, used as a mood hint
 * → LyricAnalysis (see client/src/editor/lib/lyrics.ts)
 */
const router = express.Router();

// Whisper's upload ceiling; kept in memory because it goes straight to the transcriber.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
        const ok = file.mimetype.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.originalname);
        cb(ok ? null : new Error('Upload an audio file (mp3, wav, m4a, aac, ogg, or flac).'));
    },
});

function handleUpload(req: Request, res: Response, next: NextFunction) {
    upload.single('file')(req, res, (error: any) => {
        if (!error) return next();
        const message = error.code === 'LIMIT_FILE_SIZE' ? 'Audio must be 25 MB or smaller for lyric transcription.' : error.message;
        res.status(400).json({ error: message });
    });
}

router.post('/analyze', withWorkspace, handleUpload, async (req: Request, res: Response) => {
    try {
        const energy = Number(req.body.energy);
        const analysis = await analyzeLyrics({
            audio: req.file ?? null,
            lyrics: typeof req.body.lyrics === 'string' ? req.body.lyrics.slice(0, 20_000) : '',
            duration: Number(req.body.duration),
            energy: Number.isFinite(energy) ? energy : undefined,
        });
        res.json(analysis);
    } catch (error: any) {
        if (error.status === 400) return res.status(400).json({ error: error.message });
        console.error('[Lyrics] Analyze failed:', error.message);
        res.status(502).json({ error: 'Lyric analysis failed. Try again, or paste the lyrics.' });
    }
});

export default router;
