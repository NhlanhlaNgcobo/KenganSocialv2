import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { redis } from '../utils/redis';
import { PLAN_LIMITS, PlanFeature } from '../utils/planLimits';
import { getMonth, endOfMonth } from '../utils/dateUtils';

export type UsageResult = { ok: boolean; status: number; body: Record<string, any> };
const ALLOWED: UsageResult = { ok: true, status: 200, body: {} };

/**
 * Uses `units` of a plan feature for this month, or refuses if that would pass the plan's limit.
 * Units let costly actions count for more (e.g. an AI image is several AI credits, a 3-hour video
 * is 3 transcription hours). Usable from routes after the request has been validated.
 */
export async function consumeUsage(workspaceId: string, plan: string, feature: PlanFeature, units = 1): Promise<UsageResult> {
    const limit = (PLAN_LIMITS as any)[plan]?.[feature] ?? 0;
    const amount = Math.max(1, Math.ceil(units));

    // 1. Feature completely locked on this plan
    if (limit === 0) {
        return {
            ok: false,
            status: 402,
            body: { error: 'FEATURE_LOCKED', message: `${feature} is not available on the ${plan} plan.`, upgradeUrl: '/settings/billing', currentPlan: plan },
        };
    }

    // 2. Unlimited (-1) — track for usage but do not block
    if (limit === -1) {
        await trackAgencyUsage(workspaceId, feature, amount);
        return ALLOWED;
    }

    // 3. Hard cap — check Redis counter
    const key = `usage:${workspaceId}:${feature}:${getMonth()}`;
    try {
        const current = parseInt((await redis.get(key)) || '0');
        if (current + amount > limit) {
            return {
                ok: false,
                status: 402,
                body: {
                    error: 'PLAN_LIMIT_EXCEEDED',
                    message:
                        amount > 1
                            ? `This needs ${amount} of your ${feature} allowance and ${Math.max(0, limit - current)} of ${limit} are left this month.`
                            : `You've used all ${limit} of your ${feature} allowance this month.`,
                    feature,
                    limit,
                    current,
                    needed: amount,
                    upgradeUrl: '/settings/billing',
                    currentPlan: plan,
                },
            };
        }
        const multi = redis.multi();
        multi.incrby(key, amount);
        multi.expireat(key, endOfMonth());
        await multi.exec();
        return ALLOWED;
    } catch (err) {
        console.error('[PlanGate] Redis check failed:', err);
        // Local development runs without Redis, so allow. In production a usage counter we cannot
        // read would mean unmetered AI and rendering costs, so refuse until Redis is back.
        if (process.env.NODE_ENV !== 'production') return ALLOWED;
        return {
            ok: false,
            status: 503,
            body: { error: 'USAGE_UNAVAILABLE', message: "We can't check your plan's usage right now. Try again in a minute." },
        };
    }
}

/** Gives back units taken by consumeUsage when the work is then refused for another reason. */
export async function refundUsage(workspaceId: string, plan: string, feature: PlanFeature, units = 1) {
    const limit = (PLAN_LIMITS as any)[plan]?.[feature] ?? 0;
    if (limit <= 0) return;
    try {
        await redis.decrby(`usage:${workspaceId}:${feature}:${getMonth()}`, Math.max(1, Math.ceil(units)));
    } catch (err) {
        console.error('[PlanGate] Refund failed:', err);
    }
}

/**
 * Middleware to check if the current workspace has reached its plan limits
 * for a specific feature. `units` (a number or a function of the request) weights costly requests.
 */
export function checkLimit(feature: PlanFeature, units: number | ((req: Request) => number) = 1) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const workspaceId = (req as any).workspaceId;
        const plan = (req as any).plan || 'starter';

        if (!workspaceId) {
            return res.status(400).json({ error: 'WORKSPACE_ID_MISSING' });
        }

        let amount = 1;
        try {
            amount = typeof units === 'function' ? units(req) : units;
        } catch {
            amount = 1;
        }
        const result = await consumeUsage(workspaceId, plan, feature, amount);
        if (!result.ok) return res.status(result.status).json(result.body);
        next();
    };
}

/**
 * Agency overage tracker — tracks usage above fair-use thresholds.
 */
async function trackAgencyUsage(workspaceId: string, feature: string, amount = 1) {
    const key = `agency_usage:${workspaceId}:${feature}:${getMonth()}`;
    try {
        await redis.incrby(key, amount);
    } catch (err) {
        console.error('[PlanGate] Agency usage tracking failed:', err);
    }
}

/**
 * Per-plan rate limiter — provides higher throughput for higher-tier users.
 */
export function planRateLimit() {
    return rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: (req: any) => {
            const plan = req.plan || 'starter';
            const rates: Record<string, number> = {
                starter: 20,
                nano: 60,
                creator: 120,
                agency: 300
            };
            return rates[plan] || rates.starter;
        },
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many requests for your current plan. Please wait a moment.' }
    });
}
/**
 * Middleware to require a minimum plan level.
 */
export function requirePlan(minPlan: 'starter' | 'nano' | 'creator' | 'agency') {
    return (req: Request, res: Response, next: NextFunction) => {
        const plan = (req as any).plan || 'starter';
        const hierarchy = { starter: 1, nano: 2, creator: 3, agency: 4 };

        if (hierarchy[plan as keyof typeof hierarchy] < hierarchy[minPlan]) {
            return res.status(403).json({
                error: 'UPGRADE_REQUIRED',
                message: `This feature requires a ${minPlan} plan or higher.`,
                upgradeUrl: '/settings/billing',
                currentPlan: plan,
                requiredPlan: minPlan
            });
        }
        next();
    };
}
