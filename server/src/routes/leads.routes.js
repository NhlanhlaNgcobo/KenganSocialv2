import express from 'express';
import {
    getLeads,
    addLead,
    updateLead
} from '../controllers/leads.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

const router = express.Router({ mergeParams: true });

// All leads routes require authentication and proper role in workspace
router.use(requireAuth);
router.use(requireRole('owner', 'admin', 'editor', 'viewer'));

router.get('/', getLeads);
router.post('/', addLead);
router.put('/:leadId', updateLead);

export default router;
