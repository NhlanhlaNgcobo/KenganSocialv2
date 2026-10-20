// Run from the repository root: node scripts/check-editor-motion.mjs
// Exercises the actual FFmpeg graphs, not just catalogue membership.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { TREND_TRANSITIONS, TREND_XFADE, trendTransitionStyles } from '../server/src/services/trend-transitions.js';
import { TREND_EFFECTS } from '../server/src/services/trend-effects.js';
import { effectFilters, normalizeEffects, normalizeTransition } from '../server/src/services/timeline-fx.js';
import { CAPTION_MOTIONS, TEXT_ANIMATIONS, captionFrame } from '../server/src/services/caption-motion.js';
import { buildTextAss } from '../server/src/services/timeline-text-ass.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kengan-motion-'));
let count = 0;
function render(name, inputs, graph) {
    const result = spawnSync(ffmpeg, ['-v', 'error', '-y', '-filter_complex_threads', '1', ...inputs, '-filter_complex', graph, '-map', '[out]', '-an', '-frames:v', '30', '-f', 'null', '-'], { encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, `${name}: ${result.error || result.stderr}`);
    console.log(`PASS ${name}`);
    count++;
}
const inputs = ['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30:duration=1.4'];
assert.equal(TREND_TRANSITIONS.length, 10);
assert.equal(TREND_EFFECTS.length, 10);
assert.equal(CAPTION_MOTIONS.length, 10);
assert.equal(normalizeTransition({ type: 'toString' }), null);
assert.deepEqual(normalizeEffects([{ type: 'ks-impact-shake', amount: 0.5, enabled: false }]), []);
for (const transition of TREND_TRANSITIONS) {
    assert.ok(normalizeTransition({ type: transition.type, duration: 0.4 }));
    assert.equal(trendTransitionStyles(transition.type, 0).b.opacity, 0);
    assert.equal(trendTransitionStyles(transition.type, 1).b.opacity, 1);
    render(transition.label, [...inputs, '-f', 'lavfi', '-i', 'smptebars=size=160x90:rate=30:duration=1.4'],
        `[0:v][1:v]xfade=transition=${TREND_XFADE[transition.type]}:duration=0.4:offset=0.3[out]`);
}
for (const effect of TREND_EFFECTS) {
    const effects = normalizeEffects([{ type: effect.type, amount: 0.7 }]);
    assert.equal(effects.length, 1);
    render(effect.label, inputs, `[0:v]null${effectFilters(effects, 160, 90, 30)}[out]`);
    assert.equal(effectFilters([{ type: effect.type, amount: 0 }], 160, 90), '');
}
render('Stacked split effects', inputs, `[0:v]null${effectFilters(TREND_EFFECTS.filter((e) => ['ks-halation', 'ks-split-diopter', 'ks-prism-edge'].includes(e.type)).map((e) => ({ type: e.type, amount: 0.4 })), 160, 90)}[out]`);
const words = [{ text: 'Make', start: 0, end: 0.3 }, { text: 'it', start: 0.3, end: 0.5 }, { text: 'count', start: 0.5, end: 1 }];
assert.equal(TEXT_ANIMATIONS.length, 10);
for (const motion of [...CAPTION_MOTIONS, ...TEXT_ANIMATIONS.map((a) => a.id)]) {
    const sample = captionFrame('Make it count', words, motion, 0.4, 1);
    assert.equal(sample.chunks.length, motion === 'title-type' ? 1 : 3);
    assert.ok(Number.isFinite(sample.scale));
    const text = buildTextAss([{
        content: 'Make it count', timelineStart: 0, timelineEnd: 1, fontSize: 18, fontFamily: 'Arial',
        color: { hex: 'ffffff', alpha: 1 }, accentColor: { hex: 'a3e635', alpha: 1 },
        background: { hex: '000000', alpha: 0 }, stroke: { width: 1, color: { hex: '000000', alpha: 1 } },
        opacity: 1, bold: true, align: 'center', x: 0, y: 10, animation: 'none', rotation: 0,
        captionMotion: motion, captionWords: words, captionDuration: 1, captionOffset: 0,
    }], 160, 90);
    const filename = path.join(directory, `${motion}.ass`);
    fs.writeFileSync(filename, text);
    const escaped = filename.replaceAll('\\', '/').replace(':', '\\:');
    render(motion, inputs, `[0:v]subtitles=filename='${escaped}'[out]`);
}
assert.equal(captionFrame('Make it count', words, 'underline-flow', 0.4, 1).chunks[1].underline, true);
assert.equal(captionFrame('Make it count', words, 'quiet-reveal', 0.1, 1).chunks[2].opacity, 0);
console.log(`${count} render checks passed. Caption fixtures: ${directory}`);
