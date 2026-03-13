import express from 'express';
import { getDashboardAnalytics, getPostAnalytics } from '../controllers/analytics.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(requireAuth);

router.get('/:workspaceId', getDashboardAnalytics);
router.get('/:workspaceId/posts', getPostAnalytics);

export default router;
