import express from 'express';
import {
    uploadSourceVideo,
    processManualEdit,
    getManualEditStatus,
    serveManualEditFile,
} from '../controllers/manual-edit.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import multer from 'multer';
import os from 'os';

const upload = multer({ dest: os.tmpdir() });
const router = express.Router();

// All manual edit routes require authentication
router.use(requireAuth);

// Upload a source video file — returns uploadId
router.post('/upload', upload.single('video'), uploadSourceVideo);

// Submit an edit config for processing — returns jobId
router.post('/', processManualEdit);

// Poll for processing status
router.get('/status/:jobId', getManualEditStatus);

// Download the processed video
router.get('/download/:filename', serveManualEditFile);

export default router;
