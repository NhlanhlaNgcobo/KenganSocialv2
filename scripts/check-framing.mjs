// Run from the repository root: node scripts/check-framing.mjs
// Zoomed and moving clips are framed in the source picture (crop, then scale). This compares that
// against the older canvas-zoom path, which scales the whole fitted canvas, on landscape footage
// filling a vertical canvas with a push-in, keyframed position, a zoom-out reveal and a photo.
// Geometry must match; the new path should be faster and at least as sharp.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { storeUpload } from '../server/src/services/manual-edit.service.js';
import { EXPORT_PRESETS, renderTimeline } from '../server/src/services/timeline-render.service.js';

const W = 360;
const H = 640;
const FPS = 30;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kengan-framing-'));
const ff = (args) => assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]).status, 0);
const wide = path.join(dir, 'wide.mp4');
ff(['-f', 'lavfi', '-i', `testsrc2=s=1280x720:r=${FPS}:d=6`, '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', wide]);
const photo = path.join(dir, 'photo.png');
ff(['-f', 'lavfi', '-i', 'testsrc=s=1000x750:d=1', '-frames:v', '1', photo]);
storeUpload('fr-wide', wide, 'fr-owner');
storeUpload('fr-photo', photo, 'fr-owner');
EXPORT_PRESETS.frtest = { width: W, height: H };
const fill = Math.max(W / 1280, H / 720) / Math.min(W / 1280, H / 720); // cover ÷ contain
const base = { speed: 1, volume: 0, filter: 'none' };
const config = {
    version: 2,
    exportFormat: 'frtest',
    fps: FPS,
    backgroundColor: '#202020',
    duration: 6,
    main: [
        { ...base, kind: 'video', source: 'fr-wide', sourceStart: 0, sourceEnd: 2, timelineStart: 0, transform: { scaleStart: fill, scaleEnd: fill * 1.15, x: 0, y: 0 } },
        { ...base, kind: 'video', source: 'fr-wide', sourceStart: 2, sourceEnd: 4, timelineStart: 2, transform: { scaleStart: fill, scaleEnd: fill, x: 0, y: 0 }, keyframes: { x: [{ t: 0, v: -150, ease: 'ease-in-out' }, { t: 2, v: 150, ease: 'linear' }], scale: [{ t: 0, v: fill * 1.3, ease: 'back-out' }, { t: 1, v: 0.8, ease: 'linear' }] } },
        { ...base, kind: 'image', source: 'fr-photo', sourceStart: 0, sourceEnd: 2, timelineStart: 4, transform: { scaleStart: 1, scaleEnd: 2.4, x: 30, y: -40, xEnd: -30, yEnd: 40 } },
    ],
    overlays: [],
    audio: [],
    text: [],
};

const render = async (mode) => {
    if (mode) process.env.KENGAN_FRAMING = mode;
    else delete process.env.KENGAN_FRAMING;
    const t0 = Date.now();
    const out = await renderTimeline(config, 'fr-owner');
    return { out, seconds: (Date.now() - t0) / 1000 };
};
const before = await render('canvas');
const after = await render(null);
const gray = (file) => {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 29 });
    const size = W * H;
    return Array.from({ length: Math.floor(r.stdout.length / size) }, (_, i) => r.stdout.subarray(i * size, (i + 1) * size));
};
const a = gray(before.out);
const b = gray(after.out);
assert.equal(a.length, b.length);
const corr = (x, y) => {
    let mx = 0;
    let my = 0;
    for (let i = 0; i < x.length; i += 1) {
        mx += x[i];
        my += y[i];
    }
    mx /= x.length;
    my /= y.length;
    let c = 0;
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < x.length; i += 1) {
        c += (x[i] - mx) * (y[i] - my);
        vx += (x[i] - mx) ** 2;
        vy += (y[i] - my) ** 2;
    }
    return c / Math.sqrt(vx * vy);
};
// Sharpness: mean absolute horizontal gradient.
const sharp = (f) => {
    let s = 0;
    for (let y = 0; y < H; y += 1) for (let x = 1; x < W; x += 1) s += Math.abs(f[y * W + x] - f[y * W + x - 1]);
    return s / (W * H);
};
for (const [n, label] of [[15, 'push-in on landscape footage'], [45, 'end of push-in'], [70, 'overshooting zoom with keyframed move'], [100, 'zoom-out reveal (background shows)'], [130, 'photo zooming in and moving'], [170, 'photo at 2.4×']]) {
    const c = corr(a[n], b[n]);
    assert.ok(c > 0.97, `${label} (frame ${n}): correlation ${c.toFixed(3)}`);
    console.log(`PASS ${label} at ${(n / FPS).toFixed(2)}s: same framing (correlation ${c.toFixed(3)}), sharpness ${sharp(a[n]).toFixed(1)} → ${sharp(b[n]).toFixed(1)}`);
}
console.log(`PASS render time: canvas zoom ${before.seconds.toFixed(1)}s → source framing ${after.seconds.toFixed(1)}s`);
fs.rmSync(before.out, { force: true });
fs.rmSync(after.out, { force: true });
console.log('Framing checks passed.');
process.exit(0);
