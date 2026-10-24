import test from 'node:test';
import assert from 'node:assert/strict';
import { CREDIT_COSTS, MAX_SOURCE_MINUTES, PLAN_LIMITS, TRIAL_LIMITS, TRIAL_MEDIA_PLAN, transcriptionMinutes, videoUnits } from '../../src/utils/planLimits';
import { PLAN_CATALOG } from '../../src/config/plan-catalog';
import { mediaPlan, noteTrial, usageLimit } from '../../src/middleware/planGate';
// @ts-ignore -- plain ES module shared with docs/pricing
import { CREDIT_PRICES, ECON, PLANS, costPlan } from '../../../scripts/pricing-model.mjs';

const tierOf = (id: string) => (PLANS as any[]).find((p) => p.id === id);

test('the cost model uses exactly the limits, prices and credit costs the app enforces', () => {
    for (const tier of ['starter', 'nano', 'creator', 'agency'] as const) {
        const model = (PLANS as any[]).find((p) => p.tier === tier && p.id !== 'trial' && p.id !== 'enterprise');
        const live: any = PLAN_LIMITS[tier];
        for (const key of ['posts', 'exports', 'transcribeMinutes', 'clipAnalysis', 'aiCalls', 'renders', 'storageGB']) {
            assert.equal(model.limits[key], live[key], `${tier}.${key}`);
        }
        assert.equal(model.maxSourceMin, MAX_SOURCE_MINUTES[tier], `${tier} max source minutes`);
    }
    for (const [id, plan] of Object.entries(PLAN_CATALOG) as [string, any][]) {
        assert.equal(tierOf(id)?.price, plan.amountZar, `${id} price`);
    }
    for (const [action, credits] of Object.entries(CREDIT_COSTS)) {
        assert.equal((CREDIT_PRICES as any)[action], credits, `credits for ${action}`);
    }
    const trial = tierOf('trial').limits;
    for (const key of Object.keys(trial)) assert.equal(trial[key], (TRIAL_LIMITS as any)[key], `trial ${key}`);
    assert.equal(tierOf('trial').maxSourceMin, MAX_SOURCE_MINUTES[TRIAL_MEDIA_PLAN], 'trial max source minutes');
    assert.equal(tierOf('trial').whisper, tierOf('creator_starter').whisper, 'trial speech model');
});

test('a running trial uses Creator Starter video length and speech model; paid plans keep their own', () => {
    const ws = `trial-media-${Date.now()}`;
    assert.equal(mediaPlan(ws, 'agency'), 'agency');
    noteTrial(ws, new Date(Date.now() + 86400000).toISOString());
    assert.equal(mediaPlan(ws, 'agency'), TRIAL_MEDIA_PLAN);
    assert.equal(mediaPlan(ws, 'nano'), 'nano');
    assert.equal(mediaPlan(ws, 'starter'), 'starter'); // no clips on Free, trial or not
    noteTrial(ws, new Date(Date.now() - 1000).toISOString());
    assert.equal(mediaPlan(ws, 'agency'), 'agency');
});

test('every paid plan keeps a 60% gross margin at 100% use, monthly and annual', () => {
    for (const plan of (PLANS as any[]).filter((p) => p.price > 0)) {
        const r = costPlan(plan);
        assert.ok(r.monthly.margin >= ECON.targetMargin, `${plan.name} monthly margin ${(r.monthly.margin * 100).toFixed(1)}%`);
        assert.ok(r.annual.margin >= ECON.targetMargin, `${plan.name} annual margin ${(r.annual.margin * 100).toFixed(1)}%`);
    }
});

test('usage is counted by length: minutes of transcription, 5-minute video units', () => {
    assert.equal(transcriptionMinutes(0), 1);
    assert.equal(transcriptionMinutes(61), 2);
    assert.equal(transcriptionMinutes(3600), 60);
    assert.equal(videoUnits(10), 1);
    assert.equal(videoUnits(300), 1);
    assert.equal(videoUnits(301), 2);
    assert.equal(videoUnits(1800), 6);
    assert.equal(videoUnits(NaN), 1);
});

test('a running trial unlocks the plan but caps quantities at the trial limits', () => {
    const ws = `trial-test-${Date.now()}`;
    assert.equal(usageLimit(ws, 'agency', 'aiCalls'), PLAN_LIMITS.agency.aiCalls);
    noteTrial(ws, new Date(Date.now() + 86400000).toISOString());
    assert.equal(usageLimit(ws, 'agency', 'aiCalls'), TRIAL_LIMITS.aiCalls);
    assert.equal(usageLimit(ws, 'agency', 'renders'), TRIAL_LIMITS.renders);
    assert.equal(usageLimit(ws, 'agency', 'dms'), TRIAL_LIMITS.dms); // unlimited on Agency, capped on trial
    assert.equal(usageLimit(ws, 'starter', 'aiCalls'), 0); // locked features stay locked
    noteTrial(ws, new Date(Date.now() - 1000).toISOString()); // ended
    assert.equal(usageLimit(ws, 'agency', 'aiCalls'), PLAN_LIMITS.agency.aiCalls);
});

test('the 60% margin also holds if the rand weakens to the stress exchange rate', () => {
    const base = ECON.usdZar;
    ECON.usdZar = ECON.stressUsdZar;
    try {
        for (const plan of (PLANS as any[]).filter((p) => p.price > 0)) {
            const r = costPlan(plan);
            assert.ok(r.annual.margin >= ECON.targetMargin, `${plan.name} annual margin at R${ECON.usdZar}/$: ${(r.annual.margin * 100).toFixed(1)}%`);
        }
    } finally {
        ECON.usdZar = base;
    }
});
