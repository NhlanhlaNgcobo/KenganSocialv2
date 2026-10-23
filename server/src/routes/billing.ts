import payfastRoutes from './payfast';
import { payfastConfig } from '../services/payfast';
import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { Request, Response } from 'express';
import axios from 'axios';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuth as firebaseAuth } from 'firebase-admin/auth';
import { db } from '../utils/firestore';
import { withWorkspace } from '../middleware/withWorkspace';
import { requireWorkspaceRole } from '../middleware/workspaceAccess';
import { recurringPlan, syncSubscription, subscriptionManagementUrl, paystack } from '../services/paystack-subscriptions';
import { PLAN_LIMITS, PLAN_DISPLAY_NAMES, Plan, PlanFeature } from '../utils/planLimits';
import { redis } from '../utils/redis';
import { getMonth } from '../utils/dateUtils';
import { calculateWorkspaceStorage } from '../utils/storage';
import { ANNUAL_DISCOUNT, BILLING_EMAIL, PLAN_CATALOG, publicCatalog } from '../config/plan-catalog';
import { activeTrial } from '../utils/trial';
import { activateFromTransaction, safeJson, type PaystackTransaction } from '../services/payment-activation';
import { billingAmount as computeAmount } from '../services/paystack-subscriptions';

export { BILLING_EMAIL };

const router = express.Router();
router.use(payfastRoutes);

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

async function fetchWorkspaceContact(uid: string) {
    const userRecord = await firebaseAuth().getUser(uid);
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

// ─── GET /api/billing/plans (public) ─────────────────────────────────────────
router.get('/plans', (_req: Request, res: Response) => {
    res.json({ success: true, ...publicCatalog({ paymentsConfigured: payfastConfig().configured, supportUrl: BILLING_SUPPORT_URL }) });
});

// ─── POST /api/billing/create-checkout ───────────────────────────────────────
router.get('/verify/:reference', withWorkspace, requireWorkspaceRole('owner', 'admin'), async (req: Request, res: Response) => {
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
        if (result.ok === false) {
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
// Subscription customers manage their payment method and cancellation through Paystack.
router.post('/portal', withWorkspace, requireWorkspaceRole('owner', 'admin'), async (req: Request, res: Response) => {
    try {
        const url = await subscriptionManagementUrl((req as any).workspaceId);
        res.json({ success: true, provider: 'paystack', url: url || BILLING_SUPPORT_URL, mode: url ? 'subscription' : 'support' });
    } catch { res.status(502).json({ error: 'Could not open subscription management. Try again shortly.' }); }
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
            provider: ws.paymentProvider || 'payfast',
            paymentsConfigured: payfastConfig().configured,
            publicKeyConfigured: payfastConfig().configured,
            plan: tier,
            planRank: TIER_RANK[tier],
            planId: catalogId || 'starter',
            planName,
            limits: PLAN_LIMITS[tier],
            usage: usage ? { ...usage, storageGB: storageGB ?? 0 } : null,
            usageAvailable: Boolean(usage),
            storageGB,
            billingInterval: ws.billingInterval || null,
            subscriptionStatus: ws.subscriptionStatus || null,
            cancelAtPeriodEnd: Boolean(ws.cancelAtPeriodEnd),
            canCancelSubscription: Boolean(ws.payfastToken && !ws.cancelAtPeriodEnd),
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

    if (!signature || !/^[a-f0-9]{128}$/i.test(signature) || !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'))) {
        return res.status(400).send('Invalid Paystack signature');
    }

    const event = req.body;

    try {
        if (['subscription.create', 'subscription.not_renew', 'subscription.disable', 'invoice.payment_failed', 'invoice.update'].includes(event?.event)) {
            const code = event.data?.subscription?.subscription_code || event.data?.subscription_code;
            const mapping = code ? await syncSubscription(code) : null;
            if (mapping && event.event === 'invoice.update' && event.data?.paid === true) {
                const reference = event.data?.transaction?.reference;
                if (!reference) throw new Error('Paid invoice has no transaction reference');
                const verified = await paystack.get(`/transaction/verify/${encodeURIComponent(reference)}`);
                const tx = verified.data?.data;
                if (tx?.customer?.customer_code !== event.data?.customer?.customer_code) throw new Error('Invoice customer mismatch');
                const result = await activateFromTransaction({ ...tx, metadata: { workspaceId: mapping.workspaceId, requestedPlan: mapping.planId, billingInterval: mapping.interval } }, 'webhook');
                if (result.ok === false) throw new Error(result.reason);
            }
        }
        if (event?.event === 'charge.success') {
            const result = await activateFromTransaction(event?.data || {}, 'webhook');
            if (result.ok === false) {
                console.error('[Paystack Webhook] Charge not applied:', event?.data?.reference, result.reason);
                if (result.reason !== 'UNKNOWN_PLAN_OR_WORKSPACE') throw new Error(result.reason);
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
