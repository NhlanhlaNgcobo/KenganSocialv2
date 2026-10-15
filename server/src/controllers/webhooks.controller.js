import { processInstagramWebhook, validSignature, verifyToken } from '../services/instagram-dm.ts';

// META (Facebook/Instagram) Webhook Verification
export const verifyMetaWebhook = (req, res) => {
    const token = verifyToken();
    const mode = req.query['hub.mode'];
    const sent = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (!mode || !sent) return res.sendStatus(400);
    if (mode === 'subscribe' && token && sent === token) {
        console.log('[Meta Webhook] WEBHOOK_VERIFIED');
        return res.status(200).send(challenge);
    }
    console.error('[Meta Webhook] Verification failed (check META_VERIFY_TOKEN)');
    res.sendStatus(403);
};

/**
 * Incoming Meta events. Instagram DMs run the Automations page rules, Inbox auto-replies, and
 * otherwise queue an AI-suggested reply for approval (services/instagram-dm.ts).
 */
export const handleMetaWebhook = (req, res) => {
    if (!validSignature(req.rawBody, req.headers['x-hub-signature-256'])) return res.sendStatus(401);
    const { object } = req.body || {};
    if (object !== 'instagram' && object !== 'page') return res.sendStatus(404);

    // Acknowledge fast; Meta retries slow or failed deliveries.
    res.status(200).send('EVENT_RECEIVED');
    processInstagramWebhook(req.body).catch((error) => console.error('[Meta Webhook] Processing failed:', error.message));
};
