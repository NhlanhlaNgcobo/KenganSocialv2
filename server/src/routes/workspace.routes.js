import express from 'express';
import {
    getWorkspaces,
    createWorkspace,
    getWorkspaceById,
    getMembers,
    addMember,
    removeMember,
    updateWorkspace,
} from '../controllers/workspace.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

const router = express.Router();

// All workspace routes require authentication
router.use(requireAuth);

router.get('/', getWorkspaces);
router.post('/', createWorkspace);
router.get('/:workspaceId', getWorkspaceById);
router.patch('/:workspaceId', requireRole('owner', 'admin'), updateWorkspace);
router.get('/:workspaceId/members', getMembers);
router.post('/:workspaceId/members', addMember);
router.delete('/:workspaceId/members/:memberId', removeMember);

export default router;
