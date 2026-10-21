// Run from the repository root: node scripts/check-keyframes.mjs
// Proves the preview (JS) and export (FFmpeg expression) evaluate keyframes identically:
// FFmpeg's aevalsrc evaluates each track expression over time; samples are compared with JS.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EASINGS, evaluateTrack, normalizeKeyframes, trackExpression } from '../server/src/services/keyframes.js';

const RATE = 200;
function ffmpegSamples(expr, seconds) {
    // aevalsrc treats ',' as a channel separator outside parentheses; the expression is fully wrapped.
    const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `aevalsrc=exprs='${expr}':s=${RATE}:d=${seconds}`, '-f', 'f64le', '-acodec', 'pcm_f64le', '-'], { maxBuffer: 1 << 26 });
    assert.equal(r.status, 0, String(r.stderr));
    const buf = r.stdout;
    return Array.from({ length: buf.length / 8 }, (_, i) => buf.readDoubleLE(i * 8));
}

let checks = 0;
for (const ease of Object.keys(EASINGS)) {
    const track = [
        { t: 0.25, v: -40, ease },
        { t: 1.25, v: 160, ease: 'linear' },
        { t: 1.75, v: 60, ease },
    ];
    const samples = ffmpegSamples(trackExpression(track, 't'), 2);
    let worst = 0;
    samples.forEach((v, i) => {
        worst = Math.max(worst, Math.abs(v - evaluateTrack(track, i / RATE)));
    });
    assert.ok(worst < 1e-6, `${ease}: preview and export differ by ${worst}`);
    console.log(`PASS ${ease.padEnd(12)} max difference ${worst.toExponential(1)}`);
    checks += 1;
}

// Validation: clamps, sorting, de-duplication, unknown properties and easings.
const norm = normalizeKeyframes({ opacity: [{ t: 2, v: 5 }, { t: 1, v: -1, ease: 'nope' }, { t: 1, v: 0.5 }], bogus: [{ t: 0, v: 1 }] }, 'media');
assert.deepEqual(Object.keys(norm), ['opacity']);
assert.deepEqual(norm.opacity.map((k) => [k.t, k.v]), [[1, 0.5], [2, 1]]);
assert.equal(norm.opacity[0].ease, 'ease-in-out');
console.log('PASS validation (clamp, sort, duplicates, unknown keys)');
console.log(`${checks + 1} keyframe checks passed.`);
