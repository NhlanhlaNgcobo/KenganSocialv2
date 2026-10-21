// Run from the repository root: node scripts/check-templates.mjs
// Template JSON schema: validation (errors and repairs), params, and timing in seconds and beats.
// Also validates every built-in template file in client/src/editor/templates/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyParams, resolveTiming, TEMPLATE_SCHEMA, validateTemplate } from '../client/src/editor/lib/template-schema.js';
import { TRANSITIONS_IDS, EFFECT_IDS, MOTION_IDS, LOOK_IDS } from './template-known.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const known = { transitions: TRANSITIONS_IDS, effects: EFFECT_IDS, motions: MOTION_IDS, looks: LOOK_IDS };

const base = {
    schema: TEMPLATE_SCHEMA,
    id: 'test-template',
    name: 'Test',
    canvas: { ratio: '9:16', fps: 30 },
    timing: { unit: 'seconds' },
    slots: [
        { id: 'a', label: 'Open', length: 2, camera: 'zoom-in' },
        { id: 'b', label: 'Middle', length: 3, transitionIn: { type: 'flash', duration: 0.3 }, effects: [{ type: 'shake', amount: 0.4 }] },
    ],
    texts: [{ id: 'title', content: 'Hello', slot: 'b', start: 0.5, length: 1, style: { color: '#FFCC00' }, motion: MOTION_IDS[0] }],
    music: { source: 'user', volume: 0.7, originalVolume: 0 },
    params: [
        { id: 'headline', type: 'text', label: 'Headline', default: 'Hello', targets: ['texts.title.content'] },
        { id: 'accent', type: 'color', label: 'Accent', default: '#ff0000', targets: ['texts.title.style.color'] },
        { id: 'vol', type: 'number', label: 'Music', min: 0, max: 1, default: 0.7, targets: ['music.volume'] },
        { id: 'pace', type: 'number', label: 'Pace', min: 0.5, max: 2, default: 1, targets: ['pace'] },
    ],
};

// Valid template, normalised.
{
    const r = validateTemplate(base, known);
    assert.ok(r.ok, r.errors.join('\n'));
    const t = r.template;
    assert.equal(t.canvas.background, '#000000');
    assert.equal(t.slots[0].transitionIn, null);
    assert.deepEqual(t.slots[1].transitionIn, { type: 'flash', duration: 0.3 });
    assert.equal(t.texts[0].style.color, '#ffcc00');
    assert.equal(t.texts[0].style.fontFamily, 'Poppins');
    assert.equal(validateTemplate(JSON.stringify(base), known).ok, true);
    console.log('PASS valid template accepted and normalised (defaults filled, colours lower-cased)');
}

// Errors are specific.
const expectError = (mutate, pattern, label) => {
    const t = JSON.parse(JSON.stringify(base));
    mutate(t);
    const r = validateTemplate(t, known);
    assert.equal(r.ok, false, `${label}: should fail`);
    assert.ok(r.errors.some((e) => pattern.test(e)), `${label}: errors were ${JSON.stringify(r.errors)}`);
    console.log(`PASS rejects ${label}: "${r.errors.find((e) => pattern.test(e))}"`);
};
expectError((t) => (t.schema = 'other/2'), /schema must be/, 'wrong schema');
expectError((t) => (t.canvas.ratio = '2:1'), /canvas.ratio/, 'unknown ratio');
expectError((t) => (t.slots = []), /at least one/, 'no slots');
expectError((t) => (t.slots[1].transitionIn.type = 'made-up'), /not a known transition/, 'unknown transition');
expectError((t) => (t.slots[1].effects[0].type = 'nope'), /not a known effect/, 'unknown effect');
expectError((t) => (t.slots[0].length = 0), /length must be/, 'zero-length slot');
expectError((t) => (t.slots[1].id = 'a'), /used twice/, 'duplicate slot id');
expectError((t) => (t.texts[0].slot = 'zzz'), /not a slot id/, 'text anchored to a missing slot');
expectError((t) => (t.params[0].targets = ['texts.nope.content']), /does not exist/, 'param target to a missing text');
expectError((t) => (t.params[1].targets = ['texts.title.content']), /does not fit/, 'colour param on text content');
expectError((t) => (t.music = null), /music.volume|does not exist/, 'music param without music');
assert.equal(validateTemplate('{oops', known).ok, false);
assert.equal(validateTemplate([], known).ok, false);
console.log('PASS rejects invalid JSON and non-objects');

// Repairs: out-of-range values clamp, unknown camera falls back with a warning.
{
    const t = JSON.parse(JSON.stringify(base));
    t.slots[0].speed = 99;
    t.slots[0].camera = 'barrel-roll';
    t.texts[0].style.fontSize = 9999;
    const r = validateTemplate(t, known);
    assert.ok(r.ok);
    assert.equal(r.template.slots[0].speed, 4);
    assert.equal(r.template.slots[0].camera, 'none');
    assert.equal(r.template.texts[0].style.fontSize, 300);
    assert.ok(r.warnings.some((w) => /camera/.test(w)));
    console.log('PASS clamps out-of-range numbers and warns on unsupported camera moves');
}

// Params.
{
    const t = validateTemplate(base, known).template;
    const { template, pace } = applyParams(t, { headline: 'New title', accent: '#00ff00', vol: 5, pace: 1.5 });
    assert.equal(template.texts[0].content, 'New title');
    assert.equal(template.texts[0].style.color, '#00ff00');
    assert.equal(template.music.volume, 1);
    assert.equal(pace, 1.5);
    assert.equal(t.texts[0].content, 'Hello', 'original untouched');
    const defaults = applyParams(t, { accent: 'not-a-colour' });
    assert.equal(defaults.template.texts[0].style.color, '#ff0000');
    console.log('PASS params set text, colour, music volume and pace (invalid values fall back to defaults)');
}

// Timing in seconds (with pace) and texts relative to their slot.
{
    const t = validateTemplate(base, known).template;
    const r = resolveTiming(t, { pace: 2 });
    assert.deepEqual(r.slots, [{ id: 'a', start: 0, length: 1 }, { id: 'b', start: 1, length: 1.5 }]);
    assert.deepEqual(r.texts, [{ id: 'title', start: 1.25, length: 0.5 }]);
    assert.equal(r.duration, 2.5);
    console.log('PASS seconds timing: pace 2 halves every length; slot-relative text starts with its slot');
}

// Timing in beats: reference bpm without music, real (drifting) beats with music.
{
    const t = validateTemplate({ ...base, timing: { unit: 'beats', bpm: 120 }, slots: [{ id: 'a', length: 4 }, { id: 'b', length: 2 }, { id: 'c', length: 2 }], texts: [], params: [] }, known).template;
    const ref = resolveTiming(t);
    assert.deepEqual(ref.slots.map((s) => [s.start, s.length]), [[0, 2], [2, 1], [3, 1]]);
    // A live recording: beats drift from 0.50 s to 0.53 s apart and start at 0.4 s into the song.
    const beats = [];
    for (let i = 0, at = 0.4; i < 12; i += 1, at += 0.5 + i * 0.003) beats.push(Math.round(at * 1000) / 1000);
    const live = resolveTiming(t, { beats });
    const cuts = live.slots.map((s) => s.start + beats[0]);
    assert.ok(Math.abs(cuts[1] - beats[4]) < 1e-9 && Math.abs(cuts[2] - beats[6]) < 1e-9, `cuts ${cuts} vs beats ${beats}`);
    const end = live.duration + beats[0];
    assert.ok(Math.abs(end - beats[8]) < 1e-9);
    console.log(`PASS beats timing: cuts land exactly on the music's beats even when the tempo drifts (${cuts.map((c) => c.toFixed(3)).join(', ')})`);
}

// Built-in template files.
const dir = path.join(root, 'client/src/editor/templates');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
for (const f of files) {
    const r = validateTemplate(fs.readFileSync(path.join(dir, f), 'utf8'), known);
    assert.ok(r.ok, `${f}: ${r.errors.join('; ')}`);
    assert.equal(r.warnings.length, 0, `${f}: ${r.warnings.join('; ')}`);
    console.log(`PASS built-in ${f}: ${r.template.slots.length} slots, ${r.template.texts.length} texts, ${r.template.timing.unit}`);
}
console.log('Template checks passed.');
