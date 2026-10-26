import { db } from '../../utils/firestore';
import { PLAN_LIMITS, PLAN_DISPLAY_NAMES, type Plan } from '../../utils/planLimits';
import { effectivePlan } from '../../utils/trial';
import { applyDevPlanOverride } from '../../utils/devPlan';

/**
 * Which Inbox and automation features a plan includes (the same rules for the HTTP routes and for
 * webhooks, which run without a signed-in user):
 *  - keyword rules (Automations page rules and Inbox auto-replies together): PLAN_LIMITS.dms active
 *    rules (0 = not on this plan, -1 = unlimited). Free has none; rules stop running on it;
 *  - the reply approval queue with AI drafts: Creator Pro and Agency (routes/dm.ts GET /queue);
 *  - Leads, including the "add to Leads" action: Agency (routes/leads.ts requirePlan('agency')).
 */

export const QUEUE_PLANS: Plan[] = ['creator', 'agency'];
export const LEADS_PLANS: Plan[] = ['agency'];

const asPlan = (plan: unknown): Plan => (typeof plan === 'string' && plan in PLAN_LIMITS ? (plan as Plan) : 'starter');

export const ruleLimit = (plan: unknown) => PLAN_LIMITS[asPlan(plan)].dms;
export const hasQueue = (plan: unknown) => QUEUE_PLANS.includes(asPlan(plan));
export const hasLeads = (plan: unknown) => LEADS_PLANS.includes(asPlan(plan));
export const automationsEnabled = (plan: unknown) => ruleLimit(plan) !== 0;

/** The plan a workspace has now (paid plan or running trial), as withWorkspace computes it. */
export async function workspacePlan(workspaceId: string): Promise<Plan> {
    const snap = await db.collection('workspaces').doc(workspaceId).get();
    return asPlan(applyDevPlanOverride(effectivePlan(snap.data() || {}), snap.data()));
}

/** Active keyword rules across both rule lists, leaving out one rule (the one being changed). */
export async function countActiveRules(workspaceId: string, exclude?: { collection: 'automations' | 'dmAutomations'; id: string }) {
    const ws = db.collection('workspaces').doc(workspaceId);
    const [rules, autoReplies] = await Promise.all([
        ws.collection('automations').where('status', '==', 'active').get(),
        ws.collection('dmAutomations').where('isActive', '==', true).get(),
    ]);
    const skip = (col: string, id: string) => exclude?.collection === col && exclude.id === id;
    return rules.docs.filter((d) => !skip('automations', d.id)).length + autoReplies.docs.filter((d) => !skip('dmAutomations', d.id)).length;
}

export type Allowance = { ok: boolean; status: number; body: Record<string, unknown> };

/** Pure check: may one more active rule (optionally with the add-to-Leads action) exist on this plan? */
export function ruleAllowance(plan: unknown, activeOthers: number, opts: { addsLead?: boolean } = {}): Allowance {
    const p = asPlan(plan);
    const limit = ruleLimit(p);
    const upgrade = { upgradeUrl: '/settings/billing', currentPlan: p };
    if (limit === 0) {
        return { ok: false, status: 402, body: { error: 'FEATURE_LOCKED', message: `Automations are not included in the ${PLAN_DISPLAY_NAMES[p]} plan. Upgrade to Creator Starter or higher.`, ...upgrade } };
    }
    if (opts.addsLead && !hasLeads(p)) {
        return { ok: false, status: 402, body: { error: 'FEATURE_LOCKED', message: 'Adding people to Leads is part of the Agency plan.', ...upgrade } };
    }
    if (limit > 0 && activeOthers >= limit) {
        return {
            ok: false,
            status: 402,
            body: { error: 'PLAN_LIMIT_EXCEEDED', message: `Your plan allows ${limit} active automation rules (Automations and Inbox auto-replies together). Pause one, or upgrade.`, limit, current: activeOthers, ...upgrade },
        };
    }
    return { ok: true, status: 200, body: {} };
}
