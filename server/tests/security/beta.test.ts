import test from 'node:test';
import assert from 'node:assert/strict';
import { BETA_LIMITS, BETA_MAX_SOURCE_MINUTES, PLAN_LIMITS } from '../../src/utils/planLimits';
import { effectivePlan, onBeta } from '../../src/utils/trial';
import { isBeta, maxSourceMinutes, mediaPlan, noteBeta, usageLimit } from '../../src/middleware/planGate';

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    try { fn(); } finally {
        for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    }
}

test('the free beta gives free workspaces the beta plan, and only them', () => {
    const free = { plan: 'starter' };
    const paid = { plan: 'agency', paymentProvider: 'payfast', currentPeriodEnd: new Date(Date.now() + 86400000).toISOString() };
    const trial = { plan: 'starter', trialPlan: 'agency', trialEndsAt: new Date(Date.now() + 86400000).toISOString() };
    withEnv({ BETA_ACCESS: undefined }, () => {
        assert.equal(effectivePlan(free), 'starter');
        assert.equal(onBeta(free), false);
    });
    withEnv({ BETA_ACCESS: 'on', BETA_PLAN: undefined }, () => {
        assert.equal(effectivePlan(free), 'creator');
        assert.equal(onBeta(free), true);
        assert.equal(effectivePlan(paid), 'agency');
        assert.equal(onBeta(paid), false, 'paying customers keep their plan');
        assert.equal(effectivePlan(trial), 'agency');
        assert.equal(onBeta(trial), false, 'a running trial comes first');
        assert.equal(onBeta({ plan: 'starter', unlimited: true }), false);
    });
    withEnv({ BETA_ACCESS: 'on', BETA_PLAN: 'nano' }, () => {
        assert.equal(effectivePlan(free), 'nano');
    });
});

test('beta workspaces get beta quantities, the fast speech model and 15-minute videos', () => {
    const ws = `beta-test-${Date.now()}`;
    assert.equal(isBeta(ws), false);
    assert.equal(usageLimit(ws, 'creator', 'clipAnalysis'), PLAN_LIMITS.creator.clipAnalysis);
    noteBeta(ws, true);
    assert.equal(usageLimit(ws, 'creator', 'clipAnalysis'), BETA_LIMITS.clipAnalysis);
    assert.equal(usageLimit(ws, 'creator', 'exports'), BETA_LIMITS.exports);
    assert.equal(usageLimit(ws, 'creator', 'dms'), BETA_LIMITS.dms);
    assert.equal(mediaPlan(ws, 'creator'), 'nano');
    assert.equal(maxSourceMinutes(ws, 'creator'), BETA_MAX_SOURCE_MINUTES);
    noteBeta(ws, false);
    assert.equal(usageLimit(ws, 'creator', 'clipAnalysis'), PLAN_LIMITS.creator.clipAnalysis);
});

test('BETA_PLATFORMS opens only the listed platforms for connecting and publishing', async () => {
    const { betaFeatureLock, betaLockedPages, betaPublishAllowed, isBetaOAuthCallback } = await import('../../src/config/beta-features.js');
    const call = (method: string, path: string, body: any = {}) => {
        let status = 200;
        betaFeatureLock({ method, path, body } as any, { status: (s: number) => ({ json: () => { status = s; } }) } as any, () => {});
        return status;
    };
    withEnv({ BETA_ACCESS: 'on', BETA_PLATFORMS: undefined }, () => {
        assert.equal(call('GET', '/connections'), 403, 'no beta platform: Connections stays locked');
        assert.equal(call('GET', '/workspaces/w1/connections'), 403);
        assert.equal(betaPublishAllowed(['tiktok']), false);
        assert.ok(betaLockedPages().includes('/dashboard/connections'));
        assert.equal(isBetaOAuthCallback('/connections/tiktok/callback'), false);
    });
    withEnv({ BETA_ACCESS: 'on', BETA_PLATFORMS: 'tiktok' }, () => {
        assert.equal(call('GET', '/connections'), 200);
        assert.equal(call('GET', '/connections/tiktok/auth-url'), 200);
        assert.equal(call('GET', '/connections/instagram/auth-url'), 403);
        assert.equal(call('GET', '/connections/youtube/videos'), 403);
        assert.equal(call('GET', '/workspaces/w1/connections'), 200, 'the Connections page lists accounts here');
        assert.equal(call('PUT', '/workspaces/w1/connections/c1'), 200, 'regroup into a folder');
        assert.equal(call('DELETE', '/workspaces/w1/connections/c1'), 200, 'disconnect');
        assert.equal(call('POST', '/workspaces/w1/connections'), 403, 'adding a record by hand stays locked');
        assert.equal(call('GET', '/workspaces/w1/automations'), 403);
        assert.ok(!betaLockedPages().includes('/dashboard/connections'));
        assert.ok(betaLockedPages().includes('/dashboard/dm'));
        assert.equal(betaPublishAllowed(['tiktok']), true);
        assert.equal(betaPublishAllowed(['tiktok', 'instagram']), false, 'every platform in a post must be open');
        assert.equal(betaPublishAllowed([]), false);
        assert.equal(call('POST', '/schedule/create', { platforms: ['tiktok'], status: 'pending' }), 200);
        assert.equal(call('POST', '/schedule/create', { platforms: ['instagram'], status: 'pending' }), 403);
        assert.equal(call('POST', '/schedule/create', { platforms: ['instagram'], status: 'draft' }), 200, 'drafts are always allowed');
        assert.equal(isBetaOAuthCallback('/connections/tiktok/callback'), true);
        assert.equal(isBetaOAuthCallback('/connections/instagram/callback'), false);
        assert.equal(isBetaOAuthCallback('/connections/tiktok/auth-url'), false);
    });
    withEnv({ BETA_ACCESS: 'on', BETA_PLATFORMS: 'tiktok,instagram,bogus' }, () => {
        assert.equal(betaPublishAllowed(['instagram']), false, 'only tiktok and youtube can be opened in the beta');
    });
    withEnv({ BETA_ACCESS: undefined, BETA_PLATFORMS: undefined }, () => {
        assert.equal(betaPublishAllowed(['instagram']), true, 'outside the beta nothing is locked');
        assert.equal(isBetaOAuthCallback('/connections/tiktok/callback'), false);
    });
});
