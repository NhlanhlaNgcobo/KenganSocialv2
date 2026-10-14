import { createHmac } from 'node:crypto';
import express, { Request, Response } from 'express';
import axios from 'axios';
import admin from 'firebase-admin';
import { db } from '../utils/firestore';
import { withWorkspace } from '../middleware/withWorkspace';
import { PLAN_LIMITS } from '../utils/planLimits';
import { redis } from '../utils/redis';
import { getMonth } from '../utils/dateUtils';
import { calculateWorkspaceStorage } from '../utils/storage';

const router = express.Router();

const PAYSTACK_API_BASE = 'https://api.paystack.co';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const PAYSTACK_CALLBACK_URL = process.env.PAYSTACK_CALLBACK_URL || `${FRONTEND_URL}/dashboard/billing`;
const BILLING_SUPPORT_URL = process.env.PAYSTACK_BILLING_SUPPORT_URL || 'mailto:billing@kengansocial.com';
const ANNUAL_DISCOUNT = 0.85;

const PLAN_CATALOG: Record<string, { label: string; amountZar: number; credits: number; intervalLabel: string }> = {
    creator_starter: { label: 'Creator Starter', amountZar: 249, credits: 1000, intervalLabel: 'monthly' },
    creator_pro: { label: 'Creator Pro', amountZar: 499, credits: 5000, intervalLabel: 'monthly' },
    agency: { label: 'Agency', amountZar: 1999, credits: 20000, intervalLabel: 'monthly' },
    enterprise: { label: 'Enterprise', amountZar: 4999, credits: 50000, intervalLabel: 'monthly' },
};

const WORKSPACE_PLAN_MAP: Record<string, string> = {
    starter: 'creator_starter',
    creator: 'creator_pro',
    agency: 'agency',
    enterprise: 'enterprise',
};

const PAYSTACK_PLAN_MAP: Record<string, string> = {
    creator_starter: 'starter',
    creator_pro: 'creator',
    agency: 'agency',
    enterprise: 'enterprise',
};

function normalizePlanName(planName?: string) {
    if (!planName) return 'creator_starter';
    if (PLAN_CATALOG[planName]) return planName;
    if (planName === 'starter' || planName === 'nano') return 'creator_starter';
    if (planName === 'creator') return 'creator_pro';
    return PLAN_CATALOG[planName] ? planName : 'creator_starter';
}

function computeAmount(planName: string, interval: 'monthly' | 'yearly') {
    const baseAmount = PLAN_CATALOG[planName]?.amountZar ?? PLAN_CATALOG.creator_starter.amountZar;
    if (interval === 'yearly') {
        return Math.round(baseAmount * 12 * ANNUAL_DISCOUNT * 100);
    }
    return Math.round(baseAmount * 100);
}

async function fetchWorkspaceContact(uid: string) {
    const userRecord = await admin.auth().getUser(uid);
    return {
        email: userRecord.email,
        name: userRecord.displayName || userRecord.email?.split('@')[0] || 'KenganSocial User',
    };
}

router.post('/create-checkout', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const uid = (req as any).uid;
    const requestedPlan = normalizePlanName(req.body?.planName);
    const interval = req.body?.interval === 'yearly' ? 'yearly' : 'monthly';

    if (!workspaceId) {
        return res.status(400).json({ error: 'Workspace missing for billing session.' });
    }

    if (!PAYSTACK_SECRET_KEY) {
        return res.status(501).json({
            error: 'Paystack is not configured yet. Add PAYSTACK_SECRET_KEY to enable live checkout.',
            provider: 'paystack',
        });
    }

    try {
        const contact = await fetchWorkspaceContact(uid);
        if (!contact.email) {
            return res.status(400).json({ error: 'User email is required for Paystack checkout.' });
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
            }
        );

        await db.collection('workspaces').doc(workspaceId).set({
            pendingPaymentProvider: 'paystack',
            pendingPlan: requestedPlan,
            pendingBillingInterval: interval,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        res.json({
            success: true,
            provider: 'paystack',
            url: response.data?.data?.authorization_url,
            reference: response.data?.data?.reference,
        });
    } catch (err: any) {
        const errorMessage = err?.response?.data?.message || err.message || 'Failed to initialize Paystack checkout.';
        res.status(500).json({ error: errorMessage, provider: 'paystack' });
    }
});

router.post('/portal', withWorkspace, async (_req: Request, res: Response) => {
    res.json({
        success: true,
        provider: 'paystack',
        url: BILLING_SUPPORT_URL,
        mode: 'support',
    });
});

router.get('/status', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;

    try {
        const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
        const ws = wsDoc.data() || {};
        const effectivePlan = WORKSPACE_PLAN_MAP[ws.plan] || normalizePlanName(ws.plan);

        const features = ['posts', 'exports', 'aiCalls', 'transcribeHrs', 'clipAnalysis', 'dmsDay', 'renders'];
        const usage: Record<string, number> = {};

        await Promise.all(features.map(async (feature) => {
            const key = `usage:${workspaceId}:${feature}:${getMonth()}`;
            try {
                usage[feature] = parseInt(await redis.get(key) || '0', 10);
            } catch (_error) {
                usage[feature] = 0;
            }
        }));

        usage.storageGB = await calculateWorkspaceStorage(workspaceId);

        res.json({
            success: true,
            provider: 'paystack',
            publicKeyConfigured: Boolean(PAYSTACK_PUBLIC_KEY),
            plan: effectivePlan,
            internalPlan: ws.plan || 'starter',
            credits: ws.credits ?? PLAN_CATALOG[effectivePlan]?.credits ?? 50,
            planDetails: PLAN_CATALOG[effectivePlan] || PLAN_CATALOG.creator_starter,
            paystackCustomerCode: ws.paystackCustomerCode || null,
            paystackReference: ws.paystackReference || null,
            subscriptionId: ws.paystackSubscriptionCode || ws.subscriptionId || null,
            currentPeriodEnd: ws.currentPeriodEnd || null,
            paymentStatus: ws.paymentStatus || 'inactive',
            usage,
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
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
    const eventId = event?.data?.id ? String(event.data.id) : `evt_${Date.now()}`;
    const idempotencyRef = db.collection('processed_webhooks').doc(eventId);

    const existingDoc = await idempotencyRef.get();
    if (existingDoc.exists) {
        return res.status(200).send('Webhook already processed');
    }

    try {
        await idempotencyRef.set({
            provider: 'paystack',
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        if (event?.event === 'charge.success') {
            const metadata = event?.data?.metadata || {};
            const workspaceId = metadata.workspaceId;
            const requestedPlan = normalizePlanName(metadata.requestedPlan);
            const internalPlan = PAYSTACK_PLAN_MAP[requestedPlan] || 'starter';

            if (workspaceId) {
                await db.collection('workspaces').doc(workspaceId).set({
                    plan: internalPlan,
                    paymentProvider: 'paystack',
                    paystackReference: event?.data?.reference || null,
                    paystackCustomerCode: event?.data?.customer?.customer_code || null,
                    paystackCustomerEmail: event?.data?.customer?.email || null,
                    paystackSubscriptionCode: event?.data?.subscription?.subscription_code || null,
                    paymentStatus: 'active',
                    currentPeriodEnd: null,
                    credits: PLAN_CATALOG[requestedPlan]?.credits ?? 1000,
                    planActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
        }

        return res.json({ received: true });
    } catch (err) {
        await idempotencyRef.delete();
        console.error('[Paystack Webhook Error]', err);
        return res.status(500).send('Webhook processing failed');
    }
}

router.post('/webhook', handlePaystackWebhook);

export default router;
