import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import express from 'express';

// Always the local test Redis, never the application's.
process.env.REDIS_URL = 'redis://127.0.0.1:6379';

/** A small in-memory Firestore with the calls the pilot code uses (transactions are serialised). */
function fakeDb() {
    const store = new Map<string, any>();
    let chain = Promise.resolve<any>(null);
    const ref = (path: string) => ({
        id: path.split('/').pop(),
        path,
        async get() {
            const v = store.get(path);
            return { exists: v !== undefined, id: path.split('/').pop(), data: () => (v === undefined ? undefined : { ...v }) };
        },
        async set(v: any, opts?: any) {
            store.set(path, opts?.merge ? { ...(store.get(path) || {}), ...v } : { ...v });
        },
        async update(v: any) {
            if (!store.has(path)) throw new Error('not found');
            store.set(path, { ...store.get(path), ...v });
        },
    });
    const collection = (name: string) => ({
        doc: (id: string) => ref(`${name}/${id}`),
        async get() {
            const docs = [...store.entries()].filter(([k]) => k.startsWith(`${name}/`) && k.split('/').length === 2).map(([k, v]) => ({ id: k.split('/')[1], data: () => ({ ...v }) }));
            return { docs, empty: !docs.length };
        },
        orderBy() {
            return this;
        },
        limit() {
            return this;
        },
    });
    return {
        store,
        collection,
        doc: ref,
        runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
            const run = chain.then(() =>
                fn({
                    get: (r: any) => r.get(),
                    set: (r: any, v: any, o?: any) => r.set(v, o),
                    update: (r: any, v: any) => r.update(v),
                })
            );
            chain = run.catch(() => null);
            return run;
        },
    };
}

test('invites: one-time, capped at PILOT_MAX_USERS, the 11th is refused, members keep access', async () => {
    process.env.PILOT_MODE = 'true';
    process.env.PILOT_MAX_USERS = '10';
    const { createInvite, redeemInvite, isActiveMember, revokeMember, PilotInviteError } = await import('../../src/services/pilot-invites');
    const db = fakeDb();
    const codes = await Promise.all(Array.from({ length: 11 }, (_, i) => createInvite(db, { createdBy: 'admin', note: `t${i}` }).then((x) => x.code)));
    // Stored by hash only: no code appears in the store.
    for (const c of codes) assert.ok(![...db.store.keys()].some((k) => k.includes(c)) && ![...db.store.values()].some((v) => JSON.stringify(v).includes(c)));

    // 11 people race for 10 seats.
    const results = await Promise.allSettled(codes.map((code, i) => redeemInvite(db, { uid: `u${i}`, email: `u${i}@example.com`, code })));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 10);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof PilotInviteError);
    assert.equal(rejected.reason.code, 'PILOT_FULL');
    assert.equal(db.store.get('pilot/state').members, 10);

    // Existing members still pass, and re-redeeming is a no-op.
    assert.equal(await isActiveMember(db, 'u0'), true);
    assert.deepEqual(await redeemInvite(db, { uid: 'u0', email: 'u0@example.com', code: codes[0] }), { joined: false, alreadyMember: true });

    // A used code can't be reused by someone else.
    await assert.rejects(redeemInvite(db, { uid: 'x', email: 'x@example.com', code: codes[0] }), (e: any) => e.code === 'INVITE_USED' || e.code === 'PILOT_FULL');

    // Revoking frees a seat and blocks the member.
    await revokeMember(db, 'u1');
    assert.equal(await isActiveMember(db, 'u1'), false);
    assert.equal(db.store.get('pilot/state').members, 9);
    await assert.rejects(redeemInvite(db, { uid: 'u1', email: 'u1@example.com', code: codes[1] }), (e: any) => e.code === 'MEMBER_REVOKED');
    const fresh = await createInvite(db, { createdBy: 'admin' });
    assert.deepEqual(await redeemInvite(db, { uid: 'u11', email: 'u11@example.com', code: fresh.code }), { joined: true, alreadyMember: false });
});

test('invites: email-bound, expired, revoked and unknown codes are refused', async () => {
    process.env.PILOT_MODE = 'true';
    const { createInvite, redeemInvite, revokeInvite } = await import('../../src/services/pilot-invites');
    const db = fakeDb();
    const bound = await createInvite(db, { createdBy: 'a', email: 'Only@Example.com' });
    await assert.rejects(redeemInvite(db, { uid: 'a', email: 'other@example.com', code: bound.code }), (e: any) => e.code === 'INVITE_EMAIL_MISMATCH');
    assert.equal((await redeemInvite(db, { uid: 'a', email: 'only@example.com', code: bound.code })).joined, true);

    const old = await createInvite(db, { createdBy: 'a' });
    db.store.set(`pilot_invites/${old.id}`, { ...db.store.get(`pilot_invites/${old.id}`), expiresAt: new Date(Date.now() - 1000).toISOString() });
    await assert.rejects(redeemInvite(db, { uid: 'b', email: 'b@example.com', code: old.code }), (e: any) => e.code === 'INVITE_EXPIRED');

    const withdrawn = await createInvite(db, { createdBy: 'a' });
    await revokeInvite(db, withdrawn.id);
    await assert.rejects(redeemInvite(db, { uid: 'c', email: 'c@example.com', code: withdrawn.code }), (e: any) => e.code === 'INVITE_REVOKED');
    await assert.rejects(redeemInvite(db, { uid: 'd', email: 'd@example.com', code: 'not-a-real-code' }), (e: any) => e.code === 'INVITE_INVALID');
});

test('gate: PILOT_MODE admits members and the legacy email list, refuses everyone else', async () => {
    const { createPilotAccess } = await import('../../src/middleware/pilotAccess.js');
    const members = new Set(['member']);
    let on = true;
    const gate = createPilotAccess(new Set(['listed@example.com']), async (t: string) => JSON.parse(t), { enabled: () => on, isActive: async (uid: string) => members.has(uid) });
    const call = async (user: any) => {
        const res: any = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; } };
        let passed = false;
        await gate({ headers: { authorization: `Bearer ${JSON.stringify(user)}` } }, res, () => { passed = true; });
        return passed ? 'pass' : `${res.statusCode} ${res.body.code}`;
    };
    assert.equal(await call({ uid: 'member', email: 'm@example.com', email_verified: true }), 'pass');
    assert.equal(await call({ uid: 'x', email: 'listed@example.com', email_verified: true }), 'pass');
    assert.equal(await call({ uid: 'stranger', email: 's@example.com', email_verified: true }), '403 PILOT_INVITE_REQUIRED');
    assert.equal(await call({ uid: 'member', email: 'm@example.com', email_verified: false }), '403 PILOT_EMAIL_UNVERIFIED');
    // Cached for a minute; forget() drops it (after a revoke).
    members.delete('member');
    assert.equal(await call({ uid: 'member', email: 'm@example.com', email_verified: true }), 'pass');
    (gate as any).forget('member');
    assert.equal(await call({ uid: 'member', email: 'm@example.com', email_verified: true }), '403 PILOT_INVITE_REQUIRED');
    // Off with no email list: open as before.
    on = false;
    const open = createPilotAccess(null, async () => ({}), { enabled: () => false, isActive: async () => false });
    let passed = false;
    await open({ headers: {} } as any, {} as any, () => { passed = true; });
    assert.equal(passed, true);
});

test('routes: redeem and admin endpoints need sign-in, admin claim and valid input', async () => {
    process.env.PILOT_MODE = 'true';
    process.env.PILOT_MAX_USERS = '1';
    const { createPilotRouter } = await import('../../src/routes/pilot');
    const db = fakeDb();
    const app = express();
    app.use('/api/pilot', createPilotRouter({ db: db as any, verifyToken: async (t) => JSON.parse(Buffer.from(t, 'base64url').toString()) }));
    const server = http.createServer(app).listen(0);
    const port = (server.address() as any).port;
    const tok = (u: any) => `Bearer ${Buffer.from(JSON.stringify(u)).toString('base64url')}`;
    const req = async (method: string, path: string, user?: any, body?: any) => {
        const r = await fetch(`http://127.0.0.1:${port}/api/pilot${path}`, { method, headers: { 'content-type': 'application/json', ...(user ? { authorization: tok(user) } : {}) }, body: body ? JSON.stringify(body) : undefined });
        return { status: r.status, body: await r.json() };
    };
    try {
        const admin = { uid: 'admin', email: 'a@example.com', email_verified: true, pilotAdmin: true };
        const tester = { uid: 't1', email: 't1@example.com', email_verified: true };
        assert.equal((await req('POST', '/admin/invites', tester, {})).status, 403, 'non-admin cannot create invites');
        assert.equal((await req('POST', '/admin/invites')).status, 401);
        const created = await req('POST', '/admin/invites', admin, { note: 'first' });
        assert.equal(created.status, 201);
        assert.equal((await req('GET', '/status', tester)).body.member, false);
        assert.equal((await req('POST', '/redeem', tester, { code: '<script>' })).status, 400);
        assert.equal((await req('POST', '/redeem', tester, { code: created.body.code })).body.joined, true);
        assert.equal((await req('GET', '/status', tester)).body.member, true);
        const second = await req('POST', '/admin/invites', admin, {});
        const full = await req('POST', '/redeem', { uid: 't2', email: 't2@example.com', email_verified: true }, { code: second.body.code });
        assert.equal(full.status, 409);
        assert.equal(full.body.code, 'PILOT_FULL');
        const overview = await req('GET', '/admin/overview', admin);
        assert.equal(overview.body.seats.used, 1);
        assert.equal(overview.body.seats.max, 1);
        assert.equal((await req('GET', '/admin/overview', tester)).status, 403);
        const listed = await req('GET', '/admin/invites', admin);
        assert.ok(!JSON.stringify(listed.body).includes(created.body.code), 'codes are never listed');
    } finally {
        server.close();
        process.env.PILOT_MAX_USERS = '10';
    }
});

test('quotas: pilot caps apply on top of plan caps, admin overrides win, AI has a daily cap', async () => {
    process.env.PILOT_MODE = 'true';
    process.env.PILOT_MAX_AI_TEXT_PER_DAY = '3';
    process.env.PILOT_MAX_EXPORTS_PER_MONTH = '15';
    const { usageLimit, consumeUsage, refundUsage, noteUnlimited } = await import('../../src/middleware/planGate');
    const { notePilotOverrides } = await import('../../src/config/pilot');
    const { usageRedis } = await import('../../src/utils/usageRedis');
    const ws = `pilot-test-${randomUUID()}`;
    try {
        assert.equal(usageLimit(ws, 'agency', 'exports'), 15); // agency 80 -> pilot 15
        assert.equal(usageLimit(ws, 'nano', 'exports'), 8); // lower plan cap wins
        assert.equal(usageLimit(ws, 'starter', 'aiCalls'), 0); // locked stays locked
        assert.equal(usageLimit(ws, 'agency', 'storageGB'), 700 / 1024);
        notePilotOverrides(ws, { exports: 40 });
        assert.equal(usageLimit(ws, 'agency', 'exports'), 40);
        notePilotOverrides(ws, null);
        noteUnlimited(ws, true);
        assert.equal(usageLimit(ws, 'agency', 'exports'), -1);
        noteUnlimited(ws, false);

        // Daily AI cap (needs the local test Redis).
        const results = [];
        for (let i = 0; i < 4; i += 1) results.push(await consumeUsage(ws, 'agency', 'aiCalls'));
        assert.deepEqual(results.map((r) => r.ok), [true, true, true, false]);
        assert.equal(results[3].status, 429);
        assert.equal(results[3].body.error, 'DAILY_LIMIT_EXCEEDED');
        await refundUsage(ws, 'agency', 'aiCalls');
        assert.equal((await consumeUsage(ws, 'agency', 'aiCalls')).ok, true, 'a refund gives the daily unit back');

        process.env.PILOT_MODE = 'false';
        assert.equal(usageLimit(ws, 'agency', 'exports'), 80, 'pilot off: plan limits as before');
    } finally {
        const keys = await usageRedis.keys(`usage:${ws}:*`).catch(() => []);
        if (keys.length) await usageRedis.del(...keys);
        usageRedis.disconnect();
        process.env.PILOT_MODE = 'true';
    }
});

test('uploads: the pilot per-file cap refuses oversized declared sizes before storing anything', async () => {
    process.env.PILOT_MODE = 'true';
    process.env.PILOT_MAX_UPLOAD_MB = '200';
    const { pilotUploadCap } = await import('../../src/middleware/pilotUpload.js');
    const check = (json: boolean, size: number) => {
        const res: any = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; } };
        let passed = false;
        const req: any = { body: json ? { size } : {}, is: (t: string) => (json && t === 'application/json'), get: () => String(size) };
        pilotUploadCap(req, res, () => { passed = true; });
        return passed ? 200 : res.statusCode;
    };
    const MB = 1024 * 1024;
    assert.equal(check(true, 200 * MB), 200);
    assert.equal(check(true, 200 * MB + 1), 413);
    assert.equal(check(false, 200 * MB + 512 * 1024), 200, 'multipart framing allowance');
    assert.equal(check(false, 202 * MB), 413);
    process.env.PILOT_MODE = 'false';
    assert.equal(check(true, 5000 * MB), 200, 'off: no pilot cap');
    process.env.PILOT_MODE = 'true';
});
