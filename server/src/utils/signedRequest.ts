/**
 * Meta `signed_request` (data deletion / deauthorize callbacks), kept free of Firebase imports so
 * scripts/check-legal.mjs can test it.
 */
import crypto from 'crypto';

/**
 * Verifies and decodes a Meta `signed_request` (data deletion / deauthorize callbacks):
 * `<base64url HMAC-SHA256 signature>.<base64url JSON payload>`, signed with the app secret.
 * Returns the payload, or null when the signature or format is wrong.
 */
export function parseSignedRequest(signedRequest: unknown, appSecret = process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET || ''): { user_id: string; algorithm: string; issued_at?: number } | null {
    if (typeof signedRequest !== 'string' || !appSecret) return null;
    const [encodedSig, payload] = signedRequest.split('.', 2);
    if (!encodedSig || !payload) return null;
    const sig = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const expected = crypto.createHmac('sha256', appSecret).update(payload).digest();
    if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
    try {
        const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        if (String(data.algorithm).toUpperCase() !== 'HMAC-SHA256' || !data.user_id) return null;
        return { ...data, user_id: String(data.user_id) };
    } catch {
        return null;
    }
}

