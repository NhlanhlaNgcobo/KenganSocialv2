import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/firestore';
import { PLAN_CATALOG, ANNUAL_DISCOUNT } from '../config/plan-catalog';
import type { Plan } from '../utils/planLimits';

function computeAmount(planId: string, interval: 'monthly' | 'yearly') {
    const baseAmount = PLAN_CATALOG[planId].amountZar;
    if (interval === 'yearly') {
        return Math.round(baseAmount * 12 * ANNUAL_DISCOUNT * 100);
    }
    return Math.round(baseAmount * 100);
}

export function addPeriod(from: Date, interval: 'monthly' | 'yearly') {
    const end = new Date(from);
    const day = end.getUTCDate();
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + (interval === 'yearly' ? 12 : 1));
    const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
    end.setUTCDate(Math.min(day, lastDay));
    return end.toISOString();
}

export type PaystackTransaction = {
    id?: number | string;
    status?: string;
    reference?: string;
    amount?: number;
    currency?: string;
    paid_at?: string;
    metadata?: any;
    customer?: { customer_code?: string; email?: string };
    subscription?: { subscription_code?: string };
};

type ActivationResult =
    | { ok: true; alreadyProcessed: boolean; planId: string; tier: Plan; workspaceId: string; currentPeriodEnd: string }
    | { ok: false; reason: string };

/**
 * Applies a successful Paystack charge to its workspace. Idempotent per transaction id,
 * shared by the webhook and the return-from-checkout verification.
 */
export async function activateFromTransaction(tx: PaystackTransaction, source: 'webhook' | 'verify'): Promise<ActivationResult> {
    if (tx.status !== 'success') return { ok: false, reason: 'PAYMENT_NOT_SUCCESSFUL' };

    const metadata = typeof tx.metadata === 'string' ? safeJson(tx.metadata) : (tx.metadata || {});
    const workspaceId = metadata?.workspaceId;
    const planId = metadata?.requestedPlan;
    const interval: 'monthly' | 'yearly' = metadata?.billingInterval === 'yearly' ? 'yearly' : 'monthly';
    const catalogEntry = PLAN_CATALOG[planId];

    if (!workspaceId || !catalogEntry || catalogEntry.contactOnly) return { ok: false, reason: 'UNKNOWN_PLAN_OR_WORKSPACE' };
    if (tx.currency !== 'ZAR') return { ok: false, reason: 'UNEXPECTED_CURRENCY' };
    if (!Number.isSafeInteger(tx.amount) || tx.amount !== computeAmount(planId, interval)) {
        return { ok: false, reason: 'AMOUNT_TOO_LOW' };
    }

    const txId = tx.id ? String(tx.id) : tx.reference ? `ref_${tx.reference}` : null;
    if (!txId) return { ok: false, reason: 'MISSING_TRANSACTION_ID' };

    const idempotencyRef = db.collection('processed_webhooks').doc(txId);
    const paidAt = new Date(tx.paid_at || '');
    if (!Number.isFinite(paidAt.getTime())) return { ok: false, reason: 'INVALID_PAYMENT_DATE' };
    const currentPeriodEnd = addPeriod(Number.isNaN(paidAt.getTime()) ? new Date() : paidAt, interval);

    const workspaceRef = db.collection('workspaces').doc(workspaceId);
    const claimed = await db.runTransaction(async (t) => {
        const existing = await t.get(idempotencyRef);
        const workspace = await t.get(workspaceRef);
        if (!workspace.exists) throw new Error('Billing workspace missing');
        if (existing.exists) return false;
        const ws = workspace.data()!;
        // Delayed successful charges cannot roll a newer entitlement backwards.
        const newer = !ws.lastPaidAt || paidAt.getTime() >= Date.parse(ws.lastPaidAt);
        t.set(idempotencyRef, { provider: 'paystack', source, workspaceId, reference: tx.reference || null,
            processedAt: FieldValue.serverTimestamp() });
        if (newer) t.update(workspaceRef, {
            plan: catalogEntry.tier, billingPlanId: planId, billingInterval: interval,
            paymentProvider: 'paystack', paystackReference: tx.reference || null,
            paystackCustomerCode: tx.customer?.customer_code || ws.paystackCustomerCode || null,
            paystackCustomerEmail: tx.customer?.email || ws.paystackCustomerEmail || null,
            paymentStatus: 'active', currentPeriodEnd,
            lastPaidAt: paidAt.toISOString(),
            pendingPlan: FieldValue.delete(),
            pendingBillingInterval: FieldValue.delete(),
            pendingPaymentProvider: FieldValue.delete(),
            checkoutUrl: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        return true;
    });

    return { ok: true, alreadyProcessed: !claimed, planId, tier: catalogEntry.tier, workspaceId, currentPeriodEnd };
}

export function safeJson(value: string) {
    try {
        return JSON.parse(value);
    } catch {
        return {};
    }
}

