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
