// Integration test of normalization, source ownership, segment rendering, transitions and ASS composition.
import { CAMERA_MOTIONS, cameraEndpoints } from '../client/src/editor/lib/camera-motion.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { storeUpload } from '../server/src/services/manual-edit.service.js';
import { EXPORT_PRESETS, normalizeTimelineConfig, renderTimeline } from '../server/src/services/timeline-render.service.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kengan-export-check-'));
const source = path.join(dir, 'source.mp4');
const generated = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source], { encoding: 'utf8', timeout: 60000 });
assert.equal(generated.status, 0, generated.stderr);
storeUpload('test-owned-source', source, 'test-owner');
// Small test-only canvas keeps the real rendering pipeline check fast.
EXPORT_PRESETS.test = { width: 160, height: 90 };
const media = { kind: 'video', source: 'test-owned-source', sourceStart: 0, sourceEnd: 1, timelineStart: 0, speed: 1, volume: 0.4, filter: 'none' };
const text = { content: 'Make it count', timelineStart: 0, timelineEnd: 1.5, fontSize: 18, fontFamily: 'Arial', bold: true, color: '#ffffff', backgroundColor: 'transparent', x: 0, y: 20, captionMotion: 'pulse-word', captionDuration: 1.5, captionWords: [{ text: 'Make', start: 0, end: 0.5 }, { text: 'it', start: 0.5, end: 0.8 }, { text: 'count', start: 0.8, end: 1.5 }] };
const config = { version: 2, exportFormat: 'test', fps: 30, duration: 2, main: [
    { ...media, effects: [{ type: 'ks-halation', amount: 0.4 }, { type: 'ks-prism-edge', amount: 0.3 }] },
    { ...media, timelineStart: 1, sourceStart: 1, sourceEnd: 2, transitionIn: { type: 'ks-spin-catch', duration: 0.4 } },
], overlays: [{ ...media, timelineStart: 0.3, sourceEnd: 0.7, volume: 0, transform: { scaleStart: 0.3, scaleEnd: 0.3, x: 40, y: -20 } }], audio: [], text: [text] };
assert.throws(() => normalizeTimelineConfig(config, 'different-owner'), /Source not found/);
assert.throws(() => normalizeTimelineConfig({ ...config, text: [{ ...text, captionDuration: 31 }] }, 'test-owner'), /30 seconds/);
const output = await renderTimeline(config, 'test-owner');
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { encoding: 'utf8' });
assert.equal(probe.status, 0, probe.stderr);
const info = JSON.parse(probe.stdout);
assert.ok(info.streams.some((s) => s.codec_type === 'audio'));
assert.ok(info.streams.some((s) => s.codec_type === 'video' && s.width === 160 && s.height === 90));
assert.ok(Math.abs(Number(info.format.duration) - 2) < 0.15);
console.log(`PASS complete export / overlays / motion captions / audio / ownership / duration: ${output}`);

assert.equal(CAMERA_MOTIONS.length, 10);
const motionConfig = { ...config, duration: 5, overlays: [], audio: [], text: [{ ...text, captionMotion: 'title-bounce' }], main: CAMERA_MOTIONS.map((motion, i) => ({ ...media, sourceEnd: 0.5, timelineStart: i * 0.5, volume: 0, transform: { ...cameraEndpoints({ animation: motion.id, animationAmount: 0.03, x: 0, y: 0, scale: 1.1 }), rotation: 0 } })) };
const motionOutput = await renderTimeline(motionConfig, 'test-owner');
console.log(`PASS all 10 camera motions and animated title through complete export: ${motionOutput}`);
