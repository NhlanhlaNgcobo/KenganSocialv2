import express from 'express';
import multer from 'multer';
import { uploadMedia } from '../controllers/media.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { pilotUploadCap } from '../middleware/pilotUpload.js';

const router = express.Router({ mergeParams: true });
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 250 * 1024 * 1024 } // 250MB: short-form videos
});

// All media routes require authentication and proper role
router.use(requireAuth);
router.use(requireRole('owner', 'admin', 'editor'));

router.post('/upload', pilotUploadCap, upload.single('file'), uploadMedia);

export default router;
