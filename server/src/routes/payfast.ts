import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { getAuth } from '../config/firebase.js';
import { db } from '../utils/firestore';
import { withWorkspace } from '../middleware/withWorkspace';
import { requireWorkspaceRole } from '../middleware/workspaceAccess';
import { PLAN_CATALOG } from '../config/plan-catalog';
import { billingAmount } from '../services/paystack-subscriptions';
import { payfastConfig, signature, validateNotification, subscriptionRequest, validPayfastSender } from '../services/payfast';
import { activatePayfast } from '../services/payfast-activation';

const router = Router();
const manage = [withWorkspace, requireWorkspaceRole('owner', 'admin')];

router.post('/create-checkout', ...manage, async (req, res) => {
    const config = payfastConfig();
    if (!config.configured) return res.status(503).json({ error: 'Payfast subscriptions are not configured yet.' });
    const planId = String(req.body?.planName || '');
    const plan = PLAN_CATALOG[planId];
    const interval = req.body?.interval === 'yearly' ? 'yearly' : 'monthly';
    if (!plan || plan.contactOnly) return res.status(400).json({ error: 'Choose a supported subscription plan.' });
    try {
        const user = await getAuth().getUser((req as any).uid);
        if (!user.email) return res.status(400).json({ error: 'An email address is required.' });
        const frontend = new URL(process.env.FRONTEND_URL || '');
        const backend = new URL(process.env.SERVER_URL || '');
        if (frontend.protocol !== 'https:' || backend.protocol !== 'https:') throw new Error('Billing requires configured HTTPS domains');
        const wsRef = db.collection('workspaces').doc((req as any).workspaceId);
        const order = await db.runTransaction(async tx => {
            const ws = (await tx.get(wsRef)).data();
            if (!ws || ws.paystackSubscriptionCode || ws.payfastToken || (ws.paymentProvider && Date.parse(ws.currentPeriodEnd) > Date.now())) throw new Error('Manage the existing subscription before starting another. Contact billing support for plan changes.');
            if (ws.payfastPendingOrder) {
                const previous = (await tx.get(db.collection('payfast_orders').doc(ws.payfastPendingOrder))).data();
                if (previous && previous.mode === config.mode && previous.planId === planId && previous.interval === interval && previous.status === 'pending') return previous;
                throw new Error('A different checkout is pending. Contact billing support to replace it safely.');
            }
            const id = `pf-${randomUUID()}`;
            const created = { id, workspaceId: wsRef.id, planId, tier: plan.tier, interval, amountCents: billingAmount(planId, interval),
                createdAt: new Date().toISOString(), paidCycles: 0, status: 'pending', mode: config.mode };
            tx.set(db.collection('payfast_orders').doc(id), created);
            tx.update(wsRef, { payfastPendingOrder: id, pendingPlan: planId, pendingBillingInterval: interval });
            return created;
        });
        const amount = (order.amountCents / 100).toFixed(2);
        const fields: Record<string, string> = {
            merchant_id: config.merchantId, merchant_key: config.merchantKey,
            return_url: `${frontend.origin}/dashboard/billing?reference=${order.id}`,
            cancel_url: `${frontend.origin}/dashboard/billing?checkout=cancelled`,
            notify_url: `${backend.origin}/api/billing/payfast/notify`,
            email_address: user.email, m_payment_id: order.id, amount, item_name: `KenganSocial ${plan.label}`.slice(0, 100),
            subscription_type: '1', recurring_amount: amount, frequency: interval === 'yearly' ? '6' : '3', cycles: '0',
        };
        fields.signature = signature(fields, config.passphrase, true);
        res.json({ success: true, provider: 'payfast', url: `${config.base}/eng/process`, method: 'POST', fields });
    } catch (error: any) { res.status(409).json({ error: error.message || 'Could not prepare subscription checkout.' }); }
});

router.post('/payfast/notify', async (req, res) => {
    const body = req.body;
    if (!body || Object.values(body).some(v => typeof v !== 'string')) return res.status(400).send('Invalid notification');
    try {
        if (!await validPayfastSender(req.ip || '')) return res.status(403).send('Invalid sender');
        if (!await validateNotification(body)) return res.status(400).send('Invalid notification');
        await activatePayfast(body);
        res.status(200).send('OK');
    } catch (error: any) {
        console.error('[Payfast] Notification could not be applied:', error.message);
        res.status(503).send('Retry notification');
    }
});

router.get('/verify/:reference', ...manage, async (req, res, next) => {
    const id = String(req.params.reference);
    if (!/^pf-[a-f0-9-]{36}$/.test(id)) return next(); // Legacy Paystack return links still work.
    try {
        const order = (await db.collection('payfast_orders').doc(id).get()).data();
        if (!order || order.workspaceId !== (req as any).workspaceId) return res.status(404).json({ error: 'Payment not found.' });
        res.json(order.status === 'paid' ? { success: true, planName: PLAN_CATALOG[order.planId]?.label, currentPeriodEnd: order.currentPeriodEnd }
            : { success: false, status: 'pending', message: 'Waiting for confirmed payment from Payfast. Your plan updates automatically when it arrives.' });
    } catch { res.status(503).json({ error: 'Could not check payment status.' }); }
});

router.post('/cancel-subscription', ...manage, async (req, res) => {
    try {
        const ref = db.collection('workspaces').doc((req as any).workspaceId);
        const ws = (await ref.get()).data();
        if (!ws?.payfastToken) return res.status(409).json({ error: 'No Payfast subscription is available to cancel.' });
        if (!ws.cancelAtPeriodEnd) await subscriptionRequest(ws.payfastToken, 'cancel');
        await ref.update({ cancelAtPeriodEnd: true, subscriptionStatus: 'cancelled' });
        res.json({ success: true, message: 'Renewal cancelled. Access continues until the end of the paid period.' });
    } catch { res.status(502).json({ error: 'Cancellation was not confirmed. Please retry or contact billing support.' }); }
});

export default router;
