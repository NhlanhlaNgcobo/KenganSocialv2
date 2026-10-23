import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptChunks, footageSignals } from '../../src/services/clips/quality.js';
import { findClips } from '../../src/services/clips/find-clips.js';

test('long transcript chunking retains every sentence and overlaps boundaries', () => {
    const sentences = Array.from({ length: 1200 }, (_, i) => ({ start: i * 5, end: i * 5 + 4, text: `Sentence ${i}: ${'word '.repeat(35)}` }));
    const chunks = transcriptChunks(sentences);
    assert.ok(chunks.length > 1);
    assert.equal(new Set(chunks.flat().map(s => s.start)).size, sentences.length);
    for (let i = 1; i < chunks.length; i++) assert.ok(chunks[i][0].start < chunks[i - 1].at(-1)!.end);
});

test('fallback clips never claim a performance score; measured activity is available to editor', async () => {
    const result = await findClips({ words: [], duration: 300, signalClips: [], count: 3, length: 'short' }, { configured: () => false });
    assert.equal(result.clips.length, 3);
    assert.ok(result.clips.every(c => c.score === null && c.scoreKind === 'unscored'));
    const signals = footageSignals({ durationSec: 30, faceTrack: { samples: [{ t: 2, faces: [{ act: .3 }] }] } });
    assert.ok(signals[0].score > 0);
});

test('AI trend scores are omitted without dated evidence', async () => {
    const words = Array.from({ length: 90 }, (_, i) => ({ start: i * .5, end: i * .5 + .4, text: i % 12 === 11 ? 'point.' : 'word' }));
    const generate = async () => ({ clips: [{ start: 0, end: 22, scores: { hook: 80, flow: 70, value: 60, trend: 100 }, title: 'A complete thought' }] });
    const result = await findClips({ words, duration: 45, signalClips: [], count: 1, length: 'short' }, { configured: () => true, generate });
    assert.equal(result.finder, 'ai');
    assert.equal(result.clips[0].scores.trend, null);
    assert.equal(result.clips[0].score, 71);
});
