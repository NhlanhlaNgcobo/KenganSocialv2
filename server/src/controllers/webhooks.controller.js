import { storeEvents } from '../services/webhooks/event-store.ts';
import { processSoon } from '../services/webhooks/dispatcher.ts';
import { metaVerifyToken, splitMetaPayload, verifyMetaSignature } from '../services/webhooks/meta.ts';
import { splitTikTokPayload, verifyTikTokSignature } from '../services/webhooks/tiktok.ts';

/**
 * Platform webhooks: verify the signature, store each event (duplicates skipped), answer the
 * platform, then process the events (services/webhooks/dispatcher.ts). If storing fails we answer
 * 500 so the platform redelivers later instead of the event being lost.
 */

async function accept(res, units, label) {
    try {
        const { ids, duplicates } = await storeEvents(units);
        res.status(200).send('EVENT_RECEIVED');
        if (duplicates) console.log(`[Webhooks] ${label}: skipped ${duplicates} redelivered event(s)`);
        processSoon(ids);
    } catch (error) {
        console.error(`[Webhooks] ${label}: could not store events:`, error.message);
        res.sendStatus(500);
    }
}

// Meta subscription check (GET with hub.challenge) when the webhook URL is saved in the app dashboard.
export const verifyMetaWebhook = (req, res) => {
    const token = metaVerifyToken();
    const mode = req.query['hub.mode'];
    const sent = req.query['hub.verify_token'];
    if (!mode || !sent) return res.sendStatus(400);
    if (mode === 'subscribe' && token && sent === token) {
        console.log('[Webhooks] Meta webhook verified');
        return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
    }
    console.error('[Webhooks] Meta webhook verification failed (check META_VERIFY_TOKEN)');
    res.sendStatus(403);
};

export const receiveMetaWebhook = async (req, res) => {
    if (!verifyMetaSignature(req.rawBody, req.headers['x-hub-signature-256'])) {
        console.warn('[Webhooks] Meta delivery with an invalid signature was rejected');
        return res.sendStatus(401);
    }
    const units = splitMetaPayload(req.body);
    if (!units) return res.status(200).send('IGNORED'); // an object type we don't subscribe to
    await accept(res, units, `Meta ${req.body.object}`);
};

export const receiveTikTokWebhook = async (req, res) => {
    if (!verifyTikTokSignature(req.rawBody, req.headers['tiktok-signature'])) {
        console.warn('[Webhooks] TikTok delivery with an invalid or old signature was rejected');
        return res.sendStatus(401);
    }
    const units = splitTikTokPayload(req.body);
    if (!units) return res.status(200).send('IGNORED');
    await accept(res, units, `TikTok ${req.body.event}`);
};
