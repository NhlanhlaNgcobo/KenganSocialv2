import test from 'node:test';
import assert from 'node:assert/strict';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { RESERVE_USAGE, REFUND_USAGE } from '../../src/services/usage-reservation';

test('real Redis atomically permits exactly the remaining allowance and preserves expiry', async () => {
    // Always a local test instance, never the application Redis URL.
    const client = new IORedis('redis://127.0.0.1:6379', { maxRetriesPerRequest: 1, connectTimeout: 2000 });
    client.on('error', () => {});
    const key = `security-test:${randomUUID()}`;
    try {
        const expiry = Math.floor(Date.now() / 1000) + 60;
        const results = await Promise.all(Array.from({ length: 30 }, () => client.eval(RESERVE_USAGE, 1, key, 1, 4, expiry) as Promise<number[]>));
        assert.equal(results.filter(r => r[0] === 1).length, 4);
        assert.equal(await client.get(key), '4');
        assert.ok(await client.ttl(key) > 0);
        await client.eval(REFUND_USAGE, 1, key, 99);
        assert.equal(await client.get(key), '0');
        assert.ok(await client.ttl(key) > 0);
    } finally { await client.del(key).catch(() => {}); client.disconnect(); }
});
