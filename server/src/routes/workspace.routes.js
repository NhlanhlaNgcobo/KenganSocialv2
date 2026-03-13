import express from 'express';
import {
    getWorkspaces,
    createWorkspace,
    getWorkspaceById
} from '../controllers/workspace.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = express.Router();

// All workspace routes require authentication
router.use(requireAuth);

router.get('/', getWorkspaces);
router.post('/', createWorkspace);
router.get('/:workspaceId', getWorkspaceById);

export default router;
