import express from 'express';
import { verifyMetaWebhook, handleMetaWebhook } from '../controllers/webhooks.controller.js';
import { handlePaystackWebhook } from './billing.ts';

const router = express.Router();

// Meta (Instagram/Facebook) Webhook Verification
router.get('/meta', verifyMetaWebhook);

// Meta (Instagram/Facebook) Webhook Event processing (DMs, comments)
router.post('/meta', handleMetaWebhook);

// Paystack webhook alias for external webhook providers
router.post('/paystack', handlePaystackWebhook);

export default router;
