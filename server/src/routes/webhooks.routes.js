import express from 'express';
import { receiveMetaWebhook, receiveTikTokWebhook, verifyMetaWebhook } from '../controllers/webhooks.controller.js';
import { handlePaystackWebhook } from './billing.ts';

/**
 * Inbound webhooks (all signature-verified):
 *   GET  /api/webhooks/meta     Meta subscription check (hub.challenge)
 *   POST /api/webhooks/meta     Instagram and Facebook Page events (messages, comments, feed)
 *   POST /api/webhooks/tiktok   TikTok for Developers events (authorization.removed, publishing)
 *   POST /api/webhooks/paystack Paystack billing events
 */
const router = express.Router();

router.get('/meta', verifyMetaWebhook);
router.post('/meta', receiveMetaWebhook);
router.post('/tiktok', receiveTikTokWebhook);
router.post('/paystack', handlePaystackWebhook);

export default router;
