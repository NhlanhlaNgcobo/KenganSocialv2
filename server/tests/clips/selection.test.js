import test from 'node:test';
import assert from 'node:assert/strict';
import { selectClipMoments } from '../../src/services/clips/select-clips.js';

test('long speech videos reach AI selection without a full-video scan', async () => {
    const expected = { finder: 'ai', clips: [{ start: 20, end: 50 }] };
    const result = await selectClipMoments({ duration: 2467, words: Array(4000).fill({}) },
        () => assert.fail('Full-video scan must not run'), async input => { assert.deepEqual(input.signalClips, []); return expected; });
    assert.equal(result, expected);
});

test('unavailable AI falls back to visual signals without a second provider call', async () => {
    let scans = 0, attempts = 0;
    const signals = [{ startSec: 100, endSec: 130 }];
    const result = await selectClipMoments({ duration: 2467, words: Array(100).fill({}) }, async () => { scans++; return signals; }, async (input, dependencies) => {
        attempts++;
        if (attempts === 1) return { finder: 'signals', clips: [] };
        assert.equal(dependencies.configured(), false);
        assert.equal(input.signalClips, signals);
        return { finder: 'signals', clips: signals };
    });
    assert.equal(scans, 1); assert.equal(attempts, 2); assert.equal(result.clips, signals);
});

test('short or silent sources still use visual analysis', async () => {
    for (const input of [{ duration: 30, words: Array(100).fill({}) }, { duration: 2400, words: [] }]) {
        let scanned = false;
        await selectClipMoments(input, async () => { scanned = true; return []; }, async () => { assert.ok(scanned); return { finder: 'signals', clips: [] }; });
    }
});
