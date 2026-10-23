import test from 'node:test';
import assert from 'node:assert/strict';
import '../../src/config/firebase.js';
import { db } from '../../src/utils/firestore';
import { activateFromTransaction } from '../../src/services/payment-activation';
import { effectivePlan } from '../../src/utils/trial';
import { paystack, recurringPlan, syncSubscription } from '../../src/services/paystack-subscriptions';

test('payment activation commits atomically, deduplicates and ignores older charges', async () => {
    const savedCollection = db.collection; const savedTransaction = db.runTransaction;
    const records = new Map<string, any>([['workspaces/mine', { plan: 'starter', ownerId: 'owner' }]]);
    let failCommit = false;
    const ref = (path: string): any => ({ path, get: async () => ({ exists: records.has(path), data: () => records.get(path) }) });
    (db as any).collection = (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) });
    (db as any).runTransaction = async (fn: any) => {
        const writes: any[] = [];
        const value = await fn({ get: (r: any) => r.get(), set: (r: any, data: any) => writes.push([r.path, data, false]), update: (r: any, data: any) => writes.push([r.path, data, true]) });
        if (failCommit) throw new Error('Simulated commit interruption');
        for (const [path, data, merge] of writes) records.set(path, { ...(merge ? records.get(path) : {}), ...data });
        return value;
    };
    const charge = { id: 1, reference: 'test-one', status: 'success', amount: 29900, currency: 'ZAR', paid_at: '2026-01-31T10:00:00Z', metadata: { workspaceId: 'mine', requestedPlan: 'creator_starter', billingInterval: 'monthly' } };
    try {
        failCommit = true;
        await assert.rejects(activateFromTransaction(charge, 'webhook'), /interruption/);
        assert.equal(records.has('processed_webhooks/1'), false);
        assert.equal(records.get('workspaces/mine').plan, 'starter');
        failCommit = false;
        const first = await activateFromTransaction(charge, 'webhook');
        assert.equal(first.ok, true);
        assert.equal(records.get('workspaces/mine').currentPeriodEnd, '2026-02-28T10:00:00.000Z');
        const duplicate = await activateFromTransaction(charge, 'verify');
        assert.equal(duplicate.ok && duplicate.alreadyProcessed, true);
        await activateFromTransaction({ ...charge, id: 2, paid_at: '2026-02-28T10:00:00Z' }, 'webhook');
        await activateFromTransaction({ ...charge, id: 3, paid_at: '2026-01-01T10:00:00Z' }, 'webhook');
        assert.equal(records.get('workspaces/mine').currentPeriodEnd, '2026-03-28T10:00:00.000Z');
        assert.equal((await activateFromTransaction({ ...charge, id: 4, amount: 1 }, 'webhook')).ok, false);
        assert.equal((await activateFromTransaction({ ...charge, id: 5, currency: 'USD' }, 'webhook')).ok, false);
        assert.equal((await activateFromTransaction({ ...charge, id: 6, paid_at: 'invalid' }, 'webhook')).ok, false);
        assert.equal(records.has('processed_webhooks/4'), false);
    } finally { db.collection = savedCollection; db.runTransaction = savedTransaction; }
});

test('paid entitlement expires without a cron; cancellation retains only the paid period', () => {
    const ws = { plan: 'creator', paymentProvider: 'paystack', currentPeriodEnd: '2026-11-01T00:00:00Z', subscriptionStatus: 'non-renewing' };
    assert.equal(effectivePlan(ws, Date.parse('2026-10-31')), 'creator');
    assert.equal(effectivePlan(ws, Date.parse('2026-11-01')), 'starter');
    assert.equal(effectivePlan({ ...ws, currentPeriodEnd: null }), 'starter');
    assert.equal(effectivePlan({ plan: 'creator' }), 'creator'); // explicit manual pilot grant
    assert.equal(effectivePlan({ ...ws, trialPlan: 'agency', trialEndsAt: '2026-11-03T00:00:00Z' }, Date.parse('2026-11-02')), 'agency');
});

test('recurring plans cache provider IDs and lifecycle reconciliation uses current provider state', async () => {
    const saved = { collection: db.collection, transaction: db.runTransaction, batch: db.batch, get: paystack.get, post: paystack.post };
    const records = new Map<string, any>([['workspaces/mine', { ownerId: 'owner', paystackCustomerCode: 'CUS_test' }]]);
    const ref = (path: string): any => ({ path, get: async () => ({ exists: records.has(path), data: () => records.get(path) }) });
    (db as any).collection = (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) });
    (db as any).batch = () => { const writes: any[] = []; return { set: (r: any, d: any) => writes.push([r.path, d]), commit: async () => { writes.forEach(([p, d]) => records.set(p, d)); } }; };
    (db as any).runTransaction = async (fn: any) => fn({ get: (r: any) => r.get(), update: (r: any, d: any) => records.set(r.path, { ...records.get(r.path), ...d }) });
    let calls = 0;
    (paystack as any).post = async (url: string, payload: any) => { calls++; assert.equal(url, '/plan'); assert.equal(payload.interval, 'annually'); assert.equal(payload.currency, 'ZAR'); return { data: { data: { plan_code: 'PLN_test' } } }; };
    (paystack as any).get = async () => ({ data: { data: { plan: { plan_code: 'PLN_test' }, customer: { customer_code: 'CUS_test' }, status: 'non-renewing' } } });
    try {
        assert.equal(await recurringPlan('mine', 'creator_starter', 'yearly'), 'PLN_test');
        assert.equal(await recurringPlan('mine', 'creator_starter', 'yearly'), 'PLN_test');
        assert.equal(calls, 1);
        await syncSubscription('SUB_test');
        assert.equal(records.get('workspaces/mine').subscriptionStatus, 'non-renewing');
        assert.equal(records.get('workspaces/mine').cancelAtPeriodEnd, true);
        assert.equal(records.get('workspaces/mine').currentPeriodEnd, undefined); // lifecycle event never grants unpaid time
    } finally { db.collection = saved.collection; db.runTransaction = saved.transaction; db.batch = saved.batch; paystack.get = saved.get; paystack.post = saved.post; }
});
