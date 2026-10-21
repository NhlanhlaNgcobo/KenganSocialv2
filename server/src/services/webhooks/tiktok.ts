import crypto from 'crypto';
import type { WebhookUnit } from './event-store';

/**
 * TikTok for Developers webhooks (Login Kit / Content Posting app): signature check and parsing.
 * Header `TikTok-Signature: t=<unix seconds>,s=<hex HMAC-SHA256 of "<t>.<raw body>" keyed with
 * the client secret>`. Body: { client_key, event, create_time, user_openid, content: "<JSON string>" }.
 * https://developers.tiktok.com/doc/webhooks-verification
 */

const MAX_AGE_SECONDS = 5 * 60;

export function verifyTikTokSignature(rawBody: string | undefined, header: string | undefined, now = Date.now()) {
    const secret = process.env.TIKTOK_CLIENT_SECRET || '';
    if (!secret || rawBody === undefined || !header) return false;
    const parts = Object.fromEntries(
        String(header)
            .split(',')
            .map((p) => p.split('=').map((s) => s.trim()))
            .filter((p) => p.length === 2)
    );
    const t = Number(parts.t);
    if (!parts.s || !Number.isFinite(t)) return false;
    if (Math.abs(now / 1000 - t) > MAX_AGE_SECONDS) return false; // replayed or badly delayed
    const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`, 'utf8').digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(parts.s));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function splitTikTokPayload(body: any): WebhookUnit[] | null {
    if (!body?.event) return null;
    if (process.env.TIKTOK_CLIENT_KEY && body.client_key && body.client_key !== process.env.TIKTOK_CLIENT_KEY) return null; // another app's event
    let content: unknown = body.content;
    try {
        content = typeof body.content === 'string' ? JSON.parse(body.content) : body.content;
    } catch {
        /* keep as text */
    }
    const contentKey = crypto.createHash('sha256').update(String(body.content ?? '')).digest('hex').slice(0, 16);
    return [
        {
            source: 'tiktok',
            type: String(body.event),
            key: `${body.event}:${body.user_openid || ''}:${body.create_time || ''}:${contentKey}`,
            accountId: body.user_openid ? String(body.user_openid) : null,
            payload: { event: body.event, createTime: body.create_time ?? null, userOpenId: body.user_openid ?? null, content },
        },
    ];
}
