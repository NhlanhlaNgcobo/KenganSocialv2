import express from 'express';
import {
    uploadSourceVideo,
    processManualEdit,
    getManualEditStatus,
    serveManualEditFile,
} from '../controllers/manual-edit.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { withWorkspace } from '../middleware/withWorkspace.ts';
import { checkLimit } from '../middleware/planGate.ts';
import { videoUnits } from '../utils/planLimits.ts';
import multer from 'multer';
import resumableRoutes from './resumable-upload.js';
import os from 'os';

const upload = multer({
    dest: os.tmpdir(),
    limits: { fileSize: 2 * 1024 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ok = /^(video|image|audio)\//.test(file.mimetype || '');
        cb(ok ? null : new Error('Only video, image and audio files can be uploaded'), ok);
    },
});
const router = express.Router();

// All manual edit routes require authentication
router.use(requireAuth, withWorkspace);

// Upload a source video file — returns uploadId
router.post('/upload', upload.single('video'), uploadSourceVideo);

// Large files in 8 MB chunks that survive dropped connections — also returns an uploadId
router.use('/resumable', resumableRoutes);

// Submit an edit config for processing — returns jobId
// Each started 5 minutes of exported video counts once (a short preview range counts by its length).
const exportUnits = (req) => {
    const range = req.body?.range;
    const seconds = range ? Number(range.end) - Number(range.start) : Number(req.body?.duration);
    return videoUnits(seconds);
};
router.post('/', checkLimit('exports', exportUnits), processManualEdit);

// Poll for processing status
router.get('/status/:jobId', getManualEditStatus);

// Download the processed video
router.get('/download/:filename', serveManualEditFile);

export default router;
