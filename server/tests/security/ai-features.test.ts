import test from 'node:test';
import assert from 'node:assert/strict';
import { OPTIONAL_AI_FEATURES, aiFeature, aiFeatureStatus } from '../../src/config/ai-features';
import { imageProviders } from '../../src/services/marketing/image-gen.js';
import { providerStatus } from '../../src/services/video-ads/providers.js';
import { useCloudTranscription } from '../../src/services/clips/cloud-transcribe.js';

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    try { fn(); } finally {
        for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    }
}

test('launch default: only cloud transcription is on; empty switches everything optional off', () => {
    withEnv({ LAUNCH_AI_FEATURES: undefined }, () => {
        for (const id of Object.keys(OPTIONAL_AI_FEATURES)) assert.equal(aiFeature(id as any), id === 'cloudTranscription', id);
    });
    withEnv({ LAUNCH_AI_FEATURES: '' }, () => {
        for (const id of Object.keys(OPTIONAL_AI_FEATURES)) assert.equal(aiFeature(id as any), false, id);
    });
    withEnv({ LAUNCH_AI_FEATURES: 'all' }, () => {
        assert.ok(Object.values(aiFeatureStatus()).every(Boolean));
    });
    withEnv({ LAUNCH_AI_FEATURES: ' aiImages, voiceover ,unknown' }, () => {
        const s = aiFeatureStatus();
        assert.equal(s.aiImages, true);
        assert.equal(s.voiceover, true);
        assert.equal(s.lyricsAi, false);
        assert.equal(Object.keys(s).includes('unknown'), false);
    });
});

test('switched-off features stop calling paid providers even when their keys are set', () => {
    const keys = { OPENROUTER_API_KEY: 'test', ELEVENLABS_API_KEY: 'test', TREBLO_API_KEY: 'test', OPENAI_API_KEY: 'test', CLIP_TRANSCRIBE: 'cloud' };
    withEnv({ ...keys, LAUNCH_AI_FEATURES: '' }, () => {
        assert.equal(imageProviders().openrouter, false, 'paid images off');
        assert.deepEqual(providerStatus(), { voice: false, music: false });
        assert.equal(useCloudTranscription(3600), false, 'cloud transcription off');
    });
    withEnv({ ...keys, LAUNCH_AI_FEATURES: 'aiImages,voiceover,aiMusic,cloudTranscription' }, () => {
        assert.equal(imageProviders().openrouter, true);
        assert.deepEqual(providerStatus(), { voice: true, music: true });
        assert.equal(useCloudTranscription(3600), true);
    });
});
