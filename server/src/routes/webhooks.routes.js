import express from 'express';
import { verifyMetaWebhook, handleMetaWebhook } from '../controllers/webhooks.controller.js';

const router = express.Router();

// Meta (Instagram/Facebook) Webhook Verification
router.get('/meta', verifyMetaWebhook);

// Meta (Instagram/Facebook) Webhook Event processing (DMs, comments)
router.post('/meta', handleMetaWebhook);

export default router;
