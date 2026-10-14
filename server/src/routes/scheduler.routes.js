import express from 'express';
import { triggerSchedulerProcess, getStats, getQueue } from '../controllers/scheduler.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(requireAuth);

// Every route acts on the workspace in the URL, so membership is checked first.
router.post('/process/:workspaceId', requireRole('owner', 'admin', 'editor'), triggerSchedulerProcess);
router.get('/stats/:workspaceId', requireRole('owner', 'admin', 'editor', 'viewer'), getStats);
router.get('/queue/:workspaceId', requireRole('owner', 'admin', 'editor', 'viewer'), getQueue);

export default router;
