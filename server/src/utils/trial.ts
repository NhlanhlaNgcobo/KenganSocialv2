/**
 * Full-access trial for new accounts. A user's first workspace gets `trialPlan` until
 * `trialEndsAt`; its paid `plan` stays as it is (starter), so the trial simply stops applying when
 * it ends and a purchase during the trial takes over as normal.
 *
 * TRIAL_PLAN: the plan new accounts try (default agency, everything unlocked).
 * TRIAL_DAYS: trial length in days (default 7; 0 turns trials off for new accounts).
 */
import { PLAN_LIMITS, Plan } from './planLimits';

const RANK: Record<Plan, number> = { starter: 0, nano: 1, creator: 2, agency: 3 };

function trialPlan(): Plan | null {
    const plan = (process.env.TRIAL_PLAN || 'agency') as Plan;
    return plan in PLAN_LIMITS && plan !== 'starter' ? plan : null;
}

function trialDays(): number {
    const days = Number(process.env.TRIAL_DAYS ?? 7);
    return Number.isFinite(days) && days > 0 ? days : 0;
}

/** Fields to store on a user's first workspace (empty when trials are off). */
export function newWorkspaceTrial(now = new Date()): { trialPlan?: Plan; trialEndsAt?: string } {
    const plan = trialPlan();
    const days = trialDays();
    if (!plan || !days) return {};
    return { trialPlan: plan, trialEndsAt: new Date(now.getTime() + days * 86400000).toISOString() };
}

/** The trial still running on this workspace, or null. */
export function activeTrial(ws: any, now = Date.now()): { plan: Plan; endsAt: string } | null {
    const plan = ws?.trialPlan as Plan;
    const endsAt = ws?.trialEndsAt;
    if (!plan || !(plan in PLAN_LIMITS) || typeof endsAt !== 'string') return null;
    return Date.parse(endsAt) > now ? { plan, endsAt } : null;
}

/** The trial's end date when the workspace's plan currently comes from its trial, else null. */
export function trialEndsAt(ws: any, now = Date.now()): string | null {
    const trial = activeTrial(ws, now);
    if (!trial) return null;
    const paidOnly = effectivePlan({ ...ws, trialPlan: null }, now);
    return RANK[trial.plan] > RANK[paidOnly] ? trial.endsAt : null;
}

/** Free beta switched on (BETA_ACCESS=on); its features follow BETA_PLAN (default creator). */
export function betaPlan(): Plan | null {
    if (!/^(on|true|1)$/i.test(String(process.env.BETA_ACCESS || ''))) return null;
    const plan = (process.env.BETA_PLAN || 'creator') as Plan;
    return plan in PLAN_LIMITS && plan !== 'starter' ? plan : null;
}

/** Whether the workspace's plan comes from the free beta (no paid plan above it, no running trial). */
export function onBeta(ws: any, now = Date.now()): boolean {
    const beta = betaPlan();
    if (!beta || ws?.unlimited === true) return false;
    return effectivePlan({ ...ws, betaOff: true }, now) === 'starter';
}

/** The plan a workspace gets: its paid plan, or a running trial's plan when that is higher. */
export function effectivePlan(ws: any, now = Date.now()): Plan {
    // Internal test workspaces (server-only flag, set with scripts/set-unlimited.mjs): every feature.
    if (ws?.unlimited === true) return 'agency';
    let paid = ((ws?.plan as Plan) in PLAN_LIMITS ? ws.plan : 'starter') as Plan;
    // Provider-managed access must have a valid paid-through date. Manual pilot grants remain explicit.
    if (ws?.paymentProvider && (!Number.isFinite(Date.parse(ws.currentPeriodEnd)) || Date.parse(ws.currentPeriodEnd) <= now)) paid = 'starter';
    const trial = activeTrial(ws, now);
    const plan = trial && RANK[trial.plan] > RANK[paid] ? trial.plan : paid;
    // Free beta: workspaces that would otherwise be on the free plan get the beta plan's features.
    const beta = ws?.betaOff ? null : betaPlan();
    return plan === 'starter' && beta ? beta : plan;
}
