import crypto from 'crypto';
import { redis as sharedRedis } from '../../utils/redis';

/**
 * Sending limits for Instagram and Messenger messages (Redis-backed, used by messaging.ts).
 *
 *  - Burst lock: one message every BURST_MS to the same person or comment (all sends), so a double
 *    click or two rules firing together can't send twice.
 *  - Recipient dedupe: the identical text is not sent to the same person twice within
 *    RECIPIENT_DEDUPE_MS (all sends). Templates are identical by design, so this is per person, never
 *    per workspace: a popular post can't lock anyone out.
 *  - Automated ceiling: at most AUTOMATED_HOURLY_CEILING automated sends per hour per workspace and
 *    channel (Instagram allows about 200 automated DMs an hour per account). Reaching it pauses
 *    automated sends on that channel until the hour ends; replies a person sends by hand are never paused.
 *
 * The per-person, per-rule cooldown is durable and lives in Firestore (rules.ts, automationRuns).
 *
 * Redis failure: every check here fails open (with a warning). The burst lock and dedupe are
 * convenience guards (rule runs are already idempotent in Firestore), and Meta enforces its own hard
 * rate limits, so refusing all messaging during a Redis outage would do more harm than good.
 * Each Redis call is bounded by REDIS_TIMEOUT_MS so an unreachable Redis can't stall a send.
 */

export const BURST_MS = 2000;
export const RECIPIENT_DEDUPE_MS = 10 * 60 * 1000;
export const AUTOMATED_HOURLY_CEILING = 200;
const HOUR_MS = 3600 * 1000;
const REDIS_TIMEOUT_MS = 1500;

export type GuardRefusal = 'burst' | 'duplicate' | 'ceiling';

/** Minimal Redis surface used here (lets tests pass an in-memory fake). */
export interface GuardRedis {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ...args: any[]): Promise<unknown>;
    incr(key: string): Promise<number>;
    pexpire(key: string, ms: number): Promise<unknown>;
    del(key: string): Promise<unknown>;
}

export const textHash = (text: string) =>
    crypto.createHash('sha256').update(String(text || '').normalize('NFKC').trim().toLowerCase()).digest('hex').slice(0, 24);

/** Start of the fixed one-hour window `now` falls in. */
export const hourWindow = (now: number) => Math.floor(now / HOUR_MS) * HOUR_MS;

/** Pure decision for the automated ceiling: refused once the count for this hour passes the limit. */
export function overCeiling(countThisHour: number, limit = AUTOMATED_HOURLY_CEILING) {
    return limit >= 0 && countThisHour > limit;
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
    return Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Redis timed out')), REDIS_TIMEOUT_MS).unref?.()),
    ]);
}

/** Channels whose automated sends are paused right now (hourly limit), for the Inbox and Automations pages. */
export function activePause(pause: any, now = Date.now()) {
    const out: Record<string, { until: number; reason: string }> = {};
    for (const [channel, p] of Object.entries(pause || {})) {
        const until = Number((p as any)?.until || 0);
        if (until > now) out[channel] = { until, reason: String((p as any)?.reason || 'hourly_limit') };
    }
    return out;
}

export const pauseKey = (workspaceId: string, channel: string) => `dm:autopause:${workspaceId}:${channel}`;

export interface GuardInput {
    workspaceId: string;
    channel: string; // instagram | facebook
    target: string; // dm:<id>, private:<commentId>, public:<commentId>
    recipient: string; // the person (for dedupe), or the target when unknown
    text: string;
    automated: boolean;
    now?: number;
}

export interface GuardResult {
    ok: boolean;
    refusal?: GuardRefusal;
    /** For a ceiling refusal: when automated sending resumes. */
    pausedUntil?: number;
    /** True the first time the ceiling is reached in this window (the caller records the pause once). */
    pauseStarted?: boolean;
}

/** Runs the checks for one send. Never throws: Redis problems fail open. */
export async function checkSend(input: GuardInput, r: GuardRedis = sharedRedis as unknown as GuardRedis): Promise<GuardResult> {
    const now = input.now ?? Date.now();
    const { workspaceId, channel } = input;
    try {
        if (input.automated) {
            const pausedUntil = Number(await withTimeout(r.get(pauseKey(workspaceId, channel)))) || 0;
            if (pausedUntil > now) return { ok: false, refusal: 'ceiling', pausedUntil };
        }
        const burst = await withTimeout(r.set(`dm:lock:${workspaceId}:${input.target}`, '1', 'PX', BURST_MS, 'NX'));
        if (!burst) return { ok: false, refusal: 'burst' };

        const dedupe = await withTimeout(
            r.set(`dm:dedupe:${workspaceId}:${channel}:${input.recipient}:${textHash(input.text)}`, String(now), 'PX', RECIPIENT_DEDUPE_MS, 'NX')
        );
        if (!dedupe) return { ok: false, refusal: 'duplicate' };

        if (input.automated) {
            const windowStart = hourWindow(now);
            const counter = `dm:auto:${workspaceId}:${channel}:${windowStart}`;
            const count = await withTimeout(r.incr(counter));
            if (count === 1) await withTimeout(r.pexpire(counter, HOUR_MS + 60_000));
            if (overCeiling(count)) {
                const pausedUntil = windowStart + HOUR_MS;
                const first = await withTimeout(r.set(pauseKey(workspaceId, channel), String(pausedUntil), 'PX', Math.max(1000, pausedUntil - now), 'NX'));
                // Not sent: let the same text go out later (e.g. by hand from the queue).
                await withTimeout(r.del(`dm:dedupe:${workspaceId}:${channel}:${input.recipient}:${textHash(input.text)}`)).catch(() => {});
                return { ok: false, refusal: 'ceiling', pausedUntil, pauseStarted: !!first };
            }
        }
        return { ok: true };
    } catch (error) {
        console.warn('[Messaging] Send limits unavailable (Redis), sending without them:', (error as Error).message);
        return { ok: true };
    }
}

/** A send that failed after passing the checks: forget its dedupe mark so a retry can send it. */
export async function releaseDedupe(workspaceId: string, channel: string, recipient: string, text: string, r: GuardRedis = sharedRedis as unknown as GuardRedis) {
    try {
        await withTimeout(r.del(`dm:dedupe:${workspaceId}:${channel}:${recipient}:${textHash(text)}`));
    } catch {
        /* fails open */
    }
}

// ─── Our own sent message ids (to tell our echoes from the owner's manual replies) ───────────────

const OWN_MID_TTL_MS = 24 * 3600 * 1000;

export async function rememberOwnMessage(mid: string, r: GuardRedis = sharedRedis as unknown as GuardRedis) {
    if (!mid) return;
    try {
        await withTimeout(r.set(`dm:own:${mid}`, '1', 'PX', OWN_MID_TTL_MS));
    } catch {
        /* the thread's lastOut text hash is the fallback */
    }
}

export async function isOwnMessage(mid: string, r: GuardRedis = sharedRedis as unknown as GuardRedis): Promise<boolean | null> {
    if (!mid) return false;
    try {
        return !!(await withTimeout(r.get(`dm:own:${mid}`)));
    } catch {
        return null; // unknown
    }
}
