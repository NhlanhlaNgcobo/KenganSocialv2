import express from 'express';
import {
    getContent,
    createContent,
    updateContent,
    deleteContent
} from '../controllers/content.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

const router = express.Router({ mergeParams: true });

// All content routes require authentication and proper role in workspace
router.use(requireAuth);
router.use(requireRole('owner', 'admin', 'editor'));

router.get('/', getContent);
router.post('/', createContent);
router.put('/:contentId', updateContent);
router.delete('/:contentId', deleteContent);

export default router;
