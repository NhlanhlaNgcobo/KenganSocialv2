// Run from the repository root: node scripts/check-editor-keyframes.mjs
// Keyframes through the real export pipeline, measured in the output pixels against the values the
// editor preview computes (keyframes.js): position, opacity and a clip whose start borrows footage
// for a transition. Rotation, overlay and text keyframes must render.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { storeUpload } from '../server/src/services/manual-edit.service.js';
import { EXPORT_PRESETS, renderTimeline } from '../server/src/services/timeline-render.service.js';
import { evaluateTrack, normalizeKeyframes } from '../server/src/services/keyframes.js';

const W = 320;
const H = 180;
const FPS = 30;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kengan-keyframes-'));
const make = (name, filter, seconds) => {
    const file = path.join(dir, name);
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `${filter}:s=${W}x${H}:r=${FPS}:d=${seconds}`, '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`, '-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '10', '-c:a', 'aac', '-shortest', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return file;
};
// A 20×20 white box centred on black, and a plain white frame.
const boxFile = path.join(dir, 'box.mp4');
{
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=black:s=${W}x${H}:r=${FPS}:d=4`, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-vf', `drawbox=x=${W / 2 - 10}:y=${H / 2 - 10}:w=20:h=20:color=white:t=fill`, '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '10', '-c:a', 'aac', '-shortest', boxFile], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
}
const whiteFile = make('white.mp4', 'color=white', 2);
storeUpload('kf-box', boxFile, 'kf-owner');
storeUpload('kf-white', whiteFile, 'kf-owner');
EXPORT_PRESETS.kftest = { width: W, height: H };

const xTrack = [{ t: 0, v: -100, ease: 'ease-in-out' }, { t: 2, v: 100, ease: 'linear' }];
const yTrack = [{ t: 0, v: 0, ease: 'linear' }, { t: 2, v: -40, ease: 'linear' }];
const opacityTrack = [{ t: 0, v: 0, ease: 'ease-in' }, { t: 1, v: 1, ease: 'linear' }];
const shiftTrack = [{ t: 0, v: -100, ease: 'linear' }, { t: 1, v: 100, ease: 'linear' }];
const base = { kind: 'video', speed: 1, volume: 0, filter: 'none' };
const config = {
    version: 2,
    exportFormat: 'kftest',
    fps: FPS,
    backgroundColor: '#000000',
    duration: 4,
    main: [
        // 0–2 s: box moving on eased x and linear y.
        { ...base, source: 'kf-box', sourceStart: 0, sourceEnd: 2, timelineStart: 0, keyframes: { x: xTrack, y: yTrack } },
        // 2–3 s: white frame fading in with ease-in.
        { ...base, source: 'kf-white', sourceStart: 0, sourceEnd: 1, timelineStart: 2, keyframes: { opacity: opacityTrack } },
        // 3–4 s: box with a fade in that borrows 0.2 s of footage before the clip (source starts at 1 s).
        { ...base, source: 'kf-box', sourceStart: 1, sourceEnd: 2, timelineStart: 3, transitionIn: { type: 'fade', duration: 0.4 }, keyframes: { x: shiftTrack, rotation: [{ t: 0.5, v: 0 }, { t: 1, v: 0 }] } },
    ],
    overlays: [{ ...base, source: 'kf-box', sourceStart: 0, sourceEnd: 1, timelineStart: 0.5, transform: { scaleStart: 0.5, scaleEnd: 0.5, x: 0, y: 0 }, keyframes: { x: [{ t: 0, v: -60 }, { t: 1, v: 60 }], opacity: [{ t: 0, v: 1 }, { t: 1, v: 0.3 }], rotation: [{ t: 0, v: 0 }, { t: 1, v: 45 }] } }],
    audio: [],
    text: [{ content: 'Keyframed', timelineStart: 0, timelineEnd: 1.5, fontSize: 20, fontFamily: 'Arial', bold: true, color: '#ffffff', backgroundColor: 'transparent', x: 0, y: 60, opacity: 1, keyframes: { y: [{ t: 0, v: 80, ease: 'back-out' }, { t: 0.5, v: 60 }], opacity: [{ t: 0, v: 0 }, { t: 0.3, v: 1 }] } }],
};

const output = await renderTimeline(config, 'kf-owner');
console.log(`PASS keyframed export rendered: ${output}`);

function frameGray(n, file = output) {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 24 });
    assert.equal(r.status, 0, String(r.stderr));
    return r.stdout;
}
function boxCentre(buf, yMax = H) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = 0; y < yMax; y += 1)
        for (let x = 0; x < W; x += 1)
            if (buf[y * W + x] > 128) {
                sx += x;
                sy += y;
                n += 1;
            }
    return n ? { x: sx / n + 0.5, y: sy / n + 0.5, n } : null;
}
const mean = (buf) => buf.reduce((s, v) => s + v, 0) / buf.length;

// Position (0–2 s). The overlay and text sit elsewhere: measure only the top 70% of rows before 0.5 s
// (overlay starts at 0.5 s), and use frames before the overlay appears.
for (const n of [3, 6, 9, 12]) {
    const t = n / FPS;
    const c = boxCentre(frameGray(n), Math.round(H * 0.72));
    const ex = W / 2 + evaluateTrack(xTrack, t);
    const ey = H / 2 + evaluateTrack(yTrack, t);
    assert.ok(c, `no box at frame ${n}`);
    assert.ok(Math.abs(c.x - ex) < 1 && Math.abs(c.y - ey) < 1, `position at ${t.toFixed(3)}s: export (${c.x.toFixed(1)}, ${c.y.toFixed(1)}) vs preview (${ex.toFixed(1)}, ${ey.toFixed(1)})`);
    console.log(`PASS position at ${t.toFixed(3)}s: export (${c.x.toFixed(1)}, ${c.y.toFixed(1)}) = preview (${ex.toFixed(1)}, ${ey.toFixed(1)})`);
}

// Opacity (2–3 s): mean brightness of white fading over black follows the ease-in curve.
for (const n of [66, 75, 84]) {
    const local = n / FPS - 2;
    const expected = 255 * evaluateTrack(opacityTrack, local);
    const got = mean(frameGray(n));
    assert.ok(Math.abs(got - expected) < 6, `opacity at ${local.toFixed(3)}s: export ${got.toFixed(1)} vs preview ${expected.toFixed(1)}`);
    console.log(`PASS opacity at ${local.toFixed(3)}s: export ${got.toFixed(1)} ≈ preview ${expected.toFixed(1)} (of 255)`);
}

// Overlay opacity (starts at 0.5 s): its white box sits over black at its keyframed centre, so those
// pixels show 255 × the keyframed opacity.
// Normalised as the renderer does (keyframes without an ease get the default ease-in-out).
const { opacity: overlayOpacity, x: overlayX } = normalizeKeyframes(config.overlays[0].keyframes, 'media');
for (const n of [30, 39]) {
    const local = n / FPS - 0.5;
    const buf = frameGray(n);
    let sum = 0;
    const cx = Math.round(W / 2 + evaluateTrack(overlayX, local));
    for (let y = H / 2 - 2; y < H / 2 + 2; y += 1) for (let x = cx - 2; x < cx + 2; x += 1) sum += buf[y * W + x];
    const got = sum / 16;
    const expected = 255 * evaluateTrack(overlayOpacity, local);
    assert.ok(Math.abs(got - expected) < 8, `overlay opacity at ${local.toFixed(3)}s: export ${got.toFixed(1)} vs preview ${expected.toFixed(1)}`);
    console.log(`PASS overlay opacity at ${local.toFixed(3)}s: export ${got.toFixed(1)} ≈ preview ${expected.toFixed(1)} (of 255)`);
}

// Transition-borrowed head (3–4 s): after the 0.2 s fade half, the box must follow the clip's own time.
for (const n of [99, 108, 114]) {
    const local = n / FPS - 3;
    const c = boxCentre(frameGray(n));
    const ex = W / 2 + evaluateTrack(shiftTrack, local);
    assert.ok(c && Math.abs(c.x - ex) < 1, `borrowed-head clip at ${local.toFixed(3)}s: export ${c?.x.toFixed(1)} vs preview ${ex.toFixed(1)}`);
    console.log(`PASS keyframes stay on the clip after a transition at ${local.toFixed(3)}s: export ${c.x.toFixed(1)} = preview ${ex.toFixed(1)}`);
}
// Animated zoom keeps the picture centred and sized as the preview computes it: scale keyframes,
// a camera zoom-out, an overshooting ease, and an overlay with scale keyframes (all used to drift
// off-centre because frames changed size mid-filter).
function boxSize(buf) {
    let minX = W;
    let maxX = -1;
    let minY = H;
    let maxY = -1;
    for (let i = 0; i < buf.length; i += 1)
        if (buf[i] > 128) {
            const x = i % W;
            const y = Math.floor(i / W);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
    return maxX < 0 ? null : { w: maxX - minX + 1, cx: (minX + maxX + 1) / 2, cy: (minY + maxY + 1) / 2 };
}
const zoomTrack = [{ t: 0, v: 3, ease: 'linear' }, { t: 1, v: 1, ease: 'linear' }];
const springTrack = [{ t: 0, v: 0.5, ease: 'back-out' }, { t: 0.6, v: 1.5, ease: 'linear' }];
const zoomOutput = await renderTimeline(
    {
        ...config,
        duration: 3,
        main: [
            { ...base, source: 'kf-box', sourceStart: 0, sourceEnd: 1, timelineStart: 0, keyframes: { scale: zoomTrack } },
            { ...base, source: 'kf-box', sourceStart: 0, sourceEnd: 1, timelineStart: 1, transform: { scaleStart: 2.5, scaleEnd: 1, x: 0, y: 0 } },
            { ...base, source: 'kf-box', sourceStart: 0, sourceEnd: 1, timelineStart: 2, keyframes: { scale: springTrack } },
        ],
        overlays: [],
        text: [],
    },
    'kf-owner'
);
const zoomCases = [
    ...[0, 9, 18, 27].map((n) => ({ n, z: evaluateTrack(zoomTrack, n / FPS), what: 'scale keyframes' })),
    // Camera zoom-out: progress over the clip's 1 s.
    ...[33, 45, 57].map((n) => ({ n, z: 2.5 - 1.5 * (n / FPS - 1), what: 'camera zoom-out' })),
    ...[63, 66, 72, 84].map((n) => ({ n, z: evaluateTrack(springTrack, n / FPS - 2), what: 'overshooting ease' })),
];
for (const c of zoomCases) {
    const b = boxSize(frameGray(c.n, zoomOutput));
    const expected = 20 * c.z;
    assert.ok(b && Math.abs(b.w - expected) <= 2 && Math.abs(b.cx - W / 2) <= 1 && Math.abs(b.cy - H / 2) <= 1, `${c.what} at frame ${c.n}: box ${JSON.stringify(b)} vs ${expected.toFixed(1)} px centred`);
    console.log(`PASS ${c.what} at ${(c.n / FPS).toFixed(2)}s: box ${b.w}px (preview ${expected.toFixed(1)}px), centred at (${b.cx}, ${b.cy})`);
}
const overlayZoom = [{ t: 0, v: 2, ease: 'ease-in-out' }, { t: 1, v: 0.5, ease: 'linear' }];
const overlayOutput = await renderTimeline({ ...config, duration: 1.5, main: [], text: [], overlays: [{ ...base, source: 'kf-box', sourceStart: 0, sourceEnd: 1.5, timelineStart: 0, transform: { scaleStart: 1, scaleEnd: 1, x: 0, y: 0 }, keyframes: { scale: overlayZoom } }] }, 'kf-owner');
for (const n of [0, 12, 24, 36]) {
    const b = boxSize(frameGray(n, overlayOutput));
    const expected = 20 * evaluateTrack(overlayZoom, n / FPS);
    assert.ok(b && Math.abs(b.w - expected) <= 2 && Math.abs(b.cx - W / 2) <= 1 && Math.abs(b.cy - H / 2) <= 1, `overlay scale at frame ${n}: ${JSON.stringify(b)} vs ${expected.toFixed(1)}`);
    console.log(`PASS overlay scale keyframes at ${(n / FPS).toFixed(2)}s: box ${b.w}px (preview ${expected.toFixed(1)}px), centred`);
}
console.log('Keyframe export checks passed.');
process.exit(0);
