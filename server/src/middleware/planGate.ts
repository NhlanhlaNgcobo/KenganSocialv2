import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { redis } from '../utils/redis';
import { PLAN_LIMITS, PlanFeature } from '../utils/planLimits';
import { getMonth, endOfMonth } from '../utils/dateUtils';

/**
 * Middleware to check if the current workspace has reached its plan limits
 * for a specific feature.
 */
export function checkLimit(feature: PlanFeature) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const workspaceId = (req as any).workspaceId;
        const plan = (req as any).plan || 'starter';

        if (!workspaceId) {
            return res.status(400).json({ error: 'WORKSPACE_ID_MISSING' });
        }

        const limit = (PLAN_LIMITS as any)[plan]?.[feature] ?? 0;

        // 1. Feature completely locked on this plan
        if (limit === 0) {
            return res.status(402).json({
                error: 'FEATURE_LOCKED',
                message: `${feature} is not available on the ${plan} plan.`,
                upgradeUrl: '/settings/billing',
                currentPlan: plan
            });
        }

        // 2. Agency unlimited (-1) — track for usage but do not block
        if (limit === -1) {
            await trackAgencyUsage(workspaceId, feature);
            return next();
        }

        // 3. Hard cap — check Redis counter
        const key = `usage:${workspaceId}:${feature}:${getMonth()}`;
        try {
            const current = parseInt(await redis.get(key) || '0');

            if (current >= limit) {
                return res.status(402).json({
                    error: 'PLAN_LIMIT_EXCEEDED',
                    feature,
                    limit,
                    current,
                    upgradeUrl: '/settings/billing',
                    currentPlan: plan
                });
            }

            // Increment and set expiry if it's the first hit
            const multi = redis.multi();
            multi.incr(key);
            multi.expireat(key, endOfMonth());
            await multi.exec();

            next();
        } catch (err) {
            console.error('[PlanGate] Redis check failed:', err);
            // Fail open in case of Redis issues to ensure service availability
            next();
        }
    }
}

/**
 * Agency overage tracker — tracks usage above fair-use thresholds.
 */
async function trackAgencyUsage(workspaceId: string, feature: string) {
    const key = `agency_usage:${workspaceId}:${feature}:${getMonth()}`;
    try {
        await redis.incr(key);
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
