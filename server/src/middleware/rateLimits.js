import rateLimit from 'express-rate-limit';
import { readyUsageRedis } from '../utils/usageRedis.ts';

/**
 * Baseline API rate limits, shared by every API process through Redis.
 *
 * - Per user: each signed-in person gets their own allowance, so a team in one office (one IP
 *   address) isn't blocked by each other. The key is the user ID from the bearer token *and* the
 *   IP: the token isn't verified here (routes do that), so someone faking another user's ID only
 *   creates a separate bucket for themselves and can't use up the real user's allowance.
 * - Per IP: a higher ceiling, so one machine can't dodge the per-user limit by inventing user IDs.
 *
 * Counts live in Redis when it's reachable and fall back to this process's memory when it isn't
 * (development without Redis, or a Redis outage), so a limit always applies.
 */

const WINDOW_MS = 15 * 60 * 1000;
const production = () => process.env.NODE_ENV === 'production';

// INCR the key, start its window on the first hit, return [hits, ms until reset].
const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return { hits, ttl }`;

/** express-rate-limit store: Redis first, process memory as the fallback. */
export class RedisFallbackStore {
    constructor(prefix, { redis = readyUsageRedis } = {}) {
        this.prefix = prefix;
        this.redis = redis;
        this.memory = new Map(); // key -> { hits, resetAt }
        this.localKeys = true; // express-rate-limit: keys are not shared with other stores
    }

    init(options) {
        this.windowMs = options.windowMs;
    }

    localIncrement(key) {
        const now = Date.now();
        let entry = this.memory.get(key);
        if (!entry || entry.resetAt <= now) {
            entry = { hits: 0, resetAt: now + this.windowMs };
            this.memory.set(key, entry);
            if (this.memory.size > 50000) for (const [k, v] of this.memory) if (v.resetAt <= now) this.memory.delete(k);
        }
        entry.hits += 1;
        return { totalHits: entry.hits, resetTime: new Date(entry.resetAt) };
    }

    async increment(key) {
        try {
            const redis = await this.redis();
            const [hits, ttl] = await redis.eval(INCREMENT, 1, `${this.prefix}${key}`, this.windowMs);
            return { totalHits: Number(hits), resetTime: new Date(Date.now() + Number(ttl)) };
        } catch {
            return this.localIncrement(key);
        }
    }

    async decrement(key) {
        const entry = this.memory.get(key);
        if (entry && entry.hits > 0) entry.hits -= 1;
        try {
            await (await this.redis()).decr(`${this.prefix}${key}`);
        } catch {
            /* memory already adjusted */
        }
    }

    async resetKey(key) {
        this.memory.delete(key);
        try {
            await (await this.redis()).del(`${this.prefix}${key}`);
        } catch {
            /* memory already reset */
        }
    }
}

/** The user ID claimed by a Firebase bearer token, without verifying it (keying only). */
export function claimedUid(authorization) {
    const token = /^Bearer\s+([\w-]+\.([\w-]+)\.[\w-]+)$/.exec(String(authorization || ''));
    if (!token) return null;
    try {
        const payload = JSON.parse(Buffer.from(token[2], 'base64url').toString('utf8'));
        const uid = payload.user_id || payload.sub;
        return typeof uid === 'string' && /^[\w-]{1,128}$/.test(uid) ? uid : null;
    } catch {
        return null;
    }
}

export function userKey(req) {
    const uid = claimedUid(req.headers.authorization);
    return uid ? `u:${uid}:${req.ip}` : `ip:${req.ip}`;
}

// Platform webhooks are signature-verified and arrive in bursts from a few platform IPs;
// a 429 would make Meta/TikTok back off or disable the subscription.
const skip = (req) => req.path.startsWith('/api/webhooks/');

export function apiRateLimits({ redis } = {}) {
    const perUser = rateLimit({
        windowMs: WINDOW_MS,
        limit: () => (production() ? 1000 : 5000),
        keyGenerator: userKey,
        store: new RedisFallbackStore('rl:user:', { redis }),
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: 'Too many requests. Please wait a few minutes and try again.' },
        skip,
    });
    const perIp = rateLimit({
        windowMs: WINDOW_MS,
        limit: () => (production() ? 10000 : 50000),
        keyGenerator: (req) => req.ip,
        store: new RedisFallbackStore('rl:ip:', { redis }),
        standardHeaders: false,
        legacyHeaders: false,
        message: { error: 'Too many requests from this network. Please wait a few minutes and try again.' },
        skip,
    });
    return [perIp, perUser];
}
