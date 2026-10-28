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
import { cancelExport, exportQueueState, exportTimeoutMs, queuePosition, runExport } from '../services/export-queue.js';
import { pilotConfig, pilotMode } from '../config/pilot';
import { refundUsage } from '../middleware/planGate.ts';
import { videoUnits } from '../utils/planLimits.ts';
import crypto from 'crypto';

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

/** Seconds the export will cover (the preview range, or the whole timeline). */
function exportSeconds(editConfig, spec) {
    const range = editConfig?.range;
    if (range) return Math.max(0, Number(range.end) - Number(range.start)) || 0;
    return Number(spec?.duration) || Number(editConfig?.duration) || 0;
}

/** A job id derived from the user and their Idempotency-Key, so a double-click makes one export. */
function idempotentJobId(uid, key) {
    const h = crypto.createHash('sha256').update(`${uid}:${key}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// -------------------------------------------------------
// Before the usage check: validate the timeline, apply the pilot's length cap, work out the units
// to charge, and answer a repeated request (same Idempotency-Key) with the job it already made.
// -------------------------------------------------------
export async function preflightManualEdit(req, res, next) {
    const editConfig = req.body;
    let spec = null;
    if (editConfig?.version === 2) {
        try {
            spec = normalizeTimelineConfig(editConfig, req.user.uid);
        } catch (validationError) {
            return res.status(validationError.status || 400).json({ error: validationError.message });
        }
    }
    const seconds = exportSeconds(editConfig, spec);
    req.exportSeconds = seconds;
    if (pilotMode() && seconds > pilotConfig().maxExportDurationS) {
        return res.status(400).json({ code: 'EXPORT_TOO_LONG', error: `During the beta, exports are up to ${pilotConfig().maxExportDurationS} seconds. This one is ${Math.ceil(seconds)} s. Trim it or export a range.` });
    }
    req.exportUnits = videoUnits(seconds);

    const key = req.get('idempotency-key');
    if (key !== undefined) {
        if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) return res.status(400).json({ error: 'Invalid Idempotency-Key.' });
        req.exportJobId = idempotentJobId(req.user.uid, key);
        const existing = await getFirestore().collection('manual_edit_jobs').doc(req.exportJobId).get();
        if (existing.exists && existing.data().userId === req.user.uid) {
            return res.status(200).json({ jobId: req.exportJobId, status: existing.data().status, duplicate: true });
        }
    }
    next();
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
        const jobId = req.exportJobId || uuidv4();
        const timeoutMs = exportTimeoutMs(req.exportSeconds || Number(editConfig.duration) || 60);
        const queueState = exportQueueState();
        const queued = queueState.cap !== null && queueState.running >= queueState.cap;
        const usage = req.workspaceId ? { workspaceId: req.workspaceId, plan: req.plan || 'starter', units: req.exportUnits || 1 } : null;

        // Create the job record (create, not set: a racing duplicate with the same key fails here)
        try {
            await db.collection('manual_edit_jobs').doc(jobId).create({
            id: jobId,
            userId: req.user.uid,
            status: queued ? 'queued' : 'processing',
            progress: 0,
            usage,
            // Waiting time plus the render limit; past this the job is reported as failed.
            deadlineAt: new Date(Date.now() + timeoutMs + 30 * 60 * 1000).toISOString(),
            // A summary only: full configs can hold LUT tables and nested curve points, which
            // Firestore cannot store (nested arrays, 1 MB documents).
            editSummary: {
                version: editConfig.version || 1,
                exportFormat: editConfig.exportFormat || null,
                duration: Number(editConfig.duration) || null,
                clips: Array.isArray(editConfig.main) ? editConfig.main.length : Array.isArray(editConfig.clips) ? editConfig.clips.length : 0,
                texts: Array.isArray(editConfig.text) ? editConfig.text.length : 0,
                // Exact preview of a short range (same pipeline as export).
                range: editConfig.range ? { start: Number(editConfig.range.start) || 0, end: Number(editConfig.range.end) || 0 } : null,
            },
            createdAt: new Date().toISOString(),
        });
        } catch (createErr) {
            if (req.exportJobId && (createErr?.code === 6 || /already exists/i.test(createErr?.message || ''))) {
                if (usage) await refundUsage(usage.workspaceId, usage.plan, 'exports', usage.units);
                return res.status(200).json({ jobId, status: 'processing', duplicate: true });
            }
            throw createErr;
        }

        // Return immediately — processing runs in background
        res.status(202).json({
            jobId,
            status: queued ? 'queued' : 'processing',
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
            const maxShortSide = pilotMode() ? pilotConfig().maxExportResolution : undefined;
            const outputPath = await runExport(
                jobId,
                {
                    timeoutMs,
                    onStart: () => jobRef.update({ status: 'processing', startedAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + timeoutMs + 60_000).toISOString() }),
                },
                () => (isTimeline ? renderTimeline(editConfig, req.user.uid, onProgress, { maxShortSide }) : processEditConfig(editConfig, onProgress))
            );

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
            if (editErr?.code === 'CANCELLED') {
                console.log(`[ManualEdit] Job ${jobId} cancelled`);
                await jobRef.update({ status: 'cancelled', updatedAt: new Date().toISOString() }).catch(() => {});
                return;
            }
            const message = editErr?.code === 'TIMEOUT' ? 'The export took too long and was stopped. Try a shorter video or fewer effects.' : editErr.message;
            console.error(`[ManualEdit] Job ${jobId} failed:`, message);
            await jobRef.update({
                status: 'failed',
                error: message,
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
        // Left running by a restart (or stuck): report it failed once its deadline has passed.
        if ((data.status === 'processing' || data.status === 'queued') && data.deadlineAt && Date.parse(data.deadlineAt) < Date.now() && !queuePosition(jobId)) {
            data.status = 'failed';
            data.error = 'The export was interrupted. Please export again.';
            doc.ref.update({ status: 'failed', error: data.error, updatedAt: new Date().toISOString() }).catch(() => {});
        }
        res.json({
            jobId: data.id,
            status: data.status,
            queuePosition: data.status === 'queued' ? queuePosition(jobId) || null : null,
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

// -------------------------------------------------------
// POST /api/video/manual-edit/cancel/:jobId
// Stop a queued or running export. A queued one gives its export allowance back.
// -------------------------------------------------------
export async function cancelManualEdit(req, res) {
    try {
        const { jobId } = req.params;
        const db = getFirestore();
        const ref = db.collection('manual_edit_jobs').doc(String(jobId));
        const doc = await ref.get();
        if (!doc.exists || doc.data().userId !== req.user.uid) return res.status(404).json({ error: 'Edit job not found' });
        const data = doc.data();
        if (data.status !== 'queued' && data.status !== 'processing') return res.status(409).json({ error: `This export is already ${data.status}.`, status: data.status });
        const where = cancelExport(jobId);
        await ref.update({ status: 'cancelled', updatedAt: new Date().toISOString() });
        if (where === 'queued' && data.usage) await refundUsage(data.usage.workspaceId, data.usage.plan, 'exports', data.usage.units);
        res.json({ jobId, status: 'cancelled', refunded: where === 'queued' });
    } catch (error) {
        console.error('[ManualEdit] Cancel error:', error.message);
        res.status(500).json({ error: 'Could not cancel the export' });
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
