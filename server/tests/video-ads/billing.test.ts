import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { billingContext, reserve, refund } from '../../src/services/video-ads/billing';
import { redis } from '../../src/utils/redis';

test('Redis reservations and refunds are idempotent and concurrent requests respect the cap', async () => {
    const workspace = `video-ad-test-${randomUUID()}`;
    const first = { ...billingContext(workspace,randomUUID(),'nano'), limit:1 };
    const second = { ...billingContext(workspace,randomUUID(),'nano'), limit:1 };
    try {
        await reserve(first);
        await reserve(first);
        assert.equal(await redis.get(first.counter),'1');
        await assert.rejects(reserve(second),/no remaining/);
        await refund(first);
        await refund(first);
        assert.equal(await redis.get(first.counter),'0');
        const results=await Promise.allSettled([reserve(first),reserve(second)]);
        assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
        assert.equal(await redis.get(first.counter),'1');
    } finally {
        await redis.del(first.counter,first.ledger,second.ledger);
        redis.disconnect();
    }
});
