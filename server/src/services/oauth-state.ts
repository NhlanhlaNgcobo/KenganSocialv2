/**
 * OAuth `state` for social connections: signed (HMAC with TOKEN_ENCRYPTION_KEY, as before),
 * expiring, bound to the user, workspace and platform that started the sign-in, and single-use.
 *
 * Single use: the nonce is claimed in Redis (SET NX, 15 minutes) when the callback arrives, so a
 * captured callback URL can't be replayed. If Redis can't be reached the callback is refused in
 * production (fail closed) and allowed in development.
 */
import crypto from 'crypto';

export const STATE_TTL_MS = 15 * 60 * 1000;

export interface OAuthState {
    workspaceId: string;
    platform: string;
    /** The signed-in user who started the sign-in (absent on states issued before this change). */
    uid?: string;
    exp: number;
    n: string;
}

export class OAuthStateError extends Error {}

type ClaimNonce = (nonce: string, ttlSeconds: number) => Promise<boolean>;

export function signState(key: string, data: { workspaceId: string; platform: string; uid: string }, now = Date.now()) {
    const payload = Buffer.from(JSON.stringify({ ...data, exp: now + STATE_TTL_MS, n: crypto.randomBytes(12).toString('hex') })).toString('base64url');
    const sig = crypto.createHmac('sha256', key).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}

/** Checks signature and expiry only (no side effects). */
export function readState(key: string, state: string | undefined, now = Date.now()): OAuthState {
    const [payload, sig] = String(state || '').split('.');
    if (!payload || !sig) throw new OAuthStateError('INVALID_OAUTH_STATE');
    const expected = crypto.createHmac('sha256', key).update(payload).digest('base64url');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new OAuthStateError('INVALID_OAUTH_STATE');
    let data: OAuthState;
    try {
        data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    } catch {
        throw new OAuthStateError('INVALID_OAUTH_STATE');
    }
    if (!data.exp || data.exp < now) throw new OAuthStateError('EXPIRED_OAUTH_STATE');
    return data;
}

/**
 * Verifies a callback's state for `platforms` (the callback's own platform, or the Meta family),
 * then claims its nonce so it works once.
 */
export async function consumeState(key: string, state: string | undefined, platforms: string[], claimNonce: ClaimNonce): Promise<OAuthState> {
    const data = readState(key, state);
    if (!platforms.includes(data.platform)) throw new OAuthStateError('OAUTH_STATE_PLATFORM_MISMATCH');
    if (!data.n) throw new OAuthStateError('INVALID_OAUTH_STATE');
    const fresh = await claimNonce(data.n, Math.ceil(STATE_TTL_MS / 1000));
    if (!fresh) throw new OAuthStateError('OAUTH_STATE_REUSED');
    return data;
}

/** Redis-backed nonce claim (fails closed in production when Redis is down). */
export function redisNonceClaimer(getRedis: () => Promise<{ set: (...args: any[]) => Promise<any> }>): ClaimNonce {
    return async (nonce, ttlSeconds) => {
        try {
            const redis = await getRedis();
            return (await redis.set(`oauth-state:${nonce}`, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
        } catch {
            if (process.env.NODE_ENV === 'production') throw new OAuthStateError('OAUTH_STATE_STORE_UNAVAILABLE');
            return true;
        }
    };
}

/** A log line for a failed OAuth exchange: status and the provider's error code only, never the request. */
export function safeOAuthError(err: any): string {
    const status = err?.response?.status;
    const data = err?.response?.data;
    const code = typeof data === 'object' && data ? data.error?.message || data.error_description || data.error || data.message : undefined;
    return [status ? `HTTP ${status}` : null, typeof code === 'string' ? code.slice(0, 200) : null, !status ? String(err?.message || err).slice(0, 200) : null].filter(Boolean).join(' ');
}
