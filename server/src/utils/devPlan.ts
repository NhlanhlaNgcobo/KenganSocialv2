import { PLAN_LIMITS } from './planLimits';

/**
 * Local testing aid: DEV_PLAN_OVERRIDE=creator (etc.) makes every workspace act as that
 * plan. Only honoured when NODE_ENV is "development", so it cannot unlock paid features
 * in production even if the variable is set there by mistake.
 */
export function applyDevPlanOverride(plan: string): string {
    const override = process.env.DEV_PLAN_OVERRIDE;
    if (process.env.NODE_ENV === 'development' && override && override in PLAN_LIMITS) {
        return override;
    }
    return plan;
}

export function logDevPlanOverride() {
    const override = process.env.DEV_PLAN_OVERRIDE;
    if (!override) return;
    if (process.env.NODE_ENV !== 'development') {
        console.warn(`[Plan] DEV_PLAN_OVERRIDE=${override} ignored because NODE_ENV is not "development".`);
    } else if (!(override in PLAN_LIMITS)) {
        console.warn(`[Plan] DEV_PLAN_OVERRIDE=${override} is not a known plan (${Object.keys(PLAN_LIMITS).join(', ')}).`);
    } else {
        console.warn(`[Plan] ⚠️  DEV_PLAN_OVERRIDE active: every workspace is treated as "${override}" (development only).`);
    }
}
