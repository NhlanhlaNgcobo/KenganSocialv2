import express from 'express';
import { triggerSchedulerProcess, getStats, getQueue } from '../controllers/scheduler.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(requireAuth);

router.post('/process/:workspaceId', triggerSchedulerProcess);
router.get('/stats/:workspaceId', getStats);
router.get('/queue/:workspaceId', getQueue);

export default router;
