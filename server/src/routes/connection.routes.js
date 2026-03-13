import express from 'express';
import {
    getConnections,
    addConnection,
    deleteConnection,
    updateConnection
} from '../controllers/connection.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

const router = express.Router({ mergeParams: true });

// All connection routes require authentication and proper role in workspace
router.use(requireAuth);
router.use(requireRole('owner', 'admin', 'editor'));

router.get('/', getConnections);
router.post('/', addConnection);
router.put('/:connectionId', updateConnection);
router.delete('/:connectionId', deleteConnection);

export default router;
