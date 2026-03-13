import express from 'express';
import {
    getPlans,
    getBillingInfo,
    createCheckoutSession,
    handleWebhook
} from '../controllers/billing.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = express.Router();

// Webhook must be before auth middleware (uses raw body)
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// All other routes require authentication
router.use(requireAuth);

router.get('/plans', getPlans);
router.get('/:workspaceId', getBillingInfo);
router.post('/checkout', createCheckoutSession);

export default router;
