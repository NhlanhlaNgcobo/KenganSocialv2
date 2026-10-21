// Run from the repository root: node scripts/check-exact-preview.mjs
// Exact preview renders only a range of the timeline. Every frame of a range render must match the
// same frame of the full export (moving test pattern, so a one-frame slip shows), including a range
// across a transition and one that starts partway into a clip with keyframes, shake and overlays.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { storeUpload } from '../server/src/services/manual-edit.service.js';
import { EXPORT_PRESETS, renderTimeline } from '../server/src/services/timeline-render.service.js';

const W = 320;
const H = 568;
const FPS = 30;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kengan-exact-'));
const ff = (args) => {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
};
const pattern = path.join(dir, 'pattern.mp4');
ff(['-f', 'lavfi', '-i', `testsrc2=s=640x360:r=${FPS}:d=12`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=12', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', pattern]);
const still = path.join(dir, 'still.png');
ff(['-f', 'lavfi', '-i', 'testsrc=s=400x400:d=1', '-frames:v', '1', still]);
storeUpload('ep-pattern', pattern, 'ep-owner');
storeUpload('ep-still', still, 'ep-owner');
EXPORT_PRESETS.eptest = { width: W, height: H };

const base = { speed: 1, volume: 1, filter: 'none' };
const config = {
    version: 2,
    exportFormat: 'eptest',
    fps: FPS,
    backgroundColor: '#101010',
    duration: 10,
    main: [
        { ...base, kind: 'video', source: 'ep-pattern', sourceStart: 1, sourceEnd: 5, timelineStart: 0, transform: { scaleStart: 1, scaleEnd: 1.2, x: 0, y: 0 } },
        { ...base, kind: 'image', source: 'ep-still', sourceStart: 0, sourceEnd: 2, timelineStart: 4, timelineEnd: 6, transform: { scaleStart: 1.1, scaleEnd: 1, x: 0, y: 0 } },
        {
            ...base,
            kind: 'video',
            source: 'ep-pattern',
            sourceStart: 5,
            sourceEnd: 9,
            timelineStart: 6,
            transitionIn: { type: 'fade', duration: 0.6 },
            effects: [{ type: 'shake', amount: 0.5 }],
            keyframes: { x: [{ t: 0, v: -40, ease: 'ease-in-out' }, { t: 4, v: 40, ease: 'linear' }], opacity: [{ t: 2.5, v: 1, ease: 'ease-in' }, { t: 4, v: 0.4, ease: 'linear' }] },
        },
    ],
    overlays: [{ ...base, kind: 'video', source: 'ep-pattern', sourceStart: 0, sourceEnd: 6, timelineStart: 2, volume: 0, transform: { scaleStart: 0.35, scaleEnd: 0.35, x: 60, y: -150 }, keyframes: { opacity: [{ t: 0, v: 0.2 }, { t: 6, v: 1 }], rotation: [{ t: 0, v: 0 }, { t: 6, v: 30 }] } }],
    audio: [],
    text: [{ content: 'Exact', timelineStart: 1, timelineEnd: 9, fontSize: 40, fontFamily: 'Arial', bold: true, color: '#ffffff', backgroundColor: 'transparent', x: 0, y: 200, opacity: 1, keyframes: { y: [{ t: 0, v: 240 }, { t: 8, v: 160 }] } }],
};

const t0 = Date.now();
const full = await renderTimeline(config, 'ep-owner');
const fullSeconds = (Date.now() - t0) / 1000;
console.log(`PASS full export (${fullSeconds.toFixed(1)}s)`);

function frames(file, from, count) {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select='between(n\\,${from}\\,${from + count - 1})',format=gray`, '-vsync', '0', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
    assert.equal(r.status, 0, String(r.stderr));
    const size = W * H;
    return Array.from({ length: Math.floor(r.stdout.length / size) }, (_, i) => r.stdout.subarray(i * size, (i + 1) * size));
}
const mad = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]);
    return s / a.length;
};

for (const [start, end, label] of [
    [0.5, 2, 'inside the first clip (camera zoom)'],
    [3.5, 5, 'across the clip-to-photo cut'],
    [5.5, 7.5, 'across the fade transition'],
    [8.2, 9.6, 'starting 2.2 s into a clip (keyframes, shake, overlay opacity)'],
]) {
    const t1 = Date.now();
    const part = await renderTimeline({ ...config, range: { start, end } }, 'ep-owner');
    const seconds = (Date.now() - t1) / 1000;
    const len = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', part]).stdout.toString());
    const count = Math.round((end - start) * FPS);
    const a = frames(part, 0, count);
    const b = frames(full, Math.round(start * FPS), count);
    assert.equal(a.length, count, `${label}: ${a.length} frames, expected ${count}`);
    const diffs = a.map((f, i) => mad(f, b[i]));
    const worst = Math.max(...diffs);
    const average = diffs.reduce((x, y) => x + y, 0) / diffs.length;
    // The same frame encoded in two files differs by encoder noise only (≈0.5–4 on detailed, zooming
    // frames); the whole window shifted by one frame of the moving pattern differs far more.
    // On frames where the picture moves (the next full-export frame differs clearly), each range
    // frame must be much closer to its own frame than to the next one: a one-frame slip would fail.
    const slipped = frames(full, Math.round(start * FPS) + 1, count);
    const moving = a.map((f, i) => ({ own: diffs[i], next: mad(f, slipped[i] || f), motion: mad(b[i], slipped[i] || b[i]) })).filter((x) => x.motion > 1.2); // above encoder noise (≈0.4–0.9)
    // A one-frame slip makes a range frame match the NEXT full frame, so every moving frame must be
    // closer to its own frame than to the next one.
    const slipFail = moving.filter((x) => x.own >= x.next);
    // Local errors (a misplaced title or overlay) show as whole areas far off. Compared on 4×4-pixel
    // averages: encoder noise on the pattern's hard edges (which differs with frame type) averages out.
    const cells = (f) => {
        const out = [];
        for (let y = 0; y + 4 <= H; y += 4)
            for (let x = 0; x + 4 <= W; x += 4) {
                let sum = 0;
                for (let dy = 0; dy < 4; dy += 1) for (let dx = 0; dx < 4; dx += 1) sum += f[(y + dy) * W + x + dx];
                out.push(sum / 16);
            }
        return out;
    };
    const farCells = a.map((f, i) => {
        const ca = cells(f);
        const cb = cells(b[i]);
        return ca.reduce((n, v, k) => n + (Math.abs(v - cb[k]) > 25 ? 1 : 0), 0);
    });
    if (process.env.EP_DEBUG) {
        const k = farCells.indexOf(Math.max(...farCells));
        const save = (buf, name) => spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${W}x${H}`, '-i', '-', '-vf', 'tile=3x1', '-frames:v', '1', name], { input: buf });
        const diff = Buffer.from(a[k].map((v, j) => Math.min(255, Math.abs(v - b[k][j]) * 4)));
        save(Buffer.concat([a[k], b[k], diff]), path.join(process.env.EP_DEBUG, `ep-${label.slice(0, 12).replace(/\W/g, '_')}-${k}.png`));
        console.log('DEBUG', label, 'worst frame', k, 'cells', farCells[k], JSON.stringify(farCells));
        // Title position (rows of bright pixels in the lower area) in each render.
        const top = (f) => { for (let y = 460; y < H; y += 1) { let n = 0; for (let x = 0; x < W; x += 1) if (f[y * W + x] > 200) n += 1; if (n > 8) return y; } return -1; };
        console.log('DEBUG title top row per frame: range', JSON.stringify(a.map(top)), 'full', JSON.stringify(b.map(top)));
    }
    assert.ok(Math.max(...farCells) <= 20, `${label}: up to ${Math.max(...farCells)} 4×4 areas differ by more than 25 levels in one frame`);
    assert.ok(average < 1.5 && worst < 6, `${label}: average ${average.toFixed(2)}, worst ${worst.toFixed(2)}`);
    assert.ok(moving.length >= 5 && slipFail.length === 0, `${label}: ${moving.length} moving frames, ${slipFail.length} closer to the next frame than allowed`);
    const slip = moving.reduce((x, m) => x + m.next, 0) / moving.length;
    console.log(`PASS ${label}: ${count} frames match the full export (average ${average.toFixed(2)}/255, worst ${worst.toFixed(2)}; on ${moving.length} moving frames one frame off would average ${slip.toFixed(2)}), ${len.toFixed(2)}s long, rendered in ${seconds.toFixed(1)}s`);
    fs.rmSync(part, { force: true });
}
fs.rmSync(full, { force: true });
console.log('Exact preview checks passed.');
process.exit(0);
