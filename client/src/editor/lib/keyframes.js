/**
 * Keyframes and easing, shared by the editor preview and the export renderer.
 * THIS FILE IS DUPLICATED at server/src/services/keyframes.js; keep both identical
 * (scripts/check-shared.mjs verifies it).
 *
 * A track is a list of { t, v, ease } sorted by t (seconds from the element's start). `ease`
 * shapes the segment from that keyframe to the next. Every easing exists twice: as a JS function
 * (preview) and as an FFmpeg expression (export), written from the same formula.
 */

export const ANIMATABLE = {
    media: ['x', 'y', 'scale', 'rotation', 'opacity'],
    text: ['x', 'y', 'scale', 'rotation', 'opacity'],
};

/** Value limits per property (export validation clamps to these). */
export const PROPERTY_RANGE = {
    x: [-5000, 5000],
    y: [-5000, 5000],
    scale: [0.05, 8],
    rotation: [-1440, 1440],
    opacity: [0, 1],
};

/**
 * Easing curves. js: p (0..1) → eased 0..1 (may overshoot for back/elastic).
 * ff: FFmpeg expression of the variable named in `p`.
 */
const C1 = 1.70158;
const C3 = C1 + 1;
export const EASINGS = {
    linear: { label: 'Linear', js: (p) => p, ff: (p) => `(${p})` },
    hold: { label: 'Hold', js: (p) => (p >= 1 ? 1 : 0), ff: (p) => `gte(${p},1)` },
    'ease-in': { label: 'Ease in', js: (p) => p * p * p, ff: (p) => `pow(${p},3)` },
    'ease-out': { label: 'Ease out', js: (p) => 1 - Math.pow(1 - p, 3), ff: (p) => `(1-pow(1-${p},3))` },
    'ease-in-out': {
        label: 'Ease in-out',
        js: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
        ff: (p) => `if(lt(${p},0.5),4*pow(${p},3),1-pow(-2*${p}+2,3)/2)`,
    },
    'expo-out': { label: 'Fast out', js: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)), ff: (p) => `if(gte(${p},1),1,1-pow(2,-10*${p}))` },
    'expo-in-out': {
        label: 'Snap',
        js: (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2),
        ff: (p) => `if(lte(${p},0),0,if(gte(${p},1),1,if(lt(${p},0.5),pow(2,20*${p}-10)/2,(2-pow(2,-20*${p}+10))/2)))`,
    },
    'back-out': {
        label: 'Overshoot',
        js: (p) => 1 + C3 * Math.pow(p - 1, 3) + C1 * Math.pow(p - 1, 2),
        ff: (p) => `(1+${C3}*pow(${p}-1,3)+${C1}*pow(${p}-1,2))`,
    },
    'back-in': { label: 'Anticipate', js: (p) => C3 * p * p * p - C1 * p * p, ff: (p) => `(${C3}*pow(${p},3)-${C1}*pow(${p},2))` },
    'elastic-out': {
        label: 'Elastic',
        js: (p) => (p <= 0 ? 0 : p >= 1 ? 1 : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
        ff: (p) => `if(lte(${p},0),0,if(gte(${p},1),1,pow(2,-10*${p})*sin((${p}*10-0.75)*2*PI/3)+1))`,
    },
    'bounce-out': {
        label: 'Bounce',
        js: (p) => {
            const n = 7.5625;
            const d = 2.75;
            if (p < 1 / d) return n * p * p;
            if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
            if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
            return n * (p -= 2.625 / d) * p + 0.984375;
        },
        ff: (p) =>
            `if(lt(${p},1/2.75),7.5625*pow(${p},2),if(lt(${p},2/2.75),7.5625*pow(${p}-1.5/2.75,2)+0.75,if(lt(${p},2.5/2.75),7.5625*pow(${p}-2.25/2.75,2)+0.9375,7.5625*pow(${p}-2.625/2.75,2)+0.984375)))`,
    },
};

export const EASING_IDS = Object.keys(EASINGS);

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Validated, sorted keyframes for one property (at most 64). */
export function normalizeTrack(list, prop, maxTime = 3 * 3600) {
    if (!Array.isArray(list)) return [];
    const [lo, hi] = PROPERTY_RANGE[prop] || [-1e6, 1e6];
    const out = [];
    for (const k of list.slice(0, 64)) {
        const t = Number(k?.t);
        const v = Number(k?.v);
        if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
        out.push({ t: clamp(Math.round(t * 1000) / 1000, 0, maxTime), v: clamp(v, lo, hi), ease: EASINGS[k.ease] ? k.ease : 'ease-in-out' });
    }
    out.sort((a, b) => a.t - b.t);
    // One keyframe per instant: the later entry wins.
    return out.filter((k, i) => i === out.length - 1 || out[i + 1].t - k.t > 1e-4);
}

/** All animatable properties of an element, validated. */
export function normalizeKeyframes(raw, kind = 'media', maxTime) {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    for (const prop of ANIMATABLE[kind] || []) {
        const track = normalizeTrack(raw[prop], prop, maxTime);
        if (track.length) out[prop] = track;
    }
    return Object.keys(out).length ? out : null;
}

/** Value of a keyframe track at time t (seconds from the element's start). */
export function evaluateTrack(track, t) {
    if (!track || !track.length) return undefined;
    if (t <= track[0].t) return track[0].v;
    const last = track[track.length - 1];
    if (t >= last.t) return last.v;
    for (let i = 0; i < track.length - 1; i += 1) {
        const a = track[i];
        const b = track[i + 1];
        if (t < b.t) {
            const p = (t - a.t) / (b.t - a.t);
            return a.v + (b.v - a.v) * EASINGS[a.ease || 'linear'].js(p);
        }
    }
    return last.v;
}

/** Evaluates every animated property at time t; returns { prop: value } for the animated ones. */
export function evaluateKeyframes(keyframes, t) {
    const out = {};
    if (!keyframes) return out;
    for (const [prop, track] of Object.entries(keyframes)) {
        const v = evaluateTrack(track, t);
        if (v !== undefined) out[prop] = v;
    }
    return out;
}

const fmt = (v) => (Math.abs(v) < 1e-9 ? '0' : Number(v.toFixed(5)).toString());

/**
 * FFmpeg expression for a track, in terms of time variable `tv` (seconds from the element's
 * start, e.g. 't' inside a segment). Constant outside the first and last keyframes.
 */
export function trackExpression(track, tv = 't') {
    if (!track || !track.length) return null;
    if (track.length === 1) return fmt(track[0].v);
    let expr = fmt(track[track.length - 1].v);
    for (let i = track.length - 2; i >= 0; i -= 1) {
        const a = track[i];
        const b = track[i + 1];
        const p = `clip((${tv}-${fmt(a.t)})/${fmt(b.t - a.t)},0,1)`;
        const seg = `(${fmt(a.v)}+${fmt(b.v - a.v)}*${EASINGS[a.ease || 'linear'].ff(p)})`;
        expr = `if(lt(${tv},${fmt(b.t)}),${seg},${expr})`;
    }
    return `if(lt(${tv},${fmt(track[0].t)}),${fmt(track[0].v)},${expr})`;
}

/** Adds or replaces the keyframe at time t (within half a frame). Returns a new track. */
export function setKeyframe(track = [], t, v, ease, fps = 30) {
    const tol = 0.5 / fps;
    const rest = track.filter((k) => Math.abs(k.t - t) > tol);
    const existing = track.find((k) => Math.abs(k.t - t) <= tol);
    return [...rest, { t: Math.round(t * 1000) / 1000, v, ease: ease || existing?.ease || 'ease-in-out' }].sort((a, b) => a.t - b.t);
}

export function removeKeyframe(track = [], t, fps = 30) {
    const tol = 0.5 / fps;
    return track.filter((k) => Math.abs(k.t - t) > tol);
}

/** Keyframe times of an element (all properties), sorted and de-duplicated. */
export function keyframeTimes(keyframes) {
    const times = new Set();
    for (const track of Object.values(keyframes || {})) for (const k of track) times.add(k.t);
    return [...times].sort((a, b) => a - b);
}

/** Shifts and scales keyframe times, e.g. when a clip is trimmed or re-timed. */
export function retimeKeyframes(keyframes, shift = 0, factor = 1) {
    if (!keyframes) return keyframes;
    const out = {};
    for (const [prop, track] of Object.entries(keyframes)) out[prop] = track.map((k) => ({ ...k, t: Math.max(0, Math.round((k.t * factor + shift) * 1000) / 1000) }));
    return out;
}
