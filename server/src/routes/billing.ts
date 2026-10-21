import { createHmac } from 'node:crypto';
import express, { Request, Response } from 'express';
import axios from 'axios';
import admin from 'firebase-admin';
import { db } from '../utils/firestore';
import { withWorkspace } from '../middleware/withWorkspace';
import { PLAN_LIMITS, PLAN_DISPLAY_NAMES, Plan, PlanFeature } from '../utils/planLimits';
import { redis } from '../utils/redis';
import { getMonth } from '../utils/dateUtils';
import { calculateWorkspaceStorage } from '../utils/storage';
import { ANNUAL_DISCOUNT, BILLING_EMAIL, PLAN_CATALOG, publicCatalog } from '../config/plan-catalog';
import { activeTrial } from '../utils/trial';

export { BILLING_EMAIL };

const router = express.Router();

const PAYSTACK_API_BASE = 'https://api.paystack.co';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const PAYSTACK_CALLBACK_URL = process.env.PAYSTACK_CALLBACK_URL || `${FRONTEND_URL}/dashboard/billing`;
const BILLING_SUPPORT_URL = process.env.PAYSTACK_BILLING_SUPPORT_URL || `mailto:${BILLING_EMAIL}`;
const PAYMENTS_NOT_CONFIGURED = "Payments aren't set up yet. Contact us to upgrade and we'll sort it out.";

// Which paid plan a workspace on each internal tier is shown as (used when the workspace has no billingPlanId).
const TIER_TO_CATALOG: Partial<Record<Plan, string>> = {
    nano: 'creator_starter',
    creator: 'creator_pro',
    agency: 'agency',
};

const TIER_RANK: Record<Plan, number> = { starter: 0, nano: 1, creator: 2, agency: 3 };

function isPlan(value: unknown): value is Plan {
    return typeof value === 'string' && value in PLAN_LIMITS;
}

/** Maps legacy/unknown workspace plan values onto a real internal tier. */
function toTier(value: unknown): Plan {
    if (isPlan(value)) return value;
    if (value === 'enterprise') return 'agency';
    return 'starter';
}

function computeAmount(planId: string, interval: 'monthly' | 'yearly') {
    const baseAmount = PLAN_CATALOG[planId].amountZar;
    if (interval === 'yearly') {
        return Math.round(baseAmount * 12 * ANNUAL_DISCOUNT * 100);
    }
    return Math.round(baseAmount * 100);
}

function addPeriod(from: Date, interval: 'monthly' | 'yearly') {
    const end = new Date(from);
    if (interval === 'yearly') end.setUTCFullYear(end.getUTCFullYear() + 1);
    else end.setUTCMonth(end.getUTCMonth() + 1);
    return end.toISOString();
}

async function fetchWorkspaceContact(uid: string) {
    const userRecord = await admin.auth().getUser(uid);
    return {
        email: userRecord.email,
        name: userRecord.displayName || userRecord.email?.split('@')[0] || 'KenganSocial User',
    };
}

/** Reads this month's usage counters. Returns null when Redis is unavailable (never invented numbers). */
async function readUsage(workspaceId: string, tier: Plan): Promise<Record<string, number> | null> {
    if (!redis || redis.status !== 'ready') return null;
    const month = getMonth();
    const limits = PLAN_LIMITS[tier];
    const usage: Record<string, number> = {};
    try {
        await Promise.all((Object.keys(limits) as PlanFeature[]).map(async (feature) => {
            if (feature === 'storageGB') return;
            // planGate counts unlimited (-1) features under agency_usage and capped ones under usage.
            const prefix = limits[feature] === -1 ? 'agency_usage' : 'usage';
            const val = await redis.get(`${prefix}:${workspaceId}:${feature}:${month}`);
            usage[feature] = val ? parseFloat(val) : 0;
        }));
        return usage;
    } catch (err: any) {
        console.warn('[Billing] Usage lookup failed:', err?.message);
        return null;
    }
}

type PaystackTransaction = {
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
async function activateFromTransaction(tx: PaystackTransaction, source: 'webhook' | 'verify'): Promise<ActivationResult> {
    if (tx.status !== 'success') return { ok: false, reason: 'PAYMENT_NOT_SUCCESSFUL' };

    const metadata = typeof tx.metadata === 'string' ? safeJson(tx.metadata) : (tx.metadata || {});
    const workspaceId = metadata?.workspaceId;
    const planId = metadata?.requestedPlan;
    const interval: 'monthly' | 'yearly' = metadata?.billingInterval === 'yearly' ? 'yearly' : 'monthly';
    const catalogEntry = PLAN_CATALOG[planId];

    if (!workspaceId || !catalogEntry || catalogEntry.contactOnly) return { ok: false, reason: 'UNKNOWN_PLAN_OR_WORKSPACE' };
    if (tx.currency && tx.currency !== 'ZAR') return { ok: false, reason: 'UNEXPECTED_CURRENCY' };
    if (typeof tx.amount === 'number' && tx.amount < computeAmount(planId, interval)) {
        return { ok: false, reason: 'AMOUNT_TOO_LOW' };
    }

    const txId = tx.id ? String(tx.id) : tx.reference ? `ref_${tx.reference}` : null;
    if (!txId) return { ok: false, reason: 'MISSING_TRANSACTION_ID' };

    const idempotencyRef = db.collection('processed_webhooks').doc(txId);
    const paidAt = tx.paid_at ? new Date(tx.paid_at) : new Date();
    const currentPeriodEnd = addPeriod(Number.isNaN(paidAt.getTime()) ? new Date() : paidAt, interval);

    const claimed = await db.runTransaction(async (t) => {
        const existing = await t.get(idempotencyRef);
        if (existing.exists) return false;
        t.set(idempotencyRef, {
            provider: 'paystack',
            source,
            workspaceId,
            reference: tx.reference || null,
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return true;
    });

    if (!claimed) {
        return { ok: true, alreadyProcessed: true, planId, tier: catalogEntry.tier, workspaceId, currentPeriodEnd };
    }

    try {
        await db.collection('workspaces').doc(workspaceId).set({
            plan: catalogEntry.tier,
            billingPlanId: planId,
            billingInterval: interval,
            paymentProvider: 'paystack',
            paystackReference: tx.reference || null,
            paystackCustomerCode: tx.customer?.customer_code || null,
            paystackCustomerEmail: tx.customer?.email || null,
            paystackSubscriptionCode: tx.subscription?.subscription_code || null,
            paymentStatus: 'active',
            currentPeriodEnd,
            pendingPlan: admin.firestore.FieldValue.delete(),
            pendingBillingInterval: admin.firestore.FieldValue.delete(),
            pendingPaymentProvider: admin.firestore.FieldValue.delete(),
            planActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    } catch (err) {
        // Release the claim so a retry (webhook redelivery or another verify) can apply it.
        await idempotencyRef.delete().catch(() => undefined);
        throw err;
    }

    return { ok: true, alreadyProcessed: false, planId, tier: catalogEntry.tier, workspaceId, currentPeriodEnd };
}

function safeJson(value: string) {
    try {
        return JSON.parse(value);
    } catch {
        return {};
    }
}

// ─── GET /api/billing/plans (public) ─────────────────────────────────────────
router.get('/plans', (_req: Request, res: Response) => {
    res.json({ success: true, ...publicCatalog({ paymentsConfigured: Boolean(PAYSTACK_SECRET_KEY), supportUrl: BILLING_SUPPORT_URL }) });
});

// ─── POST /api/billing/create-checkout ───────────────────────────────────────
router.post('/create-checkout', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const uid = (req as any).uid;
    const requestedPlan = String(req.body?.planName || '');
    const interval = req.body?.interval === 'yearly' ? 'yearly' : 'monthly';
    const catalogEntry = PLAN_CATALOG[requestedPlan];

    if (!workspaceId) {
        return res.status(400).json({ error: 'Create a workspace before choosing a plan.' });
    }

    if (!catalogEntry) {
        return res.status(400).json({ error: 'That plan does not exist.' });
    }

    if (catalogEntry.contactOnly) {
        return res.status(400).json({ error: `${catalogEntry.label} is arranged directly. Email ${BILLING_EMAIL}.` });
    }

    if (!PAYSTACK_SECRET_KEY) {
        return res.status(503).json({ error: PAYMENTS_NOT_CONFIGURED, code: 'PAYMENTS_NOT_CONFIGURED', provider: 'paystack' });
    }

    try {
        const contact = await fetchWorkspaceContact(uid);
        if (!contact.email) {
            return res.status(400).json({ error: 'Your account needs an email address before you can pay.' });
        }

        const amount = computeAmount(requestedPlan, interval);
        const response = await axios.post(
            `${PAYSTACK_API_BASE}/transaction/initialize`,
            {
                email: contact.email,
                amount,
                currency: 'ZAR',
                callback_url: PAYSTACK_CALLBACK_URL,
                metadata: {
                    workspaceId,
                    uid,
                    requestedPlan,
                    billingInterval: interval,
                    paymentType: 'subscription',
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                    'Content-Type': 'application/json',
                },
                timeout: 15000,
            }
        );

        const url = response.data?.data?.authorization_url;
        if (!url) {
            return res.status(502).json({ error: 'The payment provider did not return a checkout link. Try again.' });
        }

        await db.collection('workspaces').doc(workspaceId).set({
            pendingPaymentProvider: 'paystack',
            pendingPlan: requestedPlan,
            pendingBillingInterval: interval,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        res.json({
            success: true,
            provider: 'paystack',
            url,
            reference: response.data?.data?.reference,
        });
    } catch (err: any) {
        console.error('[Billing] Checkout init failed:', err?.response?.data || err.message);
        const errorMessage = err?.response?.data?.message || 'Could not start checkout. Try again in a moment.';
        res.status(502).json({ error: errorMessage, provider: 'paystack' });
    }
});

// ─── GET /api/billing/verify/:reference ──────────────────────────────────────
// Called when the user returns from Paystack (?reference=...). Confirms the charge with
// Paystack and applies the plan without waiting for the webhook.
router.get('/verify/:reference', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const reference = String(req.params.reference || '');

    if (!workspaceId) return res.status(400).json({ error: 'Workspace missing.' });
    if (!/^[A-Za-z0-9._=-]{1,100}$/.test(reference)) return res.status(400).json({ error: 'Invalid payment reference.' });
    if (!PAYSTACK_SECRET_KEY) {
        return res.status(503).json({ error: PAYMENTS_NOT_CONFIGURED, code: 'PAYMENTS_NOT_CONFIGURED' });
    }

    try {
        const response = await axios.get(`${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
            timeout: 15000,
        });
        const tx: PaystackTransaction = response.data?.data || {};
        const metadata = typeof tx.metadata === 'string' ? safeJson(tx.metadata) : (tx.metadata || {});

        // Only the workspace that started the checkout may look at it.
        if (metadata?.workspaceId !== workspaceId) {
            return res.status(403).json({ error: 'This payment belongs to a different workspace.' });
        }

        if (tx.status !== 'success') {
            const pending = tx.status === 'ongoing' || tx.status === 'pending' || tx.status === 'processing';
            return res.json({
                success: false,
                status: pending ? 'pending' : 'failed',
                message: pending
                    ? 'Your payment is still processing. Your plan will update once it clears.'
                    : 'The payment did not go through. You have not been charged for an upgrade.',
            });
        }

        const result = await activateFromTransaction(tx, 'verify');
        if (!result.ok) {
            console.error('[Billing] Verify could not apply payment:', reference, result.reason);
            return res.status(422).json({ error: `We received your payment but could not apply it automatically. Email ${BILLING_EMAIL} with reference ${reference}.` });
        }

        res.json({
            success: true,
            status: 'active',
            plan: result.tier,
            planName: PLAN_CATALOG[result.planId]?.label,
            currentPeriodEnd: result.currentPeriodEnd,
        });
    } catch (err: any) {
        console.error('[Billing] Verify failed:', err?.response?.data || err.message);
        if (err?.response?.status === 404 || err?.response?.status === 400) {
            return res.status(404).json({ error: 'We could not find that payment.' });
        }
        res.status(502).json({ error: 'Could not confirm the payment right now. Refresh in a minute.' });
    }
});

// ─── POST /api/billing/portal ────────────────────────────────────────────────
// Paystack has no hosted customer portal for one-off charges, so changes and cancellations go to billing support.
router.post('/portal', withWorkspace, async (_req: Request, res: Response) => {
    res.json({
        success: true,
        provider: 'paystack',
        url: BILLING_SUPPORT_URL,
        mode: 'support',
    });
});

// ─── GET /api/billing/status ─────────────────────────────────────────────────
router.get('/status', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    if (!workspaceId) {
        return res.status(404).json({ error: 'No workspace found for this account.' });
    }

    try {
        const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
        const ws = wsDoc.data() || {};
        // req.plan is what the plan gates enforce (it includes the development-only override).
        const tier = toTier((req as any).plan || ws.plan);
        const trial = activeTrial(ws);
        const trialOnly = Boolean(trial && trial.plan === tier && toTier(ws.plan) !== tier);
        const catalogId = tier === 'starter'
            ? null
            : (PLAN_CATALOG[ws.billingPlanId]?.tier === tier ? ws.billingPlanId : TIER_TO_CATALOG[tier]) || null;
        const planName = catalogId ? PLAN_CATALOG[catalogId].label : PLAN_DISPLAY_NAMES[tier];

        const usage = await readUsage(workspaceId, tier);
        let storageGB: number | null = null;
        try {
            storageGB = await calculateWorkspaceStorage(workspaceId);
        } catch {
            storageGB = null;
        }

        res.json({
            success: true,
            provider: 'paystack',
            paymentsConfigured: Boolean(PAYSTACK_SECRET_KEY),
            publicKeyConfigured: Boolean(PAYSTACK_PUBLIC_KEY),
            plan: tier,
            planRank: TIER_RANK[tier],
            planId: catalogId || 'starter',
            planName,
            limits: PLAN_LIMITS[tier],
            usage: usage ? { ...usage, storageGB: storageGB ?? 0 } : null,
            usageAvailable: Boolean(usage),
            storageGB,
            billingInterval: ws.billingInterval || null,
            currentPeriodEnd: ws.currentPeriodEnd || null,
            // A running full-access trial (utils/trial.ts) that is above the paid plan.
            paymentStatus: tier === 'starter' ? 'free' : trialOnly ? 'trial' : (ws.paymentStatus || 'inactive'),
            trialEndsAt: trial?.endsAt || null,
            pendingPlan: ws.pendingPlan || null,
            paystackCustomerCode: ws.paystackCustomerCode || null,
            supportEmail: BILLING_EMAIL,
            supportUrl: BILLING_SUPPORT_URL,
        });
    } catch (err: any) {
        console.error('[Billing] Status failed:', err.message);
        res.status(500).json({ error: 'Could not load billing details.' });
    }
});

router.get('/check-limit', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const { feature } = req.query;
    const plan = (req as any).plan || 'starter';

    const limit = (PLAN_LIMITS as any)[plan]?.[feature as string] ?? 0;

    if (limit === 0) {
        return res.json({ allowed: false, error: 'PLAN_LEVEL_LOW' });
    }

    if (limit === -1 || limit > 9000) {
        return res.json({ allowed: true });
    }

    try {
        const key = `usage:${workspaceId}:${feature}:${getMonth()}`;
        const current = parseInt(await redis.get(key) || '0', 10);
        if (current >= limit) {
            return res.json({ allowed: false, error: 'PLAN_LIMIT_REACHED' });
        }
        res.json({ allowed: true });
    } catch (_err: any) {
        res.json({ allowed: true });
    }
});

export async function handlePaystackWebhook(req: Request, res: Response) {
    const rawPayload = (req as any).rawBody || JSON.stringify(req.body || {});
    const signature = req.headers['x-paystack-signature'] as string | undefined;

    if (!PAYSTACK_SECRET_KEY) {
        return res.status(501).send('Paystack not configured');
    }

    const expectedSignature = createHmac('sha512', PAYSTACK_SECRET_KEY)
        .update(rawPayload)
        .digest('hex');

    if (!signature || signature !== expectedSignature) {
        return res.status(400).send('Invalid Paystack signature');
    }

    const event = req.body;

    try {
        if (event?.event === 'charge.success') {
            const result = await activateFromTransaction(event?.data || {}, 'webhook');
            if (!result.ok) {
                console.error('[Paystack Webhook] Charge not applied:', event?.data?.reference, result.reason);
            }
        }

        return res.json({ received: true });
    } catch (err) {
        console.error('[Paystack Webhook Error]', err);
        return res.status(500).send('Webhook processing failed');
    }
}

router.post('/webhook', handlePaystackWebhook);

export default router;
