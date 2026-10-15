import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../utils/firestore';
import { withWorkspace } from '../middleware/withWorkspace';
import { checkLimit, planRateLimit } from '../middleware/planGate';
import { storeUpload } from '../services/manual-edit.service.js';
import { createLaunchVideo, MOODS, normalizeLaunchRequest, TONE_MOOD, TONES } from '../services/brag/index.js';

/**
 * Launch and tutorial videos, after /brag (github.com/latent-spaces/brag, MIT).
 *  GET  /api/brag/tones   tones with their default music mood, and the moods
 *  POST /api/brag         { kind: launch|tutorial, url, name, description, focus, tone, format, duration, music, mood, musicTrackId }
 * POST returns a job id; poll /api/video/manual-edit/status/:jobId; download from its downloadUrl.
 */
const router = express.Router();

// Each render drives a headless Chrome, so run them one at a time.
let running = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = running.then(task, task);
    running = next.then(() => undefined, () => undefined);
    return next;
}

router.get('/tones', withWorkspace, (_req: Request, res: Response) => {
    res.json({
        tones: Object.entries(TONES as Record<string, { feel: string; pacing: string }>).map(([id, t]) => ({ id, feel: t.feel, pacing: t.pacing, mood: (TONE_MOOD as any)[id] || 'upbeat' })),
        moods: Object.entries(MOODS as Record<string, { label: string; description: string }>).map(([id, m]) => ({ id, label: m.label, description: m.description })),
    });
});

router.post('/', withWorkspace, planRateLimit(), checkLimit('renders'), async (req: Request, res: Response) => {
    let request;
    try {
        request = normalizeLaunchRequest(req.body);
    } catch (error: any) {
        return res.status(error.status || 400).json({ error: error.message });
    }

    const uid = (req as any).uid;
    const jobId = uuidv4();
    const jobRef = db.collection('manual_edit_jobs').doc(jobId);
    await jobRef.set({
        id: jobId,
        userId: uid,
        workspaceId: (req as any).workspaceId,
        type: request.kind === 'tutorial' ? 'tutorial' : 'launch',
        status: 'processing',
        stage: 'Queued',
        progress: 0,
        request: { kind: request.kind, url: request.url, name: request.name, tone: request.tone, format: request.format, duration: request.duration, mood: request.mood },
        createdAt: new Date().toISOString(),
    });
    res.status(202).json({ jobId, status: 'processing' });

    let lastWrite = 0;
    const update = (data: Record<string, unknown>, force = false) => {
        const now = Date.now();
        if (!force && now - lastWrite < 1000) return;
        lastWrite = now;
        jobRef.update(data).catch(() => {});
    };

    try {
        const result: any = await enqueue(() =>
            createLaunchVideo(request, {
                onStage: (stage: string, progress: number) => update({ stage, progress }, true),
                onProgress: (progress: number) => update({ progress }),
            })
        );
        const outputUploadId = uuidv4();
        storeUpload(outputUploadId, result.outputPath, uid);
        const filename = path.basename(result.outputPath);
        const poster = fs.existsSync(result.posterPath) ? `data:image/jpeg;base64,${fs.readFileSync(result.posterPath).toString('base64')}` : null;
        await jobRef.update({
            status: 'completed',
            stage: 'Done',
            progress: 100,
            outputPath: result.outputPath,
            outputFilename: filename,
            downloadUrl: `/api/video/manual-edit/download/${filename}`,
            outputUploadId,
            poster,
            plan: result.plan,
            planner: result.planner,
            shareCopy: result.shareCopy,
            musicCredit: result.musicCredit,
            musicTrackId: result.musicTrackId,
            musicMood: result.musicMood,
            musicBpm: result.musicBpm,
            summary: { width: result.width, height: result.height, seconds: Math.round((result.durationInFrames / result.fps) * 10) / 10 },
            updatedAt: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error(`[Brag] Job ${jobId} failed:`, error.message);
        await jobRef.update({ status: 'failed', stage: 'Failed', error: error.message, updatedAt: new Date().toISOString() }).catch(() => {});
    }
});

export default router;
