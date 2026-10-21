// Run from the repository root: node scripts/check-transition-window.mjs
// The Kengan motion transitions (ks-*) render at half size over their own frames only, then are
// spliced between the untouched picture (timeline-render.service.js, joinSegments). Checks that
// against a full-size render: same length, every frame outside the transitions the same, frames
// inside close, nothing shifted by a frame, and an exact preview across a transition still matches.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { storeUpload } from '../server/src/services/manual-edit.service.js';
import { EXPORT_PRESETS, renderTimeline } from '../server/src/services/timeline-render.service.js';

const W = 640;
const H = 360;
const FPS = 30;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kengan-trwin-'));
const ff = (args) => {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
};
const pattern = path.join(dir, 'pattern.mp4');
ff(['-f', 'lavfi', '-i', `testsrc2=s=640x360:r=${FPS}:d=14`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=14', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', pattern]);
storeUpload('tw-pattern', pattern, 'tw-owner');
EXPORT_PRESETS.twtest = { width: W, height: H };

const clip = (from, start, transitionIn) => ({ kind: 'video', source: 'tw-pattern', sourceStart: from, sourceEnd: from + 3, timelineStart: start, speed: 1, volume: 1, filter: 'none', ...(transitionIn ? { transitionIn } : {}) });
const config = {
    version: 2,
    exportFormat: 'twtest',
    fps: FPS,
    backgroundColor: '#101010',
    duration: 12,
    main: [clip(1, 0), clip(4, 3, { type: 'ks-focus-snap', duration: 0.8 }), clip(7, 6, { type: 'dissolve', duration: 0.6 }), clip(10, 9, { type: 'ks-luma-bloom', duration: 0.8 })],
    overlays: [],
    audio: [],
    text: [],
};
// Transition windows (timeline seconds): each transition is centred on its cut.
const windows = [[3 - 0.4, 3 + 0.4], [9 - 0.4, 9 + 0.4]];
const inWindow = (n) => windows.some(([a, b]) => n >= Math.floor(a * FPS) - 1 && n <= Math.ceil(b * FPS) + 1);

function frames(file) {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'format=gray', '-vsync', '0', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
    assert.equal(r.status, 0, String(r.stderr));
    const size = W * H;
    return Array.from({ length: Math.floor(r.stdout.length / size) }, (_, i) => r.stdout.subarray(i * size, (i + 1) * size));
}
const mad = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]);
    return s / a.length;
};

let t = Date.now();
const windowed = await renderTimeline(config, 'tw-owner');
const windowedSeconds = (Date.now() - t) / 1000;
process.env.KENGAN_FULL_RES_TRANSITIONS = '1';
t = Date.now();
const fullRes = await renderTimeline(config, 'tw-owner');
const fullSeconds = (Date.now() - t) / 1000;
delete process.env.KENGAN_FULL_RES_TRANSITIONS;

const a = frames(windowed);
const b = frames(fullRes);
assert.equal(a.length, b.length, `windowed render has ${a.length} frames, full-size ${b.length}`);
assert.equal(a.length, 12 * FPS, `${a.length} frames, expected ${12 * FPS}`);
console.log(`PASS same length: ${a.length} frames (windowed ${windowedSeconds.toFixed(1)}s, full size ${fullSeconds.toFixed(1)}s)`);

const outside = [];
const inside = [];
a.forEach((f, n) => (inWindow(n) ? inside : outside).push({ n, d: mad(f, b[n]), next: b[n + 1] ? mad(f, b[n + 1]) : Infinity }));
const worstOut = outside.reduce((m, x) => (x.d > m.d ? x : m));
// Outside the transitions the picture went through the same filters: encoder noise only.
assert.ok(worstOut.d < 1.5, `frame ${worstOut.n} outside the transitions differs by ${worstOut.d.toFixed(2)}/255`);
const slipped = outside.filter((x) => x.next <= x.d);
assert.equal(slipped.length, 0, `${slipped.length} frames outside the transitions match the next frame better (shifted)`);
console.log(`PASS ${outside.length} frames outside the transitions match (worst ${worstOut.d.toFixed(2)}/255, none shifted)`);
const worstIn = inside.reduce((m, x) => (x.d > m.d ? x : m));
// Inside: half-size detail only (the test pattern's fine lines are the worst case).
assert.ok(worstIn.d < 12, `transition frame ${worstIn.n} differs by ${worstIn.d.toFixed(2)}/255`);
console.log(`PASS ${inside.length} transition frames close to the full-size render (worst ${worstIn.d.toFixed(2)}/255)`);

// Exact preview across the focus-snap transition matches the windowed full export.
const range = { start: 2.2, end: 3.8 };
const part = await renderTimeline({ ...config, range }, 'tw-owner');
const p = frames(part);
const from = Math.round(range.start * FPS);
const diffs = p.map((f, i) => mad(f, a[from + i]));
assert.equal(p.length, Math.round((range.end - range.start) * FPS));
assert.ok(Math.max(...diffs) < 2, `exact preview across the transition differs by up to ${Math.max(...diffs).toFixed(2)}/255`);
console.log(`PASS exact preview across the transition: ${p.length} frames match the export (worst ${Math.max(...diffs).toFixed(2)}/255)`);

for (const f of [windowed, fullRes, part]) fs.rmSync(f, { force: true });
fs.rmSync(dir, { recursive: true, force: true });
console.log('Transition window checks passed.');
process.exit(0);
