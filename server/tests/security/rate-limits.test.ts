import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { apiRateLimits, claimedUid, RedisFallbackStore, userKey } from '../../src/middleware/rateLimits.js';

const token = (payload: object) => `Bearer h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
const offline = async () => {
    throw new Error('redis offline');
};

test('the user is read from the bearer token; anything else falls back to the IP', () => {
    assert.equal(claimedUid(token({ user_id: 'abc123' })), 'abc123');
    assert.equal(claimedUid(token({ sub: 'xyz_9' })), 'xyz_9');
    assert.equal(claimedUid(token({ sub: '../../etc' })), null);
    assert.equal(claimedUid('Bearer not-a-jwt'), null);
    assert.equal(claimedUid(undefined), null);
    assert.equal(userKey({ headers: { authorization: token({ sub: 'u1' }) }, ip: '1.2.3.4' } as any), 'u:u1:1.2.3.4');
    assert.equal(userKey({ headers: {}, ip: '1.2.3.4' } as any), 'ip:1.2.3.4');
});

test('without Redis the store still counts in memory and resets after the window', async () => {
    const store = new RedisFallbackStore('rl:test:', { redis: offline });
    store.init({ windowMs: 50 } as any);
    assert.equal((await store.increment('k')).totalHits, 1);
    assert.equal((await store.increment('k')).totalHits, 2);
    await store.decrement('k');
    assert.equal((await store.increment('k')).totalHits, 2);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal((await store.increment('k')).totalHits, 1);
});

test('colleagues on one IP get separate allowances; a forged user ID cannot drain a real user', async () => {
    process.env.NODE_ENV = 'production'; // 1,000 per user per 15 minutes
    const app = express();
    app.set('trust proxy', 1);
    app.use(...apiRateLimits({ redis: offline }));
    app.get('/api/x', (_req, res) => res.json({ ok: true }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', () => r()));
    const base = `http://127.0.0.1:${(server.address() as any).port}/api/x`;
    const hit = (uid: string, ip: string) => fetch(base, { headers: { Authorization: token({ sub: uid }), 'X-Forwarded-For': ip } }).then((r) => r.status);
    try {
        for (let i = 0; i < 1000; i++) assert.equal(await hit('alice', '10.0.0.1'), 200);
        assert.equal(await hit('alice', '10.0.0.1'), 429, 'alice is limited');
        assert.equal(await hit('bob', '10.0.0.1'), 200, 'bob in the same office is not');
        assert.equal(await hit('alice', '10.0.0.2'), 200, 'the real alice elsewhere is not drained by the office key');
    } finally {
        server.close();
        process.env.NODE_ENV = 'test';
    }
});
