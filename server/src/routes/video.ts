import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { db } from '../utils/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getUploadPath, storeUpload } from '../services/manual-edit.service.js';
import { AUTOFRAME_RATIOS, convertForEditing, enhanceVideo } from '../services/video-enhance.service.js';
import { hasCleanup, normalizeCleanup } from '../services/clip-cleanup.js';

const router = express.Router();
const PYTHON_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';

import { withWorkspace } from '../middleware/withWorkspace';
import { checkLimit, consumeUsage, planRateLimit } from '../middleware/planGate';
import { probe } from '../services/ffmpeg-runner.js';
import { transcriptionMinutes } from '../utils/planLimits';
import { requireOwnedUpload } from '../middleware/ownedUpload.js';

// POST /api/video/process
// Canonical video pipeline v2:
// upload in editor -> /api/video/process -> Python local-first transcription + analysis ->
// Firestore render_jobs updates -> editor snapshot listener -> /api/video/manual-edit export.
router.post('/process', withWorkspace, planRateLimit(), checkLimit('renders'), async (req: Request, res: Response) => {
    const { sourceUploadId = null, analysisPreferences = {}, stylePreset = null } = req.body;
    const workspaceId = (req as any).workspaceId;
    const uid = (req as any).uid;
    const plan = (req as any).plan;

    // Only server-side uploads owned by the caller are analysed; arbitrary URLs are
    // never forwarded to the processing service.
    if (!sourceUploadId || typeof sourceUploadId !== 'string') {
        return res.status(400).json({ error: 'Upload the video before running AI tools.' });
    }
    const analysisInputUrl = getUploadPath(sourceUploadId, uid);
    if (!analysisInputUrl) {
        return res.status(400).json({ error: 'Source not found for this upload. Re-upload the file and try again.' });
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    // Initialise job in Firestore
    await db.collection('render_jobs').doc(jobId).set({
        jobId,
        workspaceId,
        userId: uid,
        status: 'transcribing',
        progress: 0,
        createdAt: FieldValue.serverTimestamp(),
        type: 'process_pipeline',
        analysisPreferences,
        stylePreset
    });

    // Start background processing
    (async () => {
        try {
            // 1. Transcribe
            const transcribeRes = await axios.post(`${PYTHON_URL}/process/transcribe`, {
                videoUrl: analysisInputUrl, jobId, workspaceId, plan, analysisPreferences
            });

            // Update with transcription results
            await db.collection('render_jobs').doc(jobId).update({
                transcription: transcribeRes.data,
                status: 'analyzing',
                progress: 50
            });

            const shouldRunClipAnalysis =
                plan === 'creator' ||
                plan === 'agency' ||
                analysisPreferences?.mode === 'auto-edit';

            // 2. Viral Analysis / auto-edit highlight detection
            if (shouldRunClipAnalysis) {
                const viralRes = await axios.post(`${PYTHON_URL}/process/analyze-viral`, {
                    videoUrl: analysisInputUrl, jobId, workspaceId, plan, analysisPreferences, stylePreset
                });
                await db.collection('render_jobs').doc(jobId).update({
                    viralClips: viralRes.data.clips,
                    blackFrameSegments: viralRes.data.blackFrameSegments || [],
                    silenceSegments: viralRes.data.silenceSegments || [],
                    keepSegments: viralRes.data.keepSegments || viralRes.data.clips || [],
                    editDecisions: viralRes.data.editDecisions || [],
                    analysisProvider: viralRes.data.analysisProvider || 'local',
                    status: 'ready',
                    progress: 100
                });
            } else {
                // Done
                await db.collection('render_jobs').doc(jobId).update({
                    status: 'ready',
                    progress: 100
                });
            }

        } catch (error: any) {
            console.error('[Video Processing Error]', error?.response?.data || error);
            await db.collection('render_jobs').doc(jobId).update({
                status: 'failed',
                error: error?.response?.data?.error || error.message
            });
        }
    })();

    // Respond immediately
    res.json({ success: true, jobId, message: 'Processing started in background' });
});

// POST /api/video/enhance — clean up, stabilize, auto-frame and/or remove the background of an uploaded clip into a new file.
// Poll /api/video/manual-edit/status/:jobId; the result is also registered as a new upload.
router.post('/enhance', withWorkspace, planRateLimit(), checkLimit('renders'), async (req: Request, res: Response) => {
    const uid = (req as any).uid;
    const { sourceUploadId, stabilize, autoframe, cleanup, removeBackground } = req.body || {};

    const wantsStabilize = !!stabilize?.enabled;
    const wantsAutoframe = !!autoframe?.enabled;
    const wantsCleanup = !!cleanup?.enabled && hasCleanup(normalizeCleanup(cleanup));
    const wantsRemoveBackground = removeBackground?.enabled === true;
    if (!wantsStabilize && !wantsAutoframe && !wantsCleanup && !wantsRemoveBackground) {
        return res.status(400).json({ error: 'Choose at least one enhancement: clean-up, stabilize, auto-frame or background removal.' });
    }
    if (wantsAutoframe && !AUTOFRAME_RATIOS.includes(autoframe.ratio)) {
        return res.status(400).json({ error: `Auto-frame ratio must be one of ${AUTOFRAME_RATIOS.join(', ')}.` });
    }
    const inputPath = typeof sourceUploadId === 'string' ? getUploadPath(sourceUploadId, uid) : null;
    if (!inputPath) {
        return res.status(400).json({ error: 'Source not found for this upload. Re-upload the file and try again.' });
    }

    const jobId = uuidv4();
    const jobRef = db.collection('manual_edit_jobs').doc(jobId);
    await jobRef.set({ id: jobId, userId: uid, type: 'enhance', status: 'processing', progress: 0, createdAt: new Date().toISOString() });
    res.status(202).json({ jobId, status: 'processing' });

    let lastProgress = -1;
    try {
        const { outputPath, summary } = await enhanceVideo({
            inputPath,
            jobId,
            // mode, strength, zoomMode, zoom, edgeFill, correctRotation — validated in the service
            stabilize: wantsStabilize ? stabilize : null,
            autoframe: wantsAutoframe ? { ratio: autoframe.ratio } : null,
            cleanup: wantsCleanup ? cleanup : null,
            removeBackground: wantsRemoveBackground,
            onProgress: (progress: number) => {
                if (progress === lastProgress) return;
                lastProgress = progress;
                jobRef.update({ progress }).catch(() => {});
            },
        });
        const outputUploadId = uuidv4();
        storeUpload(outputUploadId, outputPath, uid);
        const filename = path.basename(outputPath);
        await jobRef.update({
            status: 'completed',
            progress: 100,
            outputPath,
            outputFilename: filename,
            downloadUrl: `/api/video/manual-edit/download/${filename}`,
            outputUploadId,
            summary,
            updatedAt: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error(`[Enhance] Job ${jobId} failed:`, error.message);
        await jobRef.update({ status: 'failed', error: error.message, updatedAt: new Date().toISOString() }).catch(() => {});
    }
});

// POST /api/video/convert — re-encodes an upload the browser cannot show (ProRes and other camera
// formats) to H.264 MP4 for the editor. Poll /api/video/manual-edit/status/:jobId; the result is
// registered as a new upload. Not counted as a render: it only fixes the file format.
router.post('/convert', withWorkspace, planRateLimit(), async (req: Request, res: Response) => {
    const uid = (req as any).uid;
    const { sourceUploadId } = req.body || {};
    const inputPath = typeof sourceUploadId === 'string' ? getUploadPath(sourceUploadId, uid) : null;
    if (!inputPath) return res.status(400).json({ error: 'Source not found for this upload. Re-upload the file and try again.' });

    const jobId = uuidv4();
    const jobRef = db.collection('manual_edit_jobs').doc(jobId);
    await jobRef.set({ id: jobId, userId: uid, type: 'convert', status: 'processing', progress: 0, createdAt: new Date().toISOString() });
    res.status(202).json({ jobId, status: 'processing' });

    let lastProgress = -1;
    try {
        const outputPath = await convertForEditing(inputPath, (progress: number) => {
            if (progress === lastProgress) return;
            lastProgress = progress;
            jobRef.update({ progress }).catch(() => {});
        });
        const outputUploadId = uuidv4();
        storeUpload(outputUploadId, outputPath, uid);
        const filename = path.basename(outputPath);
        await jobRef.update({
            status: 'completed',
            progress: 100,
            outputPath,
            outputFilename: filename,
            downloadUrl: `/api/video/manual-edit/download/${filename}`,
            outputUploadId,
            updatedAt: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error(`[Convert] Job ${jobId} failed:`, error.message);
        await jobRef.update({ status: 'failed', error: 'This video could not be converted. Try exporting it as MP4 (H.264) from your camera app.', updatedAt: new Date().toISOString() }).catch(() => {});
    }
});

// GET /api/video/jobs/:jobId — status of a /process job, for polling clients
router.get('/jobs/:jobId', withWorkspace, async (req: Request, res: Response) => {
    const snap = await db.collection('render_jobs').doc(String(req.params.jobId)).get();
    const job = snap.data();
    if (!snap.exists || !job || job.workspaceId !== (req as any).workspaceId) {
        return res.status(404).json({ error: 'Job not found' });
    }
    res.json({
        job: {
            jobId: job.jobId,
            status: job.status,
            progress: job.progress ?? 0,
            error: job.error ?? null,
            transcription: job.transcription ?? null,
            viralClips: job.viralClips ?? null,
            keepSegments: job.keepSegments ?? null,
            silenceSegments: job.silenceSegments ?? null,
        },
    });
});

// POST /api/video/transcribe
router.post('/transcribe', withWorkspace, requireOwnedUpload, planRateLimit(), async (req: Request, res: Response) => {
    const videoUrl = (req as any).sourcePath;
    const workspaceId = (req as any).workspaceId;

    if (!videoUrl) return res.status(400).json({ error: 'Missing videoUrl' });
    // Charged by the minute of audio, not per request.
    const seconds = (await probe(videoUrl).catch(() => ({ duration: 0 }))).duration || 0;
    const usage = await consumeUsage(workspaceId, (req as any).plan || 'starter', 'transcribeMinutes', transcriptionMinutes(seconds));
    if (!usage.ok) return res.status(usage.status).json(usage.body);

    const jobId = `transcribe_${Date.now()}`;
    await db.collection('render_jobs').doc(jobId).set({
        jobId, workspaceId, status: 'transcribing', progress: 10, createdAt: FieldValue.serverTimestamp(), type: 'standalone_transcribe'
    });

    (async () => {
        try {
            const res = await axios.post(`${PYTHON_URL}/process/transcribe`, { videoUrl, jobId, workspaceId });
            await db.collection('render_jobs').doc(jobId).update({ transcription: res.data, status: 'ready', progress: 100 });
        } catch (e: any) {
            await db.collection('render_jobs').doc(jobId).update({ status: 'failed', error: e.message });
        }
    })();

    res.json({ success: true, jobId });
});

// POST /api/video/analyze-viral
router.post('/analyze-viral', withWorkspace, requireOwnedUpload, planRateLimit(), checkLimit('clipAnalysis'), async (req: Request, res: Response) => {
    const { transcript } = req.body;
    const videoUrl = (req as any).sourcePath;
    const workspaceId = (req as any).workspaceId;

    const jobId = `analysis_${Date.now()}`;
    await db.collection('render_jobs').doc(jobId).set({
        jobId, workspaceId, status: 'analyzing', progress: 10, createdAt: FieldValue.serverTimestamp(), type: 'standalone_analysis'
    });

    (async () => {
        try {
            const res = await axios.post(`${PYTHON_URL}/process/analyze-viral`, { transcript, videoUrl, jobId, workspaceId });
            await db.collection('render_jobs').doc(jobId).update({ viralClips: res.data.clips, status: 'ready', progress: 100 });
        } catch (e: any) {
            await db.collection('render_jobs').doc(jobId).update({ status: 'failed', error: e.message });
        }
    })();

    res.json({ success: true, jobId });
});

// Retired endpoint: the editor exports through the authenticated manual-edit pipeline.
// Return before charging usage or writing any job document.
router.post('/export', withWorkspace, (_req: Request, res: Response) => {
    res.status(410).json({ error: 'EXPORT_ENDPOINT_RETIRED', message: 'Export through the video editor.' });
});

export default router;
