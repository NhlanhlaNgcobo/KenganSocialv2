import express from 'express';
import {
    generateAI,
    getCredits,
    getUsageLogs,
    parseSrtFile,
    exportSrtFile,
    generateTikTokStyleCaptions,
    queueVideoRender,
    getRenderJobStatus,
    generateMediaRequest,
    getAiStatus
} from '../controllers/ai.controller.js';
import {
    analyzeUploadedVideo,
    renderEditedVideo,
    getRenderStatus,
    serveRenderedFile,
} from '../controllers/video-edit.controller.js';
import { requireAuth, requireBodyWorkspace, requireRole } from '../middleware/auth.middleware.js';
import multer from 'multer';
import os from 'os';
import path from 'path';
import { getFirestore } from '../config/firebase.js';

// New Post accepts videos up to 100 MB (the client checks the same limit before uploading).
export const MAX_ANALYZE_BYTES = 100 * 1024 * 1024;
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: MAX_ANALYZE_BYTES, files: 1 } });
const router = express.Router();

/** multer.single() with a readable sentence when the file is too large. */
function singleVideo(field) {
    const handler = upload.single(field);
    return (req, res, next) =>
        handler(req, res, (err) => {
            if (!err) return next();
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'FILE_TOO_LARGE', message: 'That video is over 100 MB. Trim or compress it and try again.' });
            }
            return res.status(400).json({ error: 'UPLOAD_FAILED', message: 'The video upload failed. Try again.' });
        });
}

// --- Ownership checks for the video pipeline: a user can only use their own analyses and renders. ---
// A job that belongs to someone else looks the same as a missing one.

async function ownAnalysis(req, res, next) {
    try {
        const jobId = String(req.body?.jobId || '');
        if (!jobId) return next(); // the controller reports the missing ID
        const doc = await getFirestore().collection('video_analyses').doc(jobId).get();
        if (!doc.exists || doc.data().userId !== req.user.uid) {
            return res.status(404).json({ error: 'NOT_FOUND', message: 'Video analysis not found. Upload and analyse the video again.' });
        }
        next();
    } catch (error) {
        console.error('[AI Routes] Analysis ownership check failed:', error.message);
        res.status(500).json({ error: 'AUTH_CHECK_FAILED', message: 'Could not check access to this video. Try again.' });
    }
}

async function ownRender(req, res, next) {
    try {
        const doc = await getFirestore().collection('render_jobs').doc(String(req.params.jobId || '')).get();
        if (!doc.exists || doc.data().userId !== req.user.uid) {
            return res.status(404).json({ error: 'NOT_FOUND', message: 'Render job not found.' });
        }
        next();
    } catch (error) {
        console.error('[AI Routes] Render ownership check failed:', error.message);
        res.status(500).json({ error: 'AUTH_CHECK_FAILED', message: 'Could not check access to this render. Try again.' });
    }
}

async function ownRenderedFile(req, res, next) {
    try {
        const filename = String(req.params.filename || '');
        // Reject anything that isn't a bare file name (no "../" or separators).
        if (!filename || path.basename(filename) !== filename) {
            return res.status(404).json({ error: 'NOT_FOUND', message: 'File not found.' });
        }
        const snap = await getFirestore()
            .collection('render_jobs')
            .where('outputFilename', '==', filename)
            .limit(5)
            .get();
        if (!snap.docs.some((d) => d.data().userId === req.user.uid)) {
            return res.status(404).json({ error: 'NOT_FOUND', message: 'This video is no longer available. Render it again.' });
        }
        next();
    } catch (error) {
        console.error('[AI Routes] File ownership check failed:', error.message);
        res.status(500).json({ error: 'AUTH_CHECK_FAILED', message: 'Could not check access to this file. Try again.' });
    }
}

// All AI routes require authentication
router.use(requireAuth);

// --- Feature status (which optional providers are configured) ---
router.get('/status', getAiStatus);

// --- Text Generation ---
router.post('/generate', requireBodyWorkspace('owner', 'admin', 'editor'), generateAI);
router.post('/generate-media', requireBodyWorkspace('owner', 'admin', 'editor'), generateMediaRequest);

// --- Credits & Usage ---
router.get('/credits/:workspaceId', requireRole('owner', 'admin', 'editor', 'viewer'), getCredits);
router.get('/usage/:workspaceId', requireRole('owner', 'admin', 'editor', 'viewer'), getUsageLogs);

// --- Captions (SRT) ---
router.post('/captions/parse', parseSrtFile);
router.post('/captions/export', exportSrtFile);
router.post('/captions/tiktok', generateTikTokStyleCaptions);

// --- Video Rendering (legacy) ---
router.post('/video/render', requireBodyWorkspace('owner', 'admin', 'editor'), queueVideoRender);
router.get('/video/render/:jobId', getRenderJobStatus);

// --- Video Editing Pipeline (NEW) ---
router.post('/video/analyze', singleVideo('video'), analyzeUploadedVideo);
router.post('/video/edit', ownAnalysis, renderEditedVideo);
router.get('/video/status/:jobId', ownRender, getRenderStatus);
router.get('/video/download/:filename', ownRenderedFile, serveRenderedFile);

export default router;
