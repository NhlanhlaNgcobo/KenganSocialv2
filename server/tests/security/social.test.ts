import test from 'node:test';
import assert from 'node:assert/strict';

const KEY = 'a'.repeat(64);

test('oauth state: signed, expiring, platform-bound, user-bound and single-use', async () => {
    const { signState, readState, consumeState, OAuthStateError } = await import('../../src/services/oauth-state');
    const used = new Set<string>();
    const claim = async (n: string) => (used.has(n) ? false : (used.add(n), true));

    const state = signState(KEY, { workspaceId: 'ws1', platform: 'tiktok', uid: 'u1' });
    const data = await consumeState(KEY, state, ['tiktok'], claim);
    assert.equal(data.workspaceId, 'ws1');
    assert.equal(data.uid, 'u1');

    await assert.rejects(consumeState(KEY, state, ['tiktok'], claim), /OAUTH_STATE_REUSED/, 'replay refused');
    const other = signState(KEY, { workspaceId: 'ws1', platform: 'youtube', uid: 'u1' });
    await assert.rejects(consumeState(KEY, other, ['tiktok'], claim), /OAUTH_STATE_PLATFORM_MISMATCH/);

    // Tampering with the payload (another workspace) breaks the signature.
    const [payload, sig] = state.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), workspaceId: 'victim' })).toString('base64url');
    assert.throws(() => readState(KEY, `${forged}.${sig}`), OAuthStateError);
    assert.throws(() => readState('b'.repeat(64), state), /INVALID_OAUTH_STATE/, 'another key');
    assert.throws(() => readState(KEY, 'garbage'), /INVALID_OAUTH_STATE/);
    const old = signState(KEY, { workspaceId: 'ws1', platform: 'tiktok', uid: 'u1' }, Date.now() - 16 * 60 * 1000);
    assert.throws(() => readState(KEY, old), /EXPIRED_OAUTH_STATE/);
});

test('oauth state: the nonce store fails closed in production', async () => {
    const { redisNonceClaimer } = await import('../../src/services/oauth-state');
    const down = redisNonceClaimer(async () => {
        throw new Error('redis down');
    });
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    await assert.rejects(down('n', 60), /OAUTH_STATE_STORE_UNAVAILABLE/);
    process.env.NODE_ENV = 'development';
    assert.equal(await down('n', 60), true);
    process.env.NODE_ENV = prev;
    const store = new Map();
    const fake = redisNonceClaimer(async () => ({ set: async (k: string) => (store.has(k) ? null : (store.set(k, 1), 'OK')) }));
    assert.equal(await fake('x', 60), true);
    assert.equal(await fake('x', 60), false);
});

test('oauth errors are logged without request bodies, secrets or tokens', async () => {
    const { safeOAuthError } = await import('../../src/services/oauth-state');
    const axiosLike = {
        message: 'Request failed with status code 400',
        config: { data: 'client_secret=SUPERSECRET&code=AUTHCODE', headers: { Authorization: 'Bearer TOKEN123' } },
        response: { status: 400, data: { error: 'invalid_grant', error_description: 'Code expired' } },
    };
    const line = safeOAuthError(axiosLike);
    assert.match(line, /HTTP 400/);
    assert.ok(!/SUPERSECRET|AUTHCODE|TOKEN123/.test(line), line);
    assert.match(safeOAuthError(new Error('ECONNRESET')), /ECONNRESET/);
});

test('publish availability: connected vs approved vs manual export, per network', async () => {
    delete process.env.BETA_ACCESS;
    process.env.PUBLISH_APPROVED_PLATFORMS = 'tiktok';
    const { availabilityFor } = await import('../../src/services/publish-availability');
    assert.equal(availabilityFor('tiktok', { configured: true, connection: { status: 'active' } }).status, 'approved-to-publish');
    assert.equal(availabilityFor('tiktok', { configured: true, connection: { status: 'expired' } }).status, 'expired');
    assert.equal(availabilityFor('youtube', { configured: true, connection: { status: 'active' } }).status, 'connected');
    assert.equal(availabilityFor('youtube', { configured: true, connection: null }).status, 'review-required');
    const linkedin = availabilityFor('linkedin', { configured: false });
    assert.equal(linkedin.status, 'manual-export-only');
    assert.equal(linkedin.manualExport, true);
    assert.equal(availabilityFor('youtube', { configured: true, connection: { status: 'active' } }).canPublish, false);

    const { betaPublishAllowed } = await import('../../src/config/beta-features.js');
    assert.equal(betaPublishAllowed(['tiktok']), true);
    assert.equal(betaPublishAllowed(['tiktok', 'youtube']), false, 'publishing is refused for unapproved networks');
    delete process.env.PUBLISH_APPROVED_PLATFORMS;
    assert.equal(betaPublishAllowed(['youtube']), true, 'unset: previous behaviour');
});
