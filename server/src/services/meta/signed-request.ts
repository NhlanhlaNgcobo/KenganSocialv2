import crypto from 'crypto';

/**
 * Parses and verifies a Meta `signed_request` (data deletion and deauthorize callbacks):
 * "<base64url HMAC-SHA256 signature>.<base64url JSON payload>", signed with the app secret.
 * Throws on a bad format, unknown algorithm or wrong signature.
 */
export function parseSignedRequest(signedRequest: string | undefined, appSecret: string): { user_id: string; algorithm: string; issued_at?: number } {
    if (!appSecret) throw new Error('META_APP_SECRET_NOT_SET');
    const [encodedSig, payload] = String(signedRequest || '').split('.', 2);
    if (!encodedSig || !payload) throw new Error('INVALID_SIGNED_REQUEST');

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (String(data.algorithm || '').toUpperCase() !== 'HMAC-SHA256') throw new Error('UNSUPPORTED_ALGORITHM');

    const expected = crypto.createHmac('sha256', appSecret).update(payload).digest();
    const given = Buffer.from(encodedSig, 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new Error('BAD_SIGNATURE');
    if (!data.user_id) throw new Error('NO_USER_ID');
    return data;
}
