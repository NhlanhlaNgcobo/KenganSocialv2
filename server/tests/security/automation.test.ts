import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import '../../src/config/firebase.js';
import { db } from '../../src/utils/firestore';
import { keywordMatches, matchesAnyKeyword, decideClaim, claimRun, markStep, completeRun, releaseRun, RULE_COOLDOWN_MS, STALE_CLAIM_MS } from '../../src/services/meta/rules';
import { checkSend, overCeiling, hourWindow, activePause, AUTOMATED_HOURLY_CEILING, RECIPIENT_DEDUPE_MS, type GuardRedis } from '../../src/services/meta/send-guard';
import { classifyGraphError } from '../../src/services/meta/graph-errors';
import { isOwnEcho } from '../../src/services/meta/messaging';
import { ruleAllowance } from '../../src/services/meta/plan-access';
import { verifyMetaSignature, splitMetaPayload } from '../../src/services/webhooks/meta';
import { sanitizeImport, sanitizeNewLead, MAX_IMPORT_ROWS } from '../../src/services/leads/sanitize';
import { textHash } from '../../src/services/meta/send-guard';

// ─── Keyword matching ────────────────────────────────────────────────────────────────────────────

test('keywords match whole words and phrases, case-insensitive and Unicode-aware', () => {
    assert.equal(keywordMatches('Hi there!', 'hi'), true);
    assert.equal(keywordMatches('this is great', 'hi'), false); // not inside "this"
    assert.equal(keywordMatches('whitepaper', 'hi'), false);
    assert.equal(keywordMatches('PRICE?', 'price'), true);
    assert.equal(keywordMatches('prices please', 'price'), false);
    assert.equal(keywordMatches('Can I see the price   list', 'price list'), true); // phrase, any spacing
    assert.equal(keywordMatches('the price is on the list', 'price list'), false);
    assert.equal(keywordMatches('Un CAFÉ, por favor', 'café'), true);
    assert.equal(keywordMatches('cafés', 'café'), false);
    assert.equal(keywordMatches('Сколько стоит ЦЕНА?', 'цена'), true); // Cyrillic, case-insensitive
    assert.equal(keywordMatches('ценами', 'цена'), false);
    assert.equal(keywordMatches('Is the #sale on?', '#sale'), true); // keyword starting with a symbol
    assert.equal(keywordMatches('50% off?', '50%'), true);
    assert.equal(keywordMatches('anything', ''), false);
    assert.equal(keywordMatches('a.b', '.'), true); // regex characters are literal
    assert.equal(keywordMatches('ab', '.'), false);
    assert.equal(matchesAnyKeyword('send me the LINK', ['price', 'link']), true);
    assert.equal(matchesAnyKeyword('nothing here', ['price', 42 as any, null as any]), false);
});

// ─── Send limits ─────────────────────────────────────────────────────────────────────────────────

/** In-memory Redis with the commands send-guard uses (NX/PX semantics, expiry by a fake clock). */
function fakeRedis(clock: { now: number }): GuardRedis & { store: Map<string, { v: string; exp: number }> } {
    const store = new Map<string, { v: string; exp: number }>();
    const live = (k: string) => {
        const e = store.get(k);
        if (e && e.exp && e.exp <= clock.now) store.delete(k);
        return store.get(k);
    };
    return {
        store,
        async get(k) { return live(k)?.v ?? null; },
        async set(k, v, ...args) {
            const px = args.includes('PX') ? Number(args[args.indexOf('PX') + 1]) : 0;
            if (args.includes('NX') && live(k)) return null;
            store.set(k, { v, exp: px ? clock.now + px : 0 });
            return 'OK';
        },
        async incr(k) { const n = Number(live(k)?.v || 0) + 1; store.set(k, { v: String(n), exp: live(k)?.exp || 0 }); return n; },
        async pexpire(k, ms) { const e = live(k); if (e) e.exp = clock.now + ms; return 1; },
        async del(k) { store.delete(k); return 1; },
    };
}

test('identical templates to different people never lock the workspace; the same text to one person is deduped', async () => {
    const clock = { now: Date.UTC(2026, 9, 23, 10, 0, 0) };
    const r = fakeRedis(clock);
    const base = { workspaceId: 'ws', channel: 'instagram', text: 'Here is the price list!', automated: true };
    // 150 people comment "price" on a popular post: every one gets the same template.
    for (let i = 0; i < 150; i++) {
        const res = await checkSend({ ...base, target: `dm:instagram:p${i}`, recipient: `p${i}`, now: clock.now }, r);
        assert.equal(res.ok, true, `person ${i}`);
    }
    // Manual reply in the same workspace is unaffected.
    assert.equal((await checkSend({ ...base, automated: false, text: 'Thanks!', target: 'dm:instagram:p0', recipient: 'p0', now: (clock.now += 3000) }, r)).ok, true);

    // The same text to the same person again: refused within the dedupe window, allowed after it.
    clock.now += 3000;
    assert.deepEqual(await checkSend({ ...base, target: 'dm:instagram:p1', recipient: 'p1', now: clock.now }, r), { ok: false, refusal: 'duplicate' });
    clock.now += RECIPIENT_DEDUPE_MS;
    assert.equal((await checkSend({ ...base, target: 'dm:instagram:p1', recipient: 'p1', now: clock.now }, r)).ok, true);

    // Burst: two sends to the same person within 2 seconds.
    clock.now += 60_000;
    assert.equal((await checkSend({ ...base, text: 'one', target: 'dm:instagram:p2', recipient: 'p2', now: clock.now }, r)).ok, true);
    assert.equal((await checkSend({ ...base, text: 'two', target: 'dm:instagram:p2', recipient: 'p2', now: clock.now + 500 }, r)).refusal, 'burst');
});

test('the hourly ceiling pauses automated sends on one channel only, never manual replies', async () => {
    const clock = { now: hourWindow(Date.UTC(2026, 9, 23, 11, 0, 0)) + 60_000 };
    const r = fakeRedis(clock);
    const auto = (i: number, channel = 'instagram') =>
        checkSend({ workspaceId: 'ws', channel, text: 'T', target: `dm:${channel}:x${i}`, recipient: `x${i}`, automated: true, now: clock.now }, r);
    for (let i = 0; i < AUTOMATED_HOURLY_CEILING; i++) assert.equal((await auto(i)).ok, true);
    const over = await auto(AUTOMATED_HOURLY_CEILING);
    assert.equal(over.ok, false);
    assert.equal(over.refusal, 'ceiling');
    assert.equal(over.pauseStarted, true);
    assert.equal(over.pausedUntil, hourWindow(clock.now) + 3600_000);
    const again = await auto(AUTOMATED_HOURLY_CEILING + 1);
    assert.equal(again.refusal, 'ceiling');
    assert.equal(again.pauseStarted, undefined); // recorded once
    // The refused message's dedupe mark was released: the owner can send that text by hand.
    const manual = await checkSend({ workspaceId: 'ws', channel: 'instagram', text: 'T', target: 'dm:instagram:manual', recipient: `x${AUTOMATED_HOURLY_CEILING}`, automated: false, now: clock.now }, r);
    assert.equal(manual.ok, true);
    // Messenger is not paused by Instagram's ceiling.
    assert.equal((await auto(1, 'facebook')).ok, true);
    // Next hour: automated sends resume.
    clock.now = hourWindow(clock.now) + 3600_000 + 1000;
    assert.equal((await auto(9999)).ok, true);
    assert.equal(overCeiling(AUTOMATED_HOURLY_CEILING), false);
    assert.equal(overCeiling(AUTOMATED_HOURLY_CEILING + 1), true);
    assert.deepEqual(Object.keys(activePause({ instagram: { until: clock.now + 1000 }, facebook: { until: clock.now - 1 } }, clock.now)), ['instagram']);
});

test('send limits fail open when Redis is down', async () => {
    const broken: GuardRedis = {
        get: async () => { throw new Error('ECONNREFUSED'); },
        set: async () => { throw new Error('ECONNREFUSED'); },
        incr: async () => { throw new Error('ECONNREFUSED'); },
        pexpire: async () => { throw new Error('ECONNREFUSED'); },
        del: async () => { throw new Error('ECONNREFUSED'); },
    };
    const hanging: GuardRedis = { ...broken, get: () => new Promise(() => {}), set: () => new Promise(() => {}) };
    const input = { workspaceId: 'ws', channel: 'facebook', text: 'x', target: 'dm:facebook:1', recipient: '1', automated: true };
    assert.deepEqual(await checkSend(input, broken), { ok: true });
    assert.deepEqual(await checkSend(input, hanging), { ok: true }); // bounded by the timeout, never stalls a send
});

// ─── Rule idempotency and cooldown ───────────────────────────────────────────────────────────────

test('claim decisions: retries resume, finished runs are not repeated, the cooldown blocks other events', () => {
    const now = 1_000_000_000_000;
    assert.equal(decideClaim(null, 'e1', now), 'run');
    assert.equal(decideClaim({ eventKey: 'e1', claimedAt: now - 5000, doneAt: null }, 'e1', now), 'run'); // retry of an unfinished run
    assert.equal(decideClaim({ eventKey: 'e1', claimedAt: now - 5000, doneAt: now - 4000 }, 'e1', now), 'done');
    assert.equal(decideClaim({ eventKey: 'e1', claimedAt: now - 5000, doneAt: now - 4000 }, 'e2', now), 'cooldown');
    assert.equal(decideClaim({ eventKey: 'e1', claimedAt: now - RULE_COOLDOWN_MS - 10, doneAt: now - RULE_COOLDOWN_MS - 1 }, 'e2', now), 'run');
    assert.equal(decideClaim({ eventKey: 'e1', claimedAt: now - 1000, doneAt: null }, 'e2', now), 'cooldown'); // in flight
    assert.equal(decideClaim({ eventKey: 'e1', claimedAt: now - STALE_CLAIM_MS - 1, doneAt: null }, 'e2', now), 'run'); // abandoned
});

test('rule runs are claimed in a transaction: a retried event never repeats a finished step', async () => {
    const saved = { collection: db.collection, runTransaction: db.runTransaction };
    const docs = new Map<string, any>();
    const ref = (path: string): any => ({
        path,
        collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
        get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
        update: async (patch: Record<string, unknown>) => {
            const current = docs.get(path) || {};
            const next = { ...current, steps: { ...(current.steps || {}) } };
            for (const [k, v] of Object.entries(patch)) {
                const parts = k.split('.');
                let o = next;
                while (parts.length > 1) o = o[parts.shift()!] ??= {};
                o[parts[0]] = v;
            }
            docs.set(path, next);
        },
        delete: async () => { docs.delete(path); },
    });
    (db as any).collection = (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) });
    let queue = Promise.resolve();
    (db as any).runTransaction = (fn: any) => {
        // Serialised like Firestore's optimistic transactions resolve conflicts.
        const run = queue.then(async () => {
            const writes: [string, any][] = [];
            const value = await fn({ get: (r: any) => r.get(), set: (r: any, data: any) => writes.push([r.path, data]) });
            for (const [path, data] of writes) docs.set(path, { ...data, steps: { ...(data.steps || {}) } });
            return value;
        });
        queue = run.then(() => undefined, () => undefined);
        return run;
    };
    try {
        const t0 = Date.now();
        let sends = 0;
        const execute = async (eventKey: string, crashAfterSend = false) => {
            const claim = await claimRun('ws', 'rule1', 'instagram', 'person', eventKey, t0);
            if (claim.decision !== 'run') return claim.decision;
            if (!claim.steps.dm) {
                sends++;
                await markStep(claim, 'dm');
            }
            if (crashAfterSend) throw new Error('crash before the run was marked done');
            await completeRun(claim);
            return 'sent';
        };
        await assert.rejects(execute('evt-1', true), /crash/);
        assert.equal(sends, 1);
        assert.equal(await execute('evt-1'), 'sent'); // the dispatcher's retry completes without resending
        assert.equal(sends, 1);
        assert.equal(await execute('evt-1'), 'done'); // a further retry is a no-op
        assert.equal(await execute('evt-2'), 'cooldown'); // the same person writing again within 24h
        assert.equal(sends, 1);

        // Two deliveries racing for the same new person: only one claims the run.
        const both = await Promise.all([
            claimRun('ws', 'rule1', 'instagram', 'other', 'a', t0),
            claimRun('ws', 'rule1', 'instagram', 'other', 'b', t0),
        ]);
        assert.deepEqual(both.map((c) => c.decision).sort(), ['cooldown', 'run']);

        // A permanent failure frees the person for a later message.
        const failed = both.find((c) => c.decision === 'run')!;
        await releaseRun(failed);
        assert.equal((await claimRun('ws', 'rule1', 'instagram', 'other', 'c', t0)).decision, 'run');
        // Claim docs expire (Firestore TTL) and ids can't escape the collection.
        const stored = [...docs.entries()].find(([p]) => p.endsWith('rule1_instagram_person'))![1];
        assert.ok(stored.expireAt.toMillis() > t0);
        const weird = await claimRun('ws', 'rule/../x', 'instagram', 'a/b', 'e', t0);
        assert.equal(weird.ref.path.split('/').length, 4);
    } finally {
        db.collection = saved.collection;
        db.runTransaction = saved.runTransaction;
    }
});

// ─── Human handover and Graph errors ─────────────────────────────────────────────────────────────

test('echoes from our app are ours; anything else is a reply by hand', () => {
    const at = Date.now();
    const none = { ourAppId: '123', midKnown: false, lastOut: null };
    assert.equal(isOwnEcho({ appId: 123, text: 'hi', at }, none), true);
    assert.equal(isOwnEcho({ appId: '999', text: 'hi', at }, none), false);
    assert.equal(isOwnEcho({ text: 'hi', at }, { ...none, midKnown: true }), true);
    assert.equal(isOwnEcho({ text: 'Here is the LIST ', at }, { ...none, lastOut: { hash: textHash('here is the list'), at: at - 1000 } }), true);
    assert.equal(isOwnEcho({ text: 'Different words', at }, { ...none, lastOut: { hash: textHash('here is the list'), at: at - 1000 } }), false);
    assert.equal(isOwnEcho({ text: 'here is the list', at }, { ...none, lastOut: { hash: textHash('here is the list'), at: at - 3600_000 } }), false);
    assert.equal(isOwnEcho({ text: 'hello', at }, { ourAppId: '', midKnown: null, lastOut: null }), false);
});

test('Graph send errors: revoked tokens need a reconnect, rate limits retry, policy refusals do not', () => {
    const err = (status: number, error: Record<string, unknown>) => ({ response: { status, data: { error } } });
    assert.equal(classifyGraphError(err(400, { code: 190, error_subcode: 460, message: 'password changed' })).kind, 'token');
    assert.equal(classifyGraphError(err(400, { code: 190, error_subcode: 463 })).kind, 'token');
    assert.equal(classifyGraphError(err(400, { code: 10, error_subcode: 2018278 })).kind, 'window');
    assert.equal(classifyGraphError(err(400, { code: 613 })).kind, 'retryable');
    assert.equal(classifyGraphError(err(400, { code: 4 })).kind, 'retryable');
    assert.equal(classifyGraphError(err(500, { code: 2, is_transient: true })).kind, 'retryable');
    assert.equal(classifyGraphError(err(503, {})).kind, 'retryable');
    assert.equal(classifyGraphError({ message: 'socket hang up' }).kind, 'retryable');
    assert.equal(classifyGraphError(err(400, { code: 200, message: 'permission' })).kind, 'permanent');
    assert.equal(classifyGraphError(err(400, { code: 551 })).kind, 'permanent');
    assert.equal(classifyGraphError(err(400, { code: 368 })).kind, 'permanent');
});

// ─── Webhook signature ───────────────────────────────────────────────────────────────────────────

test('Meta webhook signatures are verified against the raw body', () => {
    const saved = { secret: process.env.META_APP_SECRET, fb: process.env.FACEBOOK_APP_SECRET, env: process.env.NODE_ENV };
    try {
        process.env.META_APP_SECRET = 'test-secret';
        const body = JSON.stringify({ object: 'instagram', entry: [{ id: '1', messaging: [{ sender: { id: '2' }, message: { mid: 'm1', text: 'hi' } }] }] });
        const sig = `sha256=${crypto.createHmac('sha256', 'test-secret').update(body, 'utf8').digest('hex')}`;
        assert.equal(verifyMetaSignature(body, sig), true);
        assert.equal(verifyMetaSignature(`${body} `, sig), false); // tampered body
        assert.equal(verifyMetaSignature(body, sig.replace(/.$/, (c) => (c === '0' ? '1' : '0'))), false);
        assert.equal(verifyMetaSignature(body, 'sha256=short'), false);
        assert.equal(verifyMetaSignature(body, undefined), false);
        assert.equal(verifyMetaSignature(undefined, sig), false);
        delete process.env.META_APP_SECRET;
        delete process.env.FACEBOOK_APP_SECRET;
        process.env.NODE_ENV = 'production';
        assert.equal(verifyMetaSignature(body, sig), false); // no secret in production: refused
        // Echoes are split like other messages, keyed by their mid (redeliveries are recognised).
        const units = splitMetaPayload({ object: 'page', entry: [{ id: 'P', messaging: [{ sender: { id: 'P' }, recipient: { id: 'U' }, message: { mid: 'm9', is_echo: true, text: 'hey' } }] }] })!;
        assert.equal(units[0].type, 'page.message');
        assert.equal(units[0].key, 'page:P:message:m9');
    } finally {
        if (saved.secret === undefined) delete process.env.META_APP_SECRET; else process.env.META_APP_SECRET = saved.secret;
        if (saved.fb === undefined) delete process.env.FACEBOOK_APP_SECRET; else process.env.FACEBOOK_APP_SECRET = saved.fb;
        if (saved.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.env;
    }
});

// ─── Plan gating ─────────────────────────────────────────────────────────────────────────────────

test('automation rules follow the plan limits; adding to Leads is Agency only', () => {
    assert.equal(ruleAllowance('starter', 0).ok, false);
    assert.equal(ruleAllowance('nano', 9).ok, true);
    assert.equal(ruleAllowance('nano', 10).ok, false);
    assert.equal(ruleAllowance('nano', 0, { addsLead: true }).ok, false);
    assert.equal(ruleAllowance('creator', 49).ok, true);
    assert.equal(ruleAllowance('creator', 0, { addsLead: true }).ok, false);
    assert.equal(ruleAllowance('agency', 10_000, { addsLead: true }).ok, true);
    assert.equal(ruleAllowance('made-up', 0).ok, false); // unknown plans are treated as Free
});

// ─── Lead sanitizing ─────────────────────────────────────────────────────────────────────────────

test('lead import keeps only whitelisted, typed and bounded fields', () => {
    const { leads, skipped } = sanitizeImport([
        {
            username: '@@creator_one',
            platform: 'TikTok',
            followersCount: '1200.7',
            status: 'contacted',
            tags: ['a', 'a', 7, 'x'.repeat(100)],
            notes: 'hello\u0000world',
            score: 999,
            tier: 'hot',
            externalId: 'fake-igsid',
            workspaceId: 'someone-else',
            __proto__: { polluted: true },
        },
        { username: '', platform: 'instagram' },
        { username: 'ok', platform: 'myspace' },
        { username: 'neg', followersCount: -5 },
        'not an object',
        ['array'],
        { username: { $gt: '' } },
    ]);
    assert.equal(leads.length, 1);
    const lead = leads[0];
    assert.equal(lead.username, 'creator_one');
    assert.equal(lead.platform, 'tiktok');
    assert.equal(lead.followersCount, 1200);
    assert.equal(lead.status, 'contacted');
    assert.deepEqual(lead.tags, ['a', 'x'.repeat(40)]);
    assert.equal(lead.notes, 'helloworld');
    for (const forbidden of ['score', 'tier', 'externalId', 'workspaceId', 'polluted']) assert.equal(Object.prototype.hasOwnProperty.call(lead, forbidden), false, forbidden);
    assert.deepEqual(skipped.map((s) => s.row), [2, 3, 4, 5, 6, 7]);
    assert.equal(sanitizeImport(Array(MAX_IMPORT_ROWS + 1).fill({ username: 'a' })).error !== undefined, true);
    assert.equal(sanitizeImport({ leads: [] }).error !== undefined, true);
    assert.equal(sanitizeNewLead({ username: 'x'.repeat(500) }).value!.username, 'x'.repeat(100));
    assert.equal(sanitizeNewLead({ username: 'a', status: 'owner' }).value!.status, 'prospect');
    assert.deepEqual(sanitizeNewLead({ username: 'a' }).value!.tags, ['manual']);
});
