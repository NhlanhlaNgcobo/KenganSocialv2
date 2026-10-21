// Run from the repository root: node scripts/check-beats.mjs [music files...]
// Beat detection on synthetic tracks with known tempo, beat times and downbeats (including
// human timing jitter), plus the pure beat-sync helpers: timeline mapping, cut planning, keyframes.
// Extra arguments are real music files (decoded with ffmpeg) whose analysis is printed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ANALYSIS_RATE, analyseBeats, beatKeyframes, nearestBeat, planBeatCuts, toTimelineBeats } from '../client/src/editor/lib/beats.js';

const SR = ANALYSIS_RATE;
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;

/** Kick on every beat (louder on downbeats), hi-hat on the off-beats, pad and noise underneath. */
function synth({ bpm, seconds = 30, offset = 0.37, downbeatIndex = 0, jitter = 0 }) {
    const out = new Float32Array(Math.round(seconds * SR));
    const period = 60 / bpm;
    const beats = [];
    const downbeats = [];
    for (let i = 0, t = offset; t < seconds - 0.3; i += 1, t = offset + i * period) {
        const at = t + (jitter ? rand() * jitter : 0);
        beats.push(at);
        const down = i % 4 === downbeatIndex;
        if (down) downbeats.push(at);
        const start = Math.round(at * SR);
        for (let k = 0; k < 0.18 * SR && start + k < out.length; k += 1) {
            const s = k / SR;
            out[start + k] += (down ? 0.9 : 0.55) * Math.exp(-s * 28) * Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-s * 40)) * s);
        }
        const hat = Math.round((at + period / 2) * SR);
        for (let k = 0; k < 0.04 * SR && hat + k < out.length; k += 1) out[hat + k] += 0.12 * Math.exp(-(k / SR) * 120) * rand();
    }
    for (let i = 0; i < out.length; i += 1) out[i] += 0.08 * Math.sin((2 * Math.PI * 220 * i) / SR) * (0.6 + 0.4 * Math.sin(i / SR)) + 0.004 * rand();
    return { samples: out, beats, downbeats };
}

function compare(name, truth, result, tolerance) {
    const inner = truth.beats.filter((t) => t > 1 && t < result.duration - 1);
    const hits = inner.filter((t) => nearestBeat(result.beats, t, tolerance) !== null).length;
    const errors = inner.map((t) => Math.abs(nearestBeat(result.beats, t) - t));
    const worst = Math.max(...errors);
    const downHits = truth.downbeats.filter((t) => t > 1 && t < result.duration - 1 && nearestBeat(result.downbeats, t, tolerance) !== null).length;
    const downTotal = truth.downbeats.filter((t) => t > 1 && t < result.duration - 1).length;
    return { name, hits, total: inner.length, worst, downHits, downTotal };
}

for (const spec of [
    { bpm: 95, offset: 0.21, downbeatIndex: 0 },
    { bpm: 128, offset: 0.37, downbeatIndex: 2 },
    { bpm: 140, offset: 0.05, downbeatIndex: 1 },
    { bpm: 110, offset: 0.6, downbeatIndex: 3, jitter: 0.015 },
]) {
    const truth = synth(spec);
    const r = analyseBeats(truth.samples);
    const label = `${spec.bpm} BPM${spec.jitter ? ` with ±${spec.jitter * 1000} ms timing jitter` : ''}`;
    assert.ok(Math.abs(r.bpm - spec.bpm) / spec.bpm < 0.01, `${label}: detected ${r.bpm} BPM`);
    const c = compare(label, truth, r, 0.012);
    assert.equal(c.hits, c.total, `${label}: ${c.hits}/${c.total} beats within 12 ms (worst ${(c.worst * 1000).toFixed(1)} ms)`);
    assert.ok(c.downHits >= c.downTotal * 0.9, `${label}: downbeats ${c.downHits}/${c.downTotal}`);
    console.log(`PASS ${label}: ${r.bpm} BPM, ${c.hits}/${c.total} beats within 12 ms (worst ${(c.worst * 1000).toFixed(1)} ms), downbeats ${c.downHits}/${c.downTotal}, confidence ${r.confidence}`);
}

// Silence and very short input: no beats, no crash.
assert.equal(analyseBeats(new Float32Array(SR * 5)).beats.length, 0);
assert.equal(analyseBeats(new Float32Array(100)).beats.length, 0);
console.log('PASS silence / short input give no beats');

// Timeline mapping: source beats through trim, speed and position.
const el = { startTime: 10, trimStart: 2, trimEnd: 1, duration: 8, speed: 2, beats: { beats: [1, 2, 2.5, 4, 7, 7.5], downbeats: [2], markers: [3] } };
assert.deepEqual(toTimelineBeats(el), [10, 10.25, 11, 12.5]);
assert.deepEqual(toTimelineBeats(el, 'downbeats'), [10]);
assert.deepEqual(toTimelineBeats(el, 'markers'), [10.5]);
assert.equal(nearestBeat([1, 2, 3], 2.4), 2);
assert.equal(nearestBeat([1, 2, 3], 2.7, 0.3), 3);
assert.equal(nearestBeat([1, 2, 3], 5, 0.5), null);
console.log('PASS beat times follow trim, speed and position');

// Cut planning on a 120 BPM grid (beats every 0.5 s).
const grid = Array.from({ length: 40 }, (_, i) => i * 0.5);
const nearest = planBeatCuts([{ length: 1.3, maxLength: 5 }, { length: 0.7, maxLength: 5 }, { length: 2.2, maxLength: 5 }], grid);
assert.deepEqual(nearest.map((c) => c.length), [1.5, 0.5, 2.2]);
assert.equal(nearest.synced, 2);
const montage = planBeatCuts([{ length: 3, maxLength: 5 }, { length: 0.4, maxLength: 5 }, { length: 2, maxLength: Infinity }], grid, { mode: 'every', every: 2 });
assert.deepEqual(montage.map((c) => c.length), [1, 1, 1]);
// Music with a pickup (first beat at 0.25 s): the first montage clip still spans two beats.
const pickup = planBeatCuts([{ length: 2, maxLength: 5 }, { length: 2, maxLength: 5 }], grid.map((b) => b + 0.25), { mode: 'every', every: 2 });
assert.deepEqual(pickup.map((c) => c.length), [1.25, 1]);
// A clip that cannot be extended keeps its length, and the next cut still lands on a beat.
const short = planBeatCuts([{ length: 0.3, maxLength: 0.3 }, { length: 1.1, maxLength: 3 }, { length: 1, maxLength: 3 }], grid, { mode: 'every', every: 2 });
assert.deepEqual(short.map((c) => c.length), [0.3, 1.7, 1]);
let cursor = 0;
for (const c of short.slice(0, -1)) cursor += c.length;
assert.ok(grid.some((b) => Math.abs(b - cursor) < 1e-9), 'cut after a short clip is back on the grid');
console.log(`PASS cut planning: nearest ${JSON.stringify(nearest.map((c) => c.length))}, every 2 beats ${JSON.stringify(montage.map((c) => c.length))}, unextendable clip ${JSON.stringify(short.map((c) => c.length))}`);

// Beat keyframes.
const pulse = beatKeyframes('pulse', [0.5, 1, 1.5], 2, { scale: 1, rotation: 0 });
assert.deepEqual(pulse.scale.map((k) => k.t), [0, 0.5, 0.72, 1, 1.22, 1.5, 1.72]);
assert.equal(pulse.scale[1].v, 1.08);
assert.deepEqual(beatKeyframes('flash', [], 2), {});
console.log('PASS beat keyframes (pulse on each beat, nothing without beats)');

// Real music (optional): print tempo and beat count.
for (const file of process.argv.slice(2)) {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-t', '120', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
    assert.equal(r.status, 0, String(r.stderr));
    const samples = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
    const t0 = Date.now();
    const a = analyseBeats(samples);
    console.log(`INFO ${file.split(/[\\/]/).pop()}: ${a.bpm} BPM, ${a.beats.length} beats, ${a.downbeats.length} downbeats, ${a.onsets.length} onsets, confidence ${a.confidence}, ${Date.now() - t0} ms`);
}
console.log('Beat checks passed.');
