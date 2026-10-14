import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { db } from '../utils/firestore';
import admin from 'firebase-admin';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getUploadPath, storeUpload } from '../services/manual-edit.service.js';
import { AUTOFRAME_RATIOS, enhanceVideo } from '../services/video-enhance.service.js';

const router = express.Router();
const PYTHON_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';

import { withWorkspace } from '../middleware/withWorkspace';
import { checkLimit, planRateLimit } from '../middleware/planGate';

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
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
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

// POST /api/video/enhance — stabilize and/or auto-frame an uploaded clip into a new file.
// Poll /api/video/manual-edit/status/:jobId; the result is also registered as a new upload.
router.post('/enhance', withWorkspace, planRateLimit(), checkLimit('renders'), async (req: Request, res: Response) => {
    const uid = (req as any).uid;
    const { sourceUploadId, stabilize, autoframe } = req.body || {};

    const wantsStabilize = !!stabilize?.enabled;
    const wantsAutoframe = !!autoframe?.enabled;
    if (!wantsStabilize && !wantsAutoframe) {
        return res.status(400).json({ error: 'Choose stabilize, auto-frame, or both.' });
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
router.post('/transcribe', withWorkspace, planRateLimit(), checkLimit('transcribeHrs'), async (req: Request, res: Response) => {
    const { videoUrl } = req.body;
    const workspaceId = (req as any).workspaceId;

    if (!videoUrl) return res.status(400).json({ error: 'Missing videoUrl' });

    const jobId = `transcribe_${Date.now()}`;
    await db.collection('render_jobs').doc(jobId).set({
        jobId, workspaceId, status: 'transcribing', progress: 10, createdAt: admin.firestore.FieldValue.serverTimestamp(), type: 'standalone_transcribe'
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
router.post('/analyze-viral', withWorkspace, planRateLimit(), checkLimit('clipAnalysis'), async (req: Request, res: Response) => {
    const { transcript, videoUrl } = req.body;
    const workspaceId = (req as any).workspaceId;

    const jobId = `analysis_${Date.now()}`;
    await db.collection('render_jobs').doc(jobId).set({
        jobId, workspaceId, status: 'analyzing', progress: 10, createdAt: admin.firestore.FieldValue.serverTimestamp(), type: 'standalone_analysis'
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

// POST /api/video/export
router.post('/export', withWorkspace, planRateLimit(), checkLimit('exports'), async (req: Request, res: Response) => {
    const { jobId, format = 'mp4', quality = '1080p' } = req.body;
    const workspaceId = (req as any).workspaceId;

    const exportId = `export_${Date.now()}`;
    await db.collection('render_jobs').doc(jobId).collection('exports').doc(exportId).set({
        exportId, status: 'exporting', progress: 0, format, quality, createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    (async () => {
        try {
            // Forward to Python export engine
            await axios.post(`${PYTHON_URL}/process/export`, { jobId, exportId, workspaceId, format, quality });
        } catch (e: any) {
            await db.collection('render_jobs').doc(jobId).collection('exports').doc(exportId).update({ status: 'failed', error: e.message });
        }
    })();

    res.json({ success: true, exportId, message: 'Export initiated' });
});

export default router;
