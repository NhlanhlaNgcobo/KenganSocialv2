import express from 'express';
import {
    getAutomations,
    createAutomation,
    updateAutomation,
    deleteAutomation
} from '../controllers/automation.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

const router = express.Router({ mergeParams: true });

// All automation routes require authentication and proper role in workspace
router.use(requireAuth);
router.use(requireRole('owner', 'admin', 'editor'));

router.get('/', getAutomations);
router.post('/', createAutomation);
router.put('/:automationId', updateAutomation);
router.delete('/:automationId', deleteAutomation);

export default router;
