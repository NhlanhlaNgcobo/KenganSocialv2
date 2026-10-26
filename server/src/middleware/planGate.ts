import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { readyUsageRedis } from '../utils/usageRedis';
import { RESERVE_USAGE, REFUND_USAGE } from '../services/usage-reservation';
import { BETA_LIMITS, BETA_MAX_SOURCE_MINUTES, MAX_SOURCE_MINUTES, PLAN_LIMITS, PlanFeature, TRIAL_LIMITS, TRIAL_MEDIA_PLAN } from '../utils/planLimits';
import { getMonth, endOfMonth } from '../utils/dateUtils';

export type UsageResult = { ok: boolean; status: number; body: Record<string, any> };
const ALLOWED: UsageResult = { ok: true, status: 200, body: {} };

/**
 * Workspaces on their free trial (set by withWorkspace on every request): the trial unlocks the
 * trial plan's features, but usage is capped at TRIAL_LIMITS so a sign-up can't run up costs.
 */
const trials = new Map<string, number>(); // workspaceId -> trial end (ms)
export function noteTrial(workspaceId: string, endsAt: string | null) {
    if (!workspaceId) return;
    const end = endsAt ? Date.parse(endsAt) : NaN;
    if (Number.isFinite(end) && end > Date.now()) trials.set(workspaceId, end);
    else trials.delete(workspaceId);
}

/**
 * Internal test workspaces (`unlimited: true` on the workspace, server-only): no monthly caps.
 * Set by withWorkspace on every request, like trials.
 */
const unlimitedWorkspaces = new Set<string>();
export function noteUnlimited(workspaceId: string, unlimited: boolean) {
    if (!workspaceId) return;
    if (unlimited) unlimitedWorkspaces.add(workspaceId);
    else unlimitedWorkspaces.delete(workspaceId);
}
export const isUnlimited = (workspaceId: string) => unlimitedWorkspaces.has(workspaceId);

/** Workspaces on the free beta (BETA_ACCESS=on; set by withWorkspace like trials): BETA_LIMITS apply. */
const betas = new Set<string>();
export function noteBeta(workspaceId: string, beta: boolean) {
    if (!workspaceId) return;
    if (beta) betas.add(workspaceId);
    else betas.delete(workspaceId);
}
export const isBeta = (workspaceId: string) => betas.has(workspaceId);

/** The monthly allowance for a feature: the plan's, or the trial or beta cap while one applies. */
export function usageLimit(workspaceId: string, plan: string, feature: PlanFeature): number {
    if (unlimitedWorkspaces.has(workspaceId)) return -1;
    const limit = (PLAN_LIMITS as any)[plan]?.[feature] ?? 0;
    if (betas.has(workspaceId)) {
        if (limit === 0) return 0;
        const cap = (BETA_LIMITS as any)[feature] ?? limit;
        return limit === -1 ? cap : Math.min(limit, cap);
    }
    const trialEnd = trials.get(workspaceId);
    if (!trialEnd || trialEnd <= Date.now()) return limit;
    const cap = (TRIAL_LIMITS as any)[feature] ?? limit;
    if (limit === 0) return 0;
    return limit === -1 ? cap : Math.min(limit, cap);
}

/**
 * The plan whose video length limit and speech model apply: Creator Starter's while a trial runs
 * (TRIAL_MEDIA_PLAN), otherwise the workspace's own plan.
 */
export function mediaPlan(workspaceId: string, plan: string): string {
    if (betas.has(workspaceId)) return TRIAL_MEDIA_PLAN; // fast speech model on the small beta server
    const trialEnd = trials.get(workspaceId);
    if (!trialEnd || trialEnd <= Date.now()) return plan;
    const limit = (MAX_SOURCE_MINUTES as any)[plan] ?? 0;
    return limit > MAX_SOURCE_MINUTES[TRIAL_MEDIA_PLAN] ? TRIAL_MEDIA_PLAN : plan;
}

/** Longest source video (minutes) for this workspace now: the plan's, the trial's or the beta's. */
export function maxSourceMinutes(workspaceId: string, plan: string): number {
    const max = (MAX_SOURCE_MINUTES as any)[mediaPlan(workspaceId, plan)] ?? 0;
    return betas.has(workspaceId) ? Math.min(max, BETA_MAX_SOURCE_MINUTES) : max;
}

/**
 * Uses `units` of a plan feature for this month, or refuses if that would pass the plan's limit.
 * Units let costly actions count for more (e.g. an AI image is several AI credits, a 3-hour video
 * is 3 transcription hours). Usable from routes after the request has been validated.
 */
export async function consumeUsage(workspaceId: string, plan: string, feature: PlanFeature, units = 1): Promise<UsageResult> {
    const limit = usageLimit(workspaceId, plan, feature);
    const amount = Math.max(1, Math.ceil(units));
    if (!workspaceId || !Number.isSafeInteger(amount)) return { ok: false, status: 400, body: { error: 'INVALID_USAGE_REQUEST' } };

    // 1. Feature completely locked on this plan
    if (limit === 0) {
        return {
            ok: false,
            status: 402,
            body: { error: 'FEATURE_LOCKED', message: `${feature} is not available on the ${plan} plan.`, upgradeUrl: '/settings/billing', currentPlan: plan },
        };
    }

    // 2. Unlimited (-1) — track for usage but do not block
    const key = `${limit === -1 ? 'agency_usage' : 'usage'}:${workspaceId}:${feature}:${getMonth()}`;
    try {
        const redis = await readyUsageRedis();
        const [allowed, current] = await redis.eval(RESERVE_USAGE, 1, key, amount, limit, endOfMonth()) as [number, number];
        if (!allowed) {
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
    const limit = usageLimit(workspaceId, plan, feature);
    if (limit <= 0) return;
    try {
        const redis = await readyUsageRedis();
        await redis.eval(REFUND_USAGE, 1, `usage:${workspaceId}:${feature}:${getMonth()}`, Math.max(1, Math.ceil(units)));
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
