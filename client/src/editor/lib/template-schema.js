/**
 * Kengan template JSON (schema "kengan.template/1"): validation, normalisation and resolution.
 * Pure functions (browser and Node). A template describes WHAT to build; lib/template-build.ts
 * turns a resolved template plus the user's media into timeline tracks.
 *
 * {
 *   schema: 'kengan.template/1', id, name, description?, category?, tags?: string[],
 *   canvas: { ratio: '9:16'|'1:1'|'16:9', fps?: 24|25|30|60, background?: '#rrggbb' },
 *   timing: { unit: 'seconds'|'beats', bpm?: number },   // beats: lengths count music beats
 *   slots: [{ id, label, accepts?: ['video','image'], length, speed?, sourcePosition?: 0..1,
 *             fit?: 'fill'|'fit', camera?: CameraMotion, transitionIn?: { type, duration, ease? },
 *             effects?: [{ type, amount }], keyframes?: Keyframes, color?: { look?, intensity? } }],
 *             // keyframe times: seconds from the slot start; scale values relative to the fit (1 = fills)
 *   texts: [{ id, label?, content, start, length, slot?: slotId (times relative to it),
 *             style?: { fontSize, fontFamily, fontWeight, color, backgroundColor, x, y, textAlign },
 *             motion?: captionMotionId, keyframes?: Keyframes }],
 *   music: null | { source: 'user'|'library', query?: { genre, vocals }, volume, originalVolume,
 *                   startAt?: seconds into the song, beatSync?: boolean },
 *   params: [{ id, type: 'text'|'color'|'number'|'choice', label, default, min?, max?,
 *              options?: string[], targets: string[] }],   // targets: 'texts.<id>.content',
 *                                                          // 'texts.<id>.style.color', 'music.volume', 'pace'
 * }
 * Times are seconds, or beats when timing.unit is 'beats' (text start/length too). Unknown fields
 * are dropped; out-of-range numbers are clamped; anything that cannot be repaired is an error.
 */
import { normalizeKeyframes } from './keyframes.js';

export const TEMPLATE_SCHEMA = 'kengan.template/1';
export const RATIOS = ['9:16', '1:1', '16:9'];
export const LIMITS = { slots: 40, texts: 40, params: 30, seconds: 180, beats: 512, text: 200 };
const PARAM_TYPES = ['text', 'color', 'number', 'choice'];
export const CAMERA = ['none', 'zoom-in', 'zoom-out', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'tilt-up', 'tilt-down', 'diagonal-rise', 'diagonal-fall', 'detail-approach', 'detail-release'];
const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9][a-z0-9-_]{0,47}$/i;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v, max = LIMITS.text) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * Validates and normalises a template object (or JSON string).
 * @param {{ transitions?: string[], effects?: string[], motions?: string[], looks?: string[] }} known
 *   ids the editor supports; unknown ones are errors (so a template never silently loses a look).
 * @returns {{ ok: boolean, errors: string[], warnings: string[], template: object|null }}
 */
export function validateTemplate(input, known = {}) {
    const errors = [];
    const warnings = [];
    let raw = input;
    if (typeof input === 'string') {
        try {
            raw = JSON.parse(input);
        } catch (e) {
            return { ok: false, errors: [`Not valid JSON: ${e.message}`], warnings, template: null };
        }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['A template must be a JSON object.'], warnings, template: null };
    if (raw.schema !== TEMPLATE_SCHEMA) errors.push(`schema must be "${TEMPLATE_SCHEMA}".`);
    const id = str(raw.id, 48);
    if (!ID.test(id)) errors.push('id must be 1–48 letters, digits, "-" or "_".');
    const name = str(raw.name, 60).trim();
    if (!name) errors.push('name is required.');

    const canvasRaw = raw.canvas || {};
    const ratio = RATIOS.includes(canvasRaw.ratio) ? canvasRaw.ratio : null;
    if (!ratio) errors.push(`canvas.ratio must be one of ${RATIOS.join(', ')}.`);
    const fps = [24, 25, 30, 60].includes(canvasRaw.fps) ? canvasRaw.fps : 30;
    const background = HEX.test(canvasRaw.background || '') ? canvasRaw.background.toLowerCase() : '#000000';

    const unit = raw.timing?.unit === 'beats' ? 'beats' : 'seconds';
    const bpm = clamp(num(raw.timing?.bpm, 120), 40, 220);
    const maxTime = unit === 'beats' ? LIMITS.beats : LIMITS.seconds;
    const minLength = unit === 'beats' ? 0.5 : 0.2;

    const isKnown = (list, value) => !list || list.includes(value);
    const slotIds = new Set();
    const slotsRaw = Array.isArray(raw.slots) ? raw.slots : [];
    if (!slotsRaw.length) errors.push('slots must list at least one media placeholder.');
    if (slotsRaw.length > LIMITS.slots) errors.push(`At most ${LIMITS.slots} slots.`);
    const slots = slotsRaw.slice(0, LIMITS.slots).map((s, i) => {
        const where = `slots[${i}]`;
        const sid = ID.test(s?.id || '') ? s.id : `slot-${i + 1}`;
        if (slotIds.has(sid)) errors.push(`${where}.id "${sid}" is used twice.`);
        slotIds.add(sid);
        const length = num(s?.length, NaN);
        if (!(length >= minLength && length <= maxTime)) errors.push(`${where}.length must be ${minLength}–${maxTime} ${unit}.`);
        const accepts = Array.isArray(s?.accepts) ? s.accepts.filter((a) => a === 'video' || a === 'image') : ['video', 'image'];
        const slot = {
            id: sid,
            label: str(s?.label, 40).trim() || `Shot ${i + 1}`,
            accepts: accepts.length ? accepts : ['video', 'image'],
            length: Number.isFinite(length) ? clamp(length, minLength, maxTime) : 1,
            speed: clamp(num(s?.speed, 1), 0.25, 4),
            sourcePosition: s?.sourcePosition === undefined ? null : clamp(num(s.sourcePosition, 0), 0, 1),
            fit: s?.fit === 'fit' ? 'fit' : 'fill',
            camera: CAMERA.includes(s?.camera) ? s.camera : 'none',
            transitionIn: null,
            effects: [],
            keyframes: normalizeKeyframes(s?.keyframes, 'media') || null,
            color: null,
        };
        if (s?.camera && !CAMERA.includes(s.camera)) warnings.push(`${where}.camera "${s.camera}" is not supported; using none.`);
        if (s?.transitionIn && i > 0) {
            const type = s.transitionIn.type;
            if (typeof type !== 'string' || !isKnown(known.transitions, type)) errors.push(`${where}.transitionIn.type "${type}" is not a known transition.`);
            else slot.transitionIn = { type, duration: clamp(num(s.transitionIn.duration, 0.4), 0.1, 2) };
        } else if (s?.transitionIn && i === 0) warnings.push(`${where}.transitionIn ignored: the first shot has no cut before it.`);
        if (Array.isArray(s?.effects))
            slot.effects = s.effects.slice(0, 8).flatMap((e, j) => {
                if (typeof e?.type !== 'string' || !isKnown(known.effects, e.type)) {
                    errors.push(`${where}.effects[${j}].type "${e?.type}" is not a known effect.`);
                    return [];
                }
                return [{ type: e.type, amount: clamp(num(e.amount, 0.5), 0, 1) }];
            });
        if (s?.color && typeof s.color === 'object') {
            const look = s.color.look ?? null;
            if (look !== null && !isKnown(known.looks, look)) errors.push(`${where}.color.look "${look}" is not a known look.`);
            else slot.color = { look, intensity: clamp(num(s.color.intensity, 1), 0, 1) };
        }
        return slot;
    });

    const textIds = new Set();
    const textsRaw = Array.isArray(raw.texts) ? raw.texts : [];
    if (textsRaw.length > LIMITS.texts) errors.push(`At most ${LIMITS.texts} texts.`);
    const texts = textsRaw.slice(0, LIMITS.texts).map((t, i) => {
        const where = `texts[${i}]`;
        const tid = ID.test(t?.id || '') ? t.id : `text-${i + 1}`;
        if (textIds.has(tid)) errors.push(`${where}.id "${tid}" is used twice.`);
        textIds.add(tid);
        const slot = t?.slot === undefined || t?.slot === null ? null : String(t.slot);
        if (slot !== null && !slotIds.has(slot)) errors.push(`${where}.slot "${slot}" is not a slot id.`);
        const length = num(t?.length, NaN);
        if (!(length > 0 && length <= maxTime)) errors.push(`${where}.length must be above 0 and at most ${maxTime} ${unit}.`);
        if (t?.motion && !isKnown(known.motions, t.motion)) errors.push(`${where}.motion "${t.motion}" is not a known text motion.`);
        const st = t?.style || {};
        return {
            id: tid,
            label: str(t?.label, 40).trim() || `Text ${i + 1}`,
            content: str(t?.content),
            slot,
            start: clamp(num(t?.start, 0), 0, maxTime),
            length: Number.isFinite(length) ? clamp(length, 0.05, maxTime) : 1,
            style: {
                fontSize: clamp(num(st.fontSize, 64), 12, 300),
                fontFamily: str(st.fontFamily, 40) || 'Poppins',
                fontWeight: st.fontWeight === 'normal' ? 'normal' : 'bold',
                color: HEX.test(st.color || '') ? st.color.toLowerCase() : '#ffffff',
                backgroundColor: st.backgroundColor === 'transparent' || /^rgba?\([\d\s.,]+\)$/.test(st.backgroundColor || '') || HEX.test(st.backgroundColor || '') ? st.backgroundColor : 'transparent',
                x: clamp(num(st.x, 0), -2000, 2000),
                y: clamp(num(st.y, 0), -2000, 2000),
                textAlign: ['left', 'right'].includes(st.textAlign) ? st.textAlign : 'center',
            },
            motion: t?.motion && isKnown(known.motions, t.motion) ? t.motion : null,
            keyframes: normalizeKeyframes(t?.keyframes, 'text') || null,
        };
    });

    let music = null;
    if (raw.music && typeof raw.music === 'object') {
        const m = raw.music;
        if (m.source !== 'user' && m.source !== 'library') errors.push('music.source must be "user" or "library".');
        music = {
            source: m.source === 'library' ? 'library' : 'user',
            query: m.source === 'library' ? { genre: str(m.query?.genre, 30) || 'pop', vocals: ['any', 'instrumental', 'vocals'].includes(m.query?.vocals) ? m.query.vocals : 'any' } : null,
            volume: clamp(num(m.volume, 0.8), 0, 2),
            originalVolume: clamp(num(m.originalVolume, 0), 0, 2),
            startAt: clamp(num(m.startAt, 0), 0, 600),
            beatSync: m.beatSync !== false,
        };
    }
    if (unit === 'beats' && !music) warnings.push('timing.unit is "beats" but there is no music: the reference bpm is used.');

    const paramIds = new Set();
    const paramsRaw = Array.isArray(raw.params) ? raw.params : [];
    if (paramsRaw.length > LIMITS.params) errors.push(`At most ${LIMITS.params} params.`);
    const params = paramsRaw.slice(0, LIMITS.params).flatMap((p, i) => {
        const where = `params[${i}]`;
        if (!ID.test(p?.id || '') || paramIds.has(p.id)) {
            errors.push(`${where}.id must be a unique id.`);
            return [];
        }
        paramIds.add(p.id);
        if (!PARAM_TYPES.includes(p.type)) {
            errors.push(`${where}.type must be one of ${PARAM_TYPES.join(', ')}.`);
            return [];
        }
        const targets = (Array.isArray(p.targets) ? p.targets : []).filter((target) => {
            const ok = targetValid(target, p.type, textIds, !!music);
            if (!ok) errors.push(`${where}: target "${target}" does not exist or does not fit a ${p.type}.`);
            return ok;
        });
        if (!targets.length) errors.push(`${where} needs at least one target.`);
        const param = { id: p.id, type: p.type, label: str(p.label, 40).trim() || p.id, targets };
        if (p.type === 'number') {
            param.min = num(p.min, 0);
            param.max = num(p.max, 1);
            param.default = clamp(num(p.default, param.min), param.min, param.max);
        } else if (p.type === 'color') param.default = HEX.test(p.default || '') ? p.default.toLowerCase() : '#ffffff';
        else if (p.type === 'choice') {
            param.options = (Array.isArray(p.options) ? p.options : []).map((o) => str(o, 40)).filter(Boolean).slice(0, 12);
            if (!param.options.length) errors.push(`${where}.options must list the choices.`);
            param.default = param.options.includes(p.default) ? p.default : param.options[0];
        } else param.default = str(p.default);
        return [param];
    });

    const template = {
        schema: TEMPLATE_SCHEMA,
        id,
        name,
        description: str(raw.description, 300),
        category: str(raw.category, 30) || 'custom',
        tags: (Array.isArray(raw.tags) ? raw.tags : []).map((t) => str(t, 24)).filter(Boolean).slice(0, 10),
        canvas: { ratio, fps, background },
        timing: { unit, bpm },
        slots,
        texts,
        music,
        params,
    };
    return { ok: errors.length === 0, errors, warnings, template: errors.length ? null : template };
}

function targetValid(target, type, textIds, hasMusic) {
    if (typeof target !== 'string') return false;
    if (target === 'pace') return type === 'number';
    if (target === 'music.volume') return type === 'number' && hasMusic;
    const m = /^texts\.([^.]+)\.(content|style\.color|style\.backgroundColor|style\.fontFamily)$/.exec(target);
    if (!m || !textIds.has(m[1])) return false;
    if (m[2] === 'content') return type === 'text' || type === 'choice';
    if (m[2] === 'style.fontFamily') return type === 'choice' || type === 'text';
    return type === 'color';
}

/** Applies param values (defaults where missing) to a validated template. Returns a new template and the pace. */
export function applyParams(template, values = {}) {
    const t = JSON.parse(JSON.stringify(template));
    let pace = 1;
    for (const p of t.params) {
        let v = values[p.id] ?? p.default;
        if (p.type === 'number') v = clamp(num(Number(v), p.default), p.min, p.max);
        if (p.type === 'color' && !HEX.test(v)) v = p.default;
        if (p.type === 'choice' && !p.options.includes(v)) v = p.default;
        if (p.type === 'text') v = str(String(v));
        for (const target of p.targets) {
            if (target === 'pace') pace = clamp(v, 0.5, 2);
            else if (target === 'music.volume' && t.music) t.music.volume = clamp(v, 0, 2);
            else {
                const [, tid, path] = /^texts\.([^.]+)\.(.+)$/.exec(target);
                const text = t.texts.find((x) => x.id === tid);
                if (path === 'content') text.content = v;
                else text.style[path.slice('style.'.length)] = v;
            }
        }
    }
    return { template: t, pace };
}

/**
 * Seconds for every slot and text. In beat timing, slot boundaries are placed ON the given beats
 * (timeline seconds, sorted; e.g. the chosen song's beats after its startAt), so cuts land on the
 * music even when its tempo drifts; without beats the reference bpm is used. `pace` (0.5–2)
 * speeds the template up (seconds timing only; beat timing follows the music).
 * @param {any} template
 * @param {{ beats?: number[] | null, pace?: number }} [options]
 * @returns {{ slots: {id: string, start: number, length: number}[], texts: {id: string, start: number, length: number}[], duration: number, beatTimes: number[] }}
 */
export function resolveTiming(template, { beats = null, pace = 1 } = {}) {
    const unit = template.timing.unit;
    let toTime;
    let beatTimes = [];
    if (unit === 'beats') {
        const period = 60 / template.timing.bpm;
        const grid = beats && beats.length > 1 ? beats : null;
        const first = grid ? grid[0] : 0;
        const avg = grid ? (grid[grid.length - 1] - grid[0]) / (grid.length - 1) : period;
        // Beat position b (0 = first beat) → seconds, interpolating the real beats (extrapolating past them).
        toTime = (b) => {
            if (!grid) return b * period;
            const i = Math.floor(b);
            const f = b - i;
            const at = (k) => (k < grid.length ? grid[k] - first : grid[grid.length - 1] - first + (k - grid.length + 1) * avg);
            return at(i) + (at(i + 1) - at(i)) * f;
        };
        beatTimes = grid ? grid.map((b) => b - first) : [];
    } else {
        const k = 1 / clamp(pace, 0.5, 2);
        toTime = (s) => s * k;
    }
    const round = (v) => Math.round(v * 1000) / 1000;
    const slots = [];
    let cursor = 0;
    for (const s of template.slots) {
        const start = round(toTime(cursor));
        const end = round(toTime(cursor + s.length));
        slots.push({ id: s.id, start, length: round(end - start) });
        cursor += s.length;
    }
    const duration = slots.length ? round(slots[slots.length - 1].start + slots[slots.length - 1].length) : 0;
    const slotStartUnits = {};
    let acc = 0;
    for (const s of template.slots) {
        slotStartUnits[s.id] = acc;
        acc += s.length;
    }
    const texts = template.texts.map((t) => {
        const base = t.slot ? slotStartUnits[t.slot] : 0;
        const start = Math.min(duration, round(toTime(base + t.start)));
        const end = Math.min(duration, round(toTime(base + t.start + t.length)));
        return { id: t.id, start, length: round(Math.max(0.05, end - start)) };
    });
    return { slots, texts, duration, beatTimes };
}
