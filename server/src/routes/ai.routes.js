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
    generateMediaRequest
} from '../controllers/ai.controller.js';
import {
    analyzeUploadedVideo,
    renderEditedVideo,
    getRenderStatus,
    serveRenderedFile,
} from '../controllers/video-edit.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import multer from 'multer';
import os from 'os';

const upload = multer({ dest: os.tmpdir() });
const router = express.Router();

// All AI routes require authentication
router.use(requireAuth);

// --- Text Generation ---
router.post('/generate', generateAI);
router.post('/generate-media', generateMediaRequest);

// --- Credits & Usage ---
router.get('/credits/:workspaceId', getCredits);
router.get('/usage/:workspaceId', getUsageLogs);

// --- Captions (SRT) ---
router.post('/captions/parse', parseSrtFile);
router.post('/captions/export', exportSrtFile);
router.post('/captions/tiktok', generateTikTokStyleCaptions);

// --- Video Rendering (legacy) ---
router.post('/video/render', queueVideoRender);
router.get('/video/render/:jobId', getRenderJobStatus);

// --- Video Editing Pipeline (NEW) ---
router.post('/video/analyze', upload.single('video'), analyzeUploadedVideo);
router.post('/video/edit', renderEditedVideo);
router.get('/video/status/:jobId', getRenderStatus);
router.get('/video/download/:filename', serveRenderedFile);

export default router;
