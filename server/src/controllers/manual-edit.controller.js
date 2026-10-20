import { getFirestore } from '../config/firebase.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    storeUpload,
    getUploadPath,
    processEditConfig,
} from '../services/manual-edit.service.js';
import { normalizeTimelineConfig, renderTimeline } from '../services/timeline-render.service.js';

const RENDER_DIR = path.join(os.tmpdir(), 'kengan-renders');
if (!fs.existsSync(RENDER_DIR)) fs.mkdirSync(RENDER_DIR, { recursive: true });

// -------------------------------------------------------
// POST /api/video/manual-edit/upload
// Upload a source video, store it, return an uploadId
// -------------------------------------------------------
export async function uploadSourceVideo(req, res) {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No video file uploaded' });
        }

        const uploadId = uuidv4();
        const stablePath = path.join(RENDER_DIR, `source_${uploadId}${path.extname(file.originalname || '.mp4')}`);

        // Move from multer temp to stable location
        fs.copyFileSync(file.path, stablePath);
        try { fs.unlinkSync(file.path); } catch { }

        // Store the mapping, bound to the uploading user
        storeUpload(uploadId, stablePath, req.user.uid);

        console.log(`[ManualEdit] Upload stored: ${uploadId} → ${stablePath}`);

        res.json({
            uploadId,
            filename: file.originalname,
            size: file.size,
        });
    } catch (error) {
        console.error('[ManualEdit] Upload error:', error);
        res.status(500).json({ error: error.message || 'Upload failed' });
    }
}

// -------------------------------------------------------
// POST /api/video/manual-edit
// Accept edit config JSON, start background processing
// -------------------------------------------------------
export async function processManualEdit(req, res) {
    try {
        const editConfig = req.body;
        const isTimeline = editConfig?.version === 2;

        if (isTimeline) {
            // Validates structure, limits and source ownership before a job is created.
            try {
                normalizeTimelineConfig(editConfig, req.user.uid);
            } catch (validationError) {
                return res.status(validationError.status || 400).json({ error: validationError.message });
            }
        } else {
            if (!editConfig || !editConfig.clips || editConfig.clips.length === 0) {
                return res.status(400).json({ error: 'Edit config must contain at least one clip' });
            }

            // Validate all sources exist
            for (const clip of editConfig.clips) {
                const clipPath = getUploadPath(clip.source, req.user.uid);
                if (!clipPath || !fs.existsSync(clipPath)) {
                    return res.status(400).json({
                        error: `Source video not found for upload ID: ${clip.source}. Upload the video first.`
                    });
                }
            }
        }

        const db = getFirestore();
        const jobId = uuidv4();

        // Create the job record
        await db.collection('manual_edit_jobs').doc(jobId).set({
            id: jobId,
            userId: req.user.uid,
            status: 'processing',
            progress: 0,
            // A summary only: full configs can hold LUT tables and nested curve points, which
            // Firestore cannot store (nested arrays, 1 MB documents).
            editSummary: {
                version: editConfig.version || 1,
                exportFormat: editConfig.exportFormat || null,
                duration: Number(editConfig.duration) || null,
                clips: Array.isArray(editConfig.main) ? editConfig.main.length : Array.isArray(editConfig.clips) ? editConfig.clips.length : 0,
                texts: Array.isArray(editConfig.text) ? editConfig.text.length : 0,
            },
            createdAt: new Date().toISOString(),
        });

        // Return immediately — processing runs in background
        res.status(202).json({
            jobId,
            status: 'processing',
            message: 'Edit processing started. Poll /api/video/manual-edit/status/:jobId for progress.',
        });

        // ---- Background Processing ----
        const jobRef = db.collection('manual_edit_jobs').doc(jobId);

        // Throttle progress writes to one per percent step.
        let lastProgress = -1;
        const onProgress = async (progress) => {
            if (progress === lastProgress) return;
            lastProgress = progress;
            try {
                await jobRef.update({ progress });
            } catch { }
        };

        try {
            const outputPath = isTimeline
                ? await renderTimeline(editConfig, req.user.uid, onProgress)
                : await processEditConfig(editConfig, onProgress);

            const filename = path.basename(outputPath);

            await jobRef.update({
                status: 'completed',
                progress: 100,
                outputPath,
                outputFilename: filename,
                downloadUrl: `/api/video/manual-edit/download/${filename}`,
                updatedAt: new Date().toISOString(),
            });

            console.log(`[ManualEdit] Job ${jobId} complete → ${filename}`);
        } catch (editErr) {
            console.error(`[ManualEdit] Job ${jobId} failed:`, editErr.message);
            await jobRef.update({
                status: 'failed',
                error: editErr.message,
                updatedAt: new Date().toISOString(),
            });
        }
    } catch (error) {
        console.error('[ManualEdit] Process error:', error);
        res.status(500).json({ error: error.message || 'Edit processing failed' });
    }
}

// -------------------------------------------------------
// GET /api/video/manual-edit/status/:jobId
// Poll for processing status
// -------------------------------------------------------
export async function getManualEditStatus(req, res) {
    try {
        const { jobId } = req.params;
        const db = getFirestore();
        const doc = await db.collection('manual_edit_jobs').doc(jobId).get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Edit job not found' });
        }

        const data = doc.data();
        if (data.userId !== req.user.uid) {
            return res.status(404).json({ error: 'Edit job not found' });
        }
        res.json({
            jobId: data.id,
            status: data.status,
            progress: data.progress || 0,
            downloadUrl: data.downloadUrl || null,
            outputUploadId: data.outputUploadId || null,
            summary: data.summary || null,
            // Launch videos (/api/brag) report extra detail.
            stage: data.stage || null,
            plan: data.plan || null,
            planner: data.planner || null,
            shareCopy: data.shareCopy || null,
            poster: data.poster || null,
            musicCredit: data.musicCredit || null,
            musicTrackId: data.musicTrackId || null,
            musicMood: data.musicMood || null,
            musicBpm: data.musicBpm || null,
            error: data.error || null,
        });
    } catch (error) {
        console.error('[ManualEdit] Status error:', error);
        res.status(500).json({ error: 'Failed to get status' });
    }
}

/** True if `uid` ran the job or belongs to (owns or is a member of) the job's workspace. */
async function canAccessJob(db, job, uid) {
    if (!job || !uid) return false;
    if (job.userId === uid) return true;
    if (!job.workspaceId) return false;
    const workspaceRef = db.collection('workspaces').doc(String(job.workspaceId));
    const member = await workspaceRef.collection('members').doc(uid).get();
    if (member.exists) return true;
    const workspace = await workspaceRef.get();
    return workspace.exists && workspace.data().ownerId === uid;
}

// -------------------------------------------------------
// GET /api/video/manual-edit/download/:filename
// Serve the processed video file
// -------------------------------------------------------
export async function serveManualEditFile(req, res) {
    try {
        // basename() strips any directory parts, including decoded "../" sequences.
        const filename = path.basename(req.params.filename || '');
        const filePath = path.join(RENDER_DIR, filename);

        // The user who ran the job, or any member of the job's workspace, may download its output
        // (clips are shared with the whole workspace).
        const db = getFirestore();
        const jobs = await db.collection('manual_edit_jobs')
            .where('outputFilename', '==', filename)
            .limit(5)
            .get();

        if (jobs.empty) {
            return res.status(404).json({ error: 'FILE_NOT_FOUND', message: 'This file no longer exists. Generate it again.' });
        }

        let allowed = false;
        for (const doc of jobs.docs) {
            if (await canAccessJob(db, doc.data(), req.user.uid)) {
                allowed = true;
                break;
            }
        }
        if (!allowed) {
            return res.status(403).json({ error: 'FORBIDDEN', message: "You don't have access to this file." });
        }
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'FILE_EXPIRED', message: 'This file has expired. Generate it again.' });
        }

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        fs.createReadStream(filePath).pipe(res);
    } catch (error) {
        console.error('[ManualEdit] Download error:', error);
        res.status(500).json({ error: 'Failed to serve file' });
    }
}
