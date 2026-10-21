import crypto from 'crypto';
import { metaAppSecret } from '../../config/meta';
import type { WebhookUnit } from './event-store';

/**
 * Meta webhooks (Instagram and Facebook Pages): signature check and splitting a delivery into events.
 *
 * Meta batches several events per POST: body.entry[] (one per account), each with `messaging[]`
 * (Messenger / Instagram messages, postbacks, reactions, reads) and/or `changes[]` (comments,
 * mentions, Page feed). Each becomes one event typed "<object>.<kind>", e.g. instagram.message,
 * instagram.comments, page.message, page.feed.
 */

/** Webhook verification token: META_VERIFY_TOKEN (or the older META_WEBHOOK_VERIFY_TOKEN). */
export function metaVerifyToken() {
    return process.env.META_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN || '';
}

/**
 * Checks X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app secret).
 * Without an app secret, deliveries are refused in production and accepted with a warning in development.
 */
export function verifyMetaSignature(rawBody: string | undefined, signature: string | undefined) {
    const secret = metaAppSecret();
    if (!secret) {
        if (process.env.NODE_ENV === 'production') return false;
        console.warn('[Webhooks] META_APP_SECRET is not set: accepting an unsigned Meta delivery (development only)');
        return true;
    }
    if (!signature || rawBody === undefined) return false;
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function messagingKind(event: any) {
    if (event.message) return 'message';
    if (event.postback) return 'postback';
    if (event.reaction) return 'reaction';
    if (event.read) return 'read';
    if (event.delivery) return 'delivery';
    if (event.optin) return 'optin';
    return 'messaging';
}

const hash = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

/** Splits a Meta delivery into events, or returns null for an object type we don't subscribe to. */
export function splitMetaPayload(body: any): WebhookUnit[] | null {
    const object = body?.object;
    if (object !== 'instagram' && object !== 'page') return null;
    const units: WebhookUnit[] = [];
    for (const entry of body.entry || []) {
        const accountId = entry.id ? String(entry.id) : null;
        for (const event of entry.messaging || []) {
            const kind = messagingKind(event);
            const mid = event.message?.mid || event.postback?.mid || event.reaction?.mid || event.read?.mid;
            units.push({
                source: 'meta',
                type: `${object}.${kind}`,
                key: `${object}:${accountId}:${kind}:${mid || `${event.sender?.id}:${event.timestamp}:${hash(event)}`}`,
                accountId,
                payload: { object, entryId: accountId, time: entry.time ?? null, event },
            });
        }
        for (const change of entry.changes || []) {
            const v = change.value || {};
            const itemId = v.comment_id || v.id || v.post_id || v.media_id || v.message_id;
            units.push({
                source: 'meta',
                type: `${object}.${change.field}`,
                key: `${object}:${accountId}:${change.field}:${itemId || hash(v)}:${v.verb || ''}:${v.edited_time || ''}`,
                accountId,
                payload: { object, entryId: accountId, time: entry.time ?? null, field: change.field, value: v },
            });
        }
    }
    return units;
}
