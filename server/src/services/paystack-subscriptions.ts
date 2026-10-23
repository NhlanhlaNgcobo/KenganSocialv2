import { createHash } from 'node:crypto';
import axios from 'axios';
import { db } from '../utils/firestore';
import { PLAN_CATALOG, ANNUAL_DISCOUNT } from '../config/plan-catalog';

export type BillingInterval = 'monthly' | 'yearly';
export const paystack = axios.create({ baseURL: 'https://api.paystack.co', timeout: 15000 });
paystack.interceptors.request.use(config => {
    if (!process.env.PAYSTACK_SECRET_KEY) throw new Error('Payments are not configured');
    config.headers.Authorization = `Bearer ${process.env.PAYSTACK_SECRET_KEY}`;
    return config;
});

export function billingAmount(planId: string, interval: BillingInterval) {
    const entry = PLAN_CATALOG[planId];
    if (!entry || entry.contactOnly) throw new Error('Unsupported billing plan');
    return Math.round(entry.amountZar * (interval === 'yearly' ? 12 * ANNUAL_DISCOUNT : 1) * 100);
}

/** One provider plan per workspace/tier/interval makes renewal events unambiguous. */
export async function recurringPlan(workspaceId: string, planId: string, interval: BillingInterval) {
    const amount = billingAmount(planId, interval);
    const mode = process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test';
    const key = createHash('sha256').update(`${mode}:${workspaceId}:${planId}:${interval}:${amount}`).digest('hex');
    const ref = db.collection('billing_plan_keys').doc(key);
    const cached = (await ref.get()).data();
    if (cached?.code) return cached.code as string;
    const response = await paystack.post('/plan', {
        name: `KenganSocial ${PLAN_CATALOG[planId].label} ${key.slice(0, 12)}`,
        interval: interval === 'yearly' ? 'annually' : 'monthly', amount, currency: 'ZAR',
    });
    const code = response.data?.data?.plan_code;
    if (typeof code !== 'string' || !/^PLN_[A-Za-z0-9]+$/.test(code)) throw new Error('Provider did not return a subscription plan');
    const batch = db.batch();
    batch.set(db.collection('paystack_plans').doc(code), { workspaceId, planId, interval, amount, mode });
    batch.set(ref, { code });
    await batch.commit();
    return code;
}

/** Fetch current provider state rather than trusting delayed lifecycle event order. */
export async function syncSubscription(code: string) {
    if (!/^SUB_[A-Za-z0-9]+$/.test(code)) throw new Error('Invalid subscription code');
    const response = await paystack.get(`/subscription/${encodeURIComponent(code)}`);
    const sub = response.data?.data;
    const planCode = sub?.plan?.plan_code;
    if (typeof planCode !== 'string') throw new Error('Subscription plan missing');
    const mapping = (await db.collection('paystack_plans').doc(planCode).get()).data() as { workspaceId: string; planId: string; interval: BillingInterval } | undefined;
    if (!mapping) return null; // A subscription belonging to a different application.
    const workspace = db.collection('workspaces').doc(mapping.workspaceId);
    await db.runTransaction(async tx => {
        const snap = await tx.get(workspace);
        if (!snap.exists) throw new Error('Billing workspace missing');
        const ws = snap.data()!;
        if (ws.paystackCustomerCode && ws.paystackCustomerCode !== sub.customer?.customer_code) throw new Error('Subscription customer mismatch');
        if (ws.paystackSubscriptionCode && ws.paystackSubscriptionCode !== code) throw new Error('Workspace already has a subscription');
        tx.update(workspace, {
            paystackSubscriptionCode: code, paystackCustomerCode: sub.customer.customer_code,
            subscriptionStatus: sub.status, paymentProvider: 'paystack',
            cancelAtPeriodEnd: ['non-renewing', 'cancelled', 'complete'].includes(sub.status),
            updatedAt: new Date().toISOString(),
        });
    });
    return { ...mapping, subscriptionCode: code };
}

export async function subscriptionManagementUrl(workspaceId: string) {
    const ws = (await db.collection('workspaces').doc(workspaceId).get()).data();
    if (!ws?.paystackSubscriptionCode) return null;
    const response = await paystack.get(`/subscription/${encodeURIComponent(ws.paystackSubscriptionCode)}/manage/link`);
    const link = response.data?.data?.link;
    const url = new URL(link);
    if (url.protocol !== 'https:' || url.hostname !== 'paystack.com') throw new Error('Invalid subscription management URL');
    return url.href;
}
