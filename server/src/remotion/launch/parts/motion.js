import { Easing, interpolate, spring } from 'remotion';

/** Small motion helpers shared by the launch/tutorial composition. Everything is a pure function of the frame. */

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

export const ease = (frame, from, to, out = [0, 1], easing = Easing.out(Easing.cubic)) => interpolate(frame, [from, to], out, { ...clamp, easing });

export const expoOut = Easing.bezier(0.16, 1, 0.3, 1);
export const smooth = Easing.bezier(0.65, 0, 0.35, 1);

export const pop = (frame, fps, delay = 0, config = { damping: 14, stiffness: 160, mass: 0.7 }) => spring({ frame: frame - delay, fps, config });

/** Frames two scenes overlap while one hands over to the next. */
export const OVERLAP = 10;

/**
 * Transitions per tone, used in turn so consecutive cuts never repeat. Each is an exit for the
 * outgoing scene and an entrance for the incoming one, played over the same OVERLAP frames.
 */
const SETS = {
    default: ['whip', 'zoom', 'wipe', 'rise', 'whipBack', 'wipeUp'],
    'app-store': ['rise', 'whip', 'wipe', 'zoom', 'whipBack'],
    'yc-parody': ['cut'],
    chaotic: ['flash', 'whip', 'zoom', 'flash', 'whipBack'],
    polished: ['fade', 'wipe', 'fade', 'zoomSoft'],
    deadpan: ['fade'],
    cinematic: ['zoom', 'wipe', 'fadeBlack', 'zoom', 'wipeUp'],
    tutorial: ['push'],
};

/** Transition into scene `index` (index ≥ 1); the seed varies the order between videos. */
export function transitionFor(tone, index, seed = 0) {
    const set = SETS[tone] || SETS.default;
    return set[(index - 1 + seed) % set.length];
}

/** Kept for older callers: the main transition of a tone. */
export const TRANSITIONS = Object.fromEntries(Object.entries(SETS).map(([k, v]) => [k, v[0]]));

/**
 * Style for a scene container during a transition.
 * @param {'in'|'out'} phase  entering (p 0→1) or leaving (p 0→1)
 */
export function transitionStyle(kind, phase, p) {
    if (kind === 'cut' || p <= 0) return {};
    const a = phase === 'in' ? 1 - p : p; // 1 = fully off-screen
    const e = Math.min(1, Math.max(0, a));
    switch (kind) {
        case 'whip':
        case 'whipBack': {
            const dir = (kind === 'whip' ? -1 : 1) * (phase === 'in' ? -1 : 1);
            return { transform: `translateX(${dir * e * 60}%) skewX(${dir * e * -6}deg)`, filter: e > 0.02 ? `blur(${e * 24}px)` : undefined, opacity: 1 - e * 0.5 };
        }
        case 'zoom':
            return phase === 'in'
                ? { transform: `scale(${1 - e * 0.35})`, opacity: 1 - e, filter: e > 0.02 ? `blur(${e * 12}px)` : undefined }
                : { transform: `scale(${1 + e * 0.9})`, opacity: 1 - e, filter: e > 0.02 ? `blur(${e * 16}px)` : undefined };
        case 'zoomSoft':
            return { transform: `scale(${phase === 'in' ? 1.06 - (1 - e) * 0.06 + 0 : 1 - e * 0.04})`, opacity: 1 - e };
        case 'wipe':
            // Complementary clips over the shared backdrop: a clean hard-edged wipe.
            return phase === 'in' ? { clipPath: `inset(0 0 0 ${e * 100}%)` } : { clipPath: `inset(0 ${e * 100}% 0 0)`, transform: `translateX(${-e * 8}%)` };
        case 'wipeUp':
            return phase === 'in' ? { clipPath: `inset(${e * 100}% 0 0 0)` } : { clipPath: `inset(0 0 ${e * 100}% 0)`, transform: `translateY(${-e * 8}%)` };
        case 'rise':
            return phase === 'in' ? { transform: `translateY(${e * 40}%)`, opacity: 1 - e * 0.6 } : { transform: `translateY(${-e * 30}%) scale(${1 - e * 0.1})`, opacity: 1 - e };
        case 'push':
            return { transform: `translateX(${(phase === 'in' ? 1 : -1) * e * 100}%)` };
        case 'flash':
            return phase === 'in' ? { transform: `scale(${1 + e * 0.25}) rotate(${e * -3}deg)`, opacity: 1 - e } : { opacity: 1 - e };
        case 'fadeBlack':
            return { opacity: 1 - e, filter: `brightness(${1 - e})` };
        default:
            return { opacity: 1 - e };
    }
}

/** 0..1 pulse that jumps on each beat and decays — drives tiny "bumps" so the picture breathes with the music. */
export function beatPulse(timeSec, beats) {
    if (!beats?.length) return 0;
    let last = -1;
    for (const b of beats) {
        if (b > timeSec) break;
        last = b;
    }
    if (last < 0) return 0;
    return Math.exp(-(timeSec - last) * 7);
}

/** Perceived lightness 0..1 of a hex/rgb colour (rough). */
export function lightness(color) {
    const c = String(color || '').toLowerCase();
    let m = c.match(/^#([0-9a-f]{6})$/);
    if (m) {
        const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    m = c.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/);
    if (m) return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
    return 0.5;
}

/** #rrggbb from #rgb/#rrggbb/rgb(); `fallback` otherwise. */
export function toHex(color, fallback = '#888888') {
    const c = String(color || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toLowerCase();
    const m = c.match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/);
    if (m) return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
    return fallback;
}

/** A colour with alpha, as #rrggbbaa. */
export const alpha = (color, a) => `${toHex(color)}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')}`;

/** Mix two colours (t = 0 → a, 1 → b). */
export function mix(a, b, t) {
    const pa = toHex(a);
    const pb = toHex(b);
    const ch = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    return `#${[0, 1, 2].map((i) => Math.round(ch(pa, i) + (ch(pb, i) - ch(pa, i)) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** Stable small integer from a string (varies layouts and transition order between products). */
export function hashOf(text) {
    let h = 0;
    for (const ch of String(text || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
}
