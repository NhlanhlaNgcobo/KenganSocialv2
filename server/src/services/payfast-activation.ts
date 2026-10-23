import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/firestore';
import { cents, payfastConfig } from './payfast';
import { addPeriod } from './payment-activation';

/** Caller must authenticate and confirm the ITN with Payfast before invoking this. */
export async function activatePayfast(data: Record<string, string>) {
    if (data.payment_status !== 'COMPLETE') return;
    if (!/^[A-Za-z0-9-]{1,100}$/.test(data.m_payment_id || '') || !/^\d{1,30}$/.test(data.pf_payment_id || '')) throw new Error('Invalid payment identifiers');
    if (!/^[a-f0-9-]{36}$/i.test(data.token || '')) throw new Error('Subscription token missing');
    const orderRef = db.collection('payfast_orders').doc(data.m_payment_id);
    const receipt = db.collection('processed_webhooks').doc(`payfast_${payfastConfig().mode}_${data.pf_payment_id}`);
    await db.runTransaction(async tx => {
        const [orderSnap, receiptSnap] = await Promise.all([tx.get(orderRef), tx.get(receipt)]);
        if (receiptSnap.exists) return;
        const order = orderSnap.data();
        if (!order || order.mode !== payfastConfig().mode || cents(data.amount_gross) !== order.amountCents) throw new Error('Payment does not match checkout');
        const workspaceRef = db.collection('workspaces').doc(order.workspaceId);
        const ws = (await tx.get(workspaceRef)).data();
        if (!ws || (ws.payfastToken && ws.payfastToken !== data.token) || ws.paystackSubscriptionCode) throw new Error('Subscription workspace mismatch');
        // Anchor paid periods to checkout and receipt count, so delayed or reordered ITNs
        // cannot grant a fresh month simply because they arrived late.
        const paidCycles = (order.paidCycles || 0) + 1;
        let end = new Date(order.createdAt);
        for (let i = 0; i < paidCycles; i++) end = new Date(addPeriod(end, order.interval));
        // Payfast supplies the date of future recurring billing in subscription ITNs.
        // Use that authenticated schedule when present (including recovery after missed cycles).
        if (/^\d{4}-\d{2}-\d{2}$/.test(data.billing_date || '')) {
            const scheduled = new Date(`${data.billing_date}T00:00:00+02:00`);
            if (Number.isFinite(scheduled.getTime())) end = scheduled;
        }
        const currentPeriodEnd = new Date(Math.max(end.getTime(), Date.parse(ws.currentPeriodEnd) || 0)).toISOString();
        tx.set(receipt, { provider: 'payfast', workspaceId: order.workspaceId, orderId: orderRef.id, processedAt: FieldValue.serverTimestamp() });
        tx.update(orderRef, { paidCycles, status: 'paid', lastPaymentId: data.pf_payment_id, currentPeriodEnd });
        tx.update(workspaceRef, { plan: order.tier, billingPlanId: order.planId, billingInterval: order.interval,
            paymentProvider: 'payfast', payfastToken: data.token, payfastOrderId: orderRef.id,
            paymentStatus: 'active', subscriptionStatus: ws.cancelAtPeriodEnd ? 'cancelled' : 'active', currentPeriodEnd,
            pendingPlan: FieldValue.delete(), pendingBillingInterval: FieldValue.delete(), checkoutUrl: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp() });
    });
}
