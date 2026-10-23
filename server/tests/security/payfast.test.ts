import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encode, signature, validSignature, cents } from '../../src/services/payfast';
import { activatePayfast } from '../../src/services/payfast-activation';
import { db } from '../../src/utils/firestore';

test('Payfast encoding, signature tampering and exact cents', () => {
    assert.equal(encode('Hello world!~'), 'Hello+world%21%7E');
    const fields = { merchant_id: 'test', amount_gross: '299.00', payment_status: 'COMPLETE' };
    const expected = createHash('md5').update('merchant_id=test&amount_gross=299.00&payment_status=COMPLETE&passphrase=test_phrase').digest('hex');
    assert.equal(signature(fields, 'test_phrase'), expected);
    assert.equal(validSignature({ ...fields, signature: expected }, 'test_phrase'), true);
    assert.equal(validSignature({ ...fields, amount_gross: '1.00', signature: expected }, 'test_phrase'), false);
    assert.equal(cents('299.00'), 29900);
    assert.throws(() => cents('299.001'));
});

test('Payfast paid cycles commit with receipts, reject mismatches and ignore duplicate delivery', async () => {
    const saved = { collection: db.collection, transaction: db.runTransaction, mode: process.env.PAYFAST_MODE };
    process.env.PAYFAST_MODE = 'sandbox';
    const records = new Map<string, any>([
        ['workspaces/mine', { plan: 'starter' }],
        ['payfast_orders/order-1', { workspaceId: 'mine', mode: 'sandbox', interval: 'monthly', tier: 'nano', planId: 'creator_starter', amountCents: 29900, createdAt: '2026-01-15T00:00:00Z' }],
    ]);
    let failCommit = true;
    const ref = (path: string): any => ({ path, id: path.split('/').at(-1), get: async () => ({ data: () => records.get(path), exists: records.has(path) }) });
    (db as any).collection = (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) });
    (db as any).runTransaction = async (fn: any) => {
        const writes: any[] = [];
        await fn({ get: (r: any) => r.get(), set: (r: any, d: any) => writes.push([r.path, d]), update: (r: any, d: any) => writes.push([r.path, { ...records.get(r.path), ...d }]) });
        if (failCommit) throw new Error('commit interrupted');
        writes.forEach(([p, d]) => records.set(p, d));
    };
    const event = { payment_status: 'COMPLETE', m_payment_id: 'order-1', pf_payment_id: '100', amount_gross: '299.00', token: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' };
    try {
        await assert.rejects(activatePayfast(event), /interrupted/);
        assert.equal(records.has('processed_webhooks/payfast_sandbox_100'), false);
        failCommit = false;
        await activatePayfast(event);
        await activatePayfast(event);
        assert.equal(records.get('payfast_orders/order-1').paidCycles, 1);
        assert.equal(records.get('workspaces/mine').currentPeriodEnd, '2026-02-15T00:00:00.000Z');
        await activatePayfast({ ...event, pf_payment_id: '101' });
        assert.equal(records.get('workspaces/mine').currentPeriodEnd, '2026-03-15T00:00:00.000Z');
        await assert.rejects(activatePayfast({ ...event, pf_payment_id: '102', amount_gross: '1.00' }), /match/);
    } finally {
        db.collection = saved.collection; db.runTransaction = saved.transaction;
        if (saved.mode === undefined) delete process.env.PAYFAST_MODE; else process.env.PAYFAST_MODE = saved.mode;
    }
});
