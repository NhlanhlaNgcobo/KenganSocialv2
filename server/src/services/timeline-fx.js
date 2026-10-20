/**
 * Editor looks, colour grade, effects and transitions as FFmpeg filters (LGPL, built into FFmpeg).
 * The client mirrors these with CSS previews (client/src/editor/lib/fx.ts); names must match.
 *
 *  Looks        colour presets built from eq, curves, colorbalance, colortemperature, colorchannelmixer
 *  Grade        per-clip sliders: brightness, contrast, saturation, vibrance, temperature, tint,
 *               highlights, shadows, fade
 *  Effects      vignette, grain, blur, soft glow, RGB split, glitch, VHS, pixelate, shake, echo, sketch
 *  Transitions  FFmpeg xfade (the same family as github.com/gl-transitions/gl-transitions)
 */

import { TREND_XFADE } from './trend-transitions.js';
import { TREND_EFFECTS, trendEffectFilters } from './trend-effects.js';

/** Look presets (the editor's "filter" field). */
export const LOOKS = {
    vivid: 'eq=saturation=1.5:contrast=1.1:brightness=0.05',
    fade: 'eq=saturation=0.6:brightness=0.1:contrast=0.9',
    noir: 'hue=s=0,eq=contrast=1.3:brightness=-0.05',
    warm: 'colorbalance=rs=0.15:gs=0.05:bs=-0.1:rm=0.1:gm=0.0:bm=-0.1',
    cool: 'colorbalance=rs=-0.1:gs=0.0:bs=0.15:rm=-0.05:gm=0.05:bm=0.1',
    drama: 'eq=contrast=1.4:brightness=-0.08:saturation=1.2,unsharp=5:5:1.0',
    neon: 'eq=saturation=2.0:contrast=1.3:brightness=0.1,hue=h=10',
    'teal-orange': 'colorbalance=rs=-0.12:gs=-0.03:bs=0.12:rh=0.1:gh=0.02:bh=-0.08,eq=saturation=1.15:contrast=1.08',
    golden: 'colortemperature=temperature=4300:mix=0.7,eq=saturation=1.1:brightness=0.03',
    moody: 'eq=contrast=1.15:brightness=-0.06:saturation=0.78,colorbalance=bs=0.08:bm=0.04',
    vintage: 'curves=preset=vintage,eq=saturation=0.9',
    'cross-process': 'curves=preset=cross_process',
    'bleach-bypass': 'eq=saturation=0.45:contrast=1.35:brightness=-0.02',
    matte: "curves=all='0/0.08 1/0.92',eq=saturation=0.9",
    'film-warm': "curves=r='0/0.03 0.5/0.55 1/1':g='0/0.02 0.5/0.5 1/0.97':b='0/0.06 0.5/0.45 1/0.9',eq=saturation=1.08",
    'film-cool': "curves=r='0/0 0.5/0.47 1/0.96':g='0/0.02 0.5/0.52 1/1':b='0/0.05 0.5/0.53 1/1',eq=saturation=1.05",
    sepia: 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131',
    cyberpunk: 'colorbalance=rs=0.15:bs=0.2:gm=-0.1,eq=saturation=1.4:contrast=1.15',
    pastel: 'eq=saturation=0.75:brightness=0.06:contrast=0.88,colorbalance=rh=0.04:bh=0.05',
};

const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

/** Colour grade sliders; null when neutral. */
export function normalizeGrade(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const g = {
        brightness: num(raw.brightness, 0, -0.3, 0.3),
        contrast: num(raw.contrast, 1, 0.5, 1.8),
        saturation: num(raw.saturation, 1, 0, 2),
        vibrance: num(raw.vibrance, 0, -1, 1),
        temperature: num(raw.temperature, 0, -1, 1),
        tint: num(raw.tint, 0, -1, 1),
        highlights: num(raw.highlights, 0, -1, 1),
        shadows: num(raw.shadows, 0, -1, 1),
        fade: num(raw.fade, 0, 0, 1),
    };
    const neutral = !g.brightness && g.contrast === 1 && g.saturation === 1 && !g.vibrance && !g.temperature && !g.tint && !g.highlights && !g.shadows && !g.fade;
    return neutral ? null : g;
}

/** FFmpeg filters for a grade (applied to the picture before letterboxing). */
export function gradeFilters(g) {
    if (!g) return '';
    const parts = [];
    if (g.brightness || g.contrast !== 1 || g.saturation !== 1) {
        parts.push(`eq=brightness=${g.brightness.toFixed(3)}:contrast=${g.contrast.toFixed(3)}:saturation=${g.saturation.toFixed(3)}`);
    }
    if (g.vibrance) parts.push(`vibrance=intensity=${(g.vibrance * 0.8).toFixed(3)}`);
    if (g.temperature || g.tint) {
        // Warm: lift reds, cut blues. Tint: + magenta / - green (midtones).
        const t = g.temperature;
        parts.push(
            `colorbalance=rm=${(0.12 * t).toFixed(3)}:gm=${(-0.08 * g.tint).toFixed(3)}:bm=${(-0.12 * t).toFixed(3)}:rh=${(0.05 * t).toFixed(3)}:bh=${(-0.05 * t).toFixed(3)}`
        );
    }
    if (g.highlights || g.shadows || g.fade) {
        // Tone curve: fade lifts the black point; shadows/highlights bend the quarter and three-quarter points.
        const black = (0.14 * g.fade).toFixed(3);
        const q1 = (0.25 + 0.1 * g.shadows).toFixed(3);
        const q3 = (0.75 + 0.1 * g.highlights).toFixed(3);
        parts.push(`curves=all='0/${black} 0.25/${q1} 0.75/${q3} 1/1'`);
    }
    return parts.length ? `,${parts.join(',')}` : '';
}

export const EFFECT_TYPES = ['vignette', 'grain', 'blur', 'glow', 'rgbsplit', 'glitch', 'vhs', 'pixelate', 'shake', 'echo', 'sketch', ...TREND_EFFECTS.map((e) => e.type)];

export function normalizeEffects(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((e) => e && e.enabled !== false && EFFECT_TYPES.includes(e.type))
        .slice(0, 6)
        .map((e) => ({ type: e.type, amount: num(e.amount, 0.5, 0, 1) }));
}

/**
 * Effect filters for a canvas-sized frame (W×H), applied after framing so they cover the whole
 * picture. Returns a leading-comma string, like the other builders.
 */
export function effectFilters(effects, W, H, fps = 30) {
    const parts = [];
    for (const [index, { type, amount: a }] of (effects || []).entries()) {
        if (type.startsWith('ks-')) {
            const trend = trendEffectFilters(type, a, W, H, index, fps);
            if (trend) parts.push(trend);
            continue;
        }
        if (type === 'vignette') parts.push(`vignette=angle=${(0.3 + 0.6 * a).toFixed(3)}`);
        if (type === 'grain') parts.push(`noise=alls=${Math.round(6 + a * 30)}:allf=t+u`);
        if (type === 'blur') parts.push(`gblur=sigma=${(1 + a * 14).toFixed(2)}`);
        if (type === 'glow') parts.push(`curves=all='0/0 0.55/${(0.6 + 0.12 * a).toFixed(3)} 1/1',gblur=sigma=${(0.4 + a).toFixed(2)},eq=saturation=${(1 + 0.15 * a).toFixed(3)}`);
        if (type === 'rgbsplit') {
            const px = Math.round(2 + a * 16);
            parts.push(`rgbashift=rh=-${px}:bh=${px}`);
        }
        if (type === 'glitch') {
            const px = Math.round(4 + a * 20);
            parts.push(`rgbashift=rh=${px}:gv=-${Math.round(px / 3)}:bh=-${px}`, `noise=c0s=${Math.round(10 + a * 30)}:allf=t`);
        }
        if (type === 'vhs') parts.push(`chromashift=cbh=${Math.round(3 + a * 6)}:crh=-${Math.round(3 + a * 6)}`, 'curves=preset=vintage', `noise=alls=${Math.round(8 + a * 14)}:allf=t`, 'gblur=sigma=0.7', 'eq=saturation=0.85');
        if (type === 'pixelate') {
            const block = Math.round(6 + a * 34);
            parts.push(`pixelize=w=${block}:h=${block}`);
        }
        if (type === 'shake') {
            const amp = (4 + a * 26).toFixed(1);
            const pad = Math.ceil(Number(amp) * 2 + 4);
            parts.push(`scale=${W + pad * 2}:${H + pad * 2}`, `crop=${W}:${H}:x='${pad}+${amp}*sin(n*1.7)':y='${pad}+${amp}*cos(n*2.3)'`);
        }
        if (type === 'echo') parts.push(`lagfun=decay=${(0.86 + a * 0.12).toFixed(3)}`);
        if (type === 'sketch') parts.push('edgedetect=mode=colormix:high=0.2:low=0.06');
    }
    return parts.length ? `,${parts.join(',')}` : '';
}

/** Transitions: editor name → FFmpeg xfade transition. */
export const TRANSITIONS = {
    ...TREND_XFADE,
    fade: 'fade',
    dissolve: 'dissolve',
    fadeblack: 'fadeblack',
    fadewhite: 'fadewhite',
    wipeleft: 'wipeleft',
    wiperight: 'wiperight',
    wipeup: 'wipeup',
    wipedown: 'wipedown',
    slideleft: 'slideleft',
    slideright: 'slideright',
    slideup: 'slideup',
    slidedown: 'slidedown',
    smoothleft: 'smoothleft',
    circleopen: 'circleopen',
    circleclose: 'circleclose',
    zoomin: 'zoomin',
    hblur: 'hblur',
    pixelize: 'pixelize',
    radial: 'radial',
    squeezeh: 'squeezeh',
};

/**
 * Kengan custom transitions: FFmpeg xfade with per-pixel expressions (transition=custom).
 * Variables: X, Y, W, H (pixel and plane size), A / B (outgoing / incoming value), PLANE
 * (0 = brightness, 1-2 = colour), P = progress from 1 down to 0, so q = 1-P runs 0 → 1.
 * Coordinates are normalised (X/W, Y/H) so 4:2:0 colour planes line up with brightness.
 */
// No st()/ld(): xfade evaluates expressions on several threads that share those registers, which
// corrupts pixels. Sub-expressions are inlined instead.
const fract = (v) => `((${v})-floor(${v}))`;
const hash = (v) => fract(`sin(${v})*43758.5453`);
const q = '(1-P)';
const mix = 'A*P+B*(1-P)';
const heartScale = `(max(${q},0.001)*1.9)`;
const hx = `((X/W-0.5)*W/min(W,H)*2.6/${heartScale})`;
const hy = `((0.5-Y/H)*H/min(W,H)*2.6/${heartScale}+0.25)`;
const angle = 'atan2(Y/H-0.5,X/W-0.5)/(2*PI)+0.5';
const radius = 'hypot(X/W-0.5,Y/H-0.5)';
const soft = `clip((${q}*1.3-0.15-(X/W+Y/H)/2)/0.15+0.5,0,1)`;
const flashAmt = `pow(sin(PI*${q}),6)`;
const burnAmt = `(pow(sin(PI*${q}),2)*clip(1.2-abs(X/W-0.7*${q}-0.15)*2,0,1))`;
const band = hash('floor(Y/H*18)*91.7');
const column = hash('floor(X/W*24)*57.3');
export const CUSTOM_TRANSITIONS = {
    blinds: `if(lt(mod(Y/H*10,1),${q}),B,A)`,
    vblinds: `if(lt(mod(X/W*12,1),${q}),B,A)`,
    checker: `if(gt(${q},mod(floor(X/W*8)+floor(Y/H*8),2)*0.5+0.25*(mod(X/W*8,1)+mod(Y/H*8,1))),B,A)`,
    diamond: `if(lt(abs(X/W-0.5)+abs(Y/H-0.5),${q}*1.05),B,A)`,
    barndoor: `if(lt(abs(X/W-0.5),${q}*0.52),B,A)`,
    boxiris: `if(lt(max(abs(X/W-0.5),abs(Y/H-0.5)),${q}*0.52),B,A)`,
    diagsoft: `A*(1-${soft})+B*${soft}`,
    pixeldissolve: `if(lt(${hash('floor(X/W*160)*12.9898+floor(Y/H*160*H/W)*78.233')},${q}),B,A)`,
    spiral: `if(lt(mod(${angle}+${radius}*2.13,1)*0.35+${radius}*0.92,${q}),B,A)`,
    heart: `if(lte(pow(${hx}*${hx}+${hy}*${hy}-1,3)-${hx}*${hx}*pow(${hy},3),0),B,A)`,
    glitchbands: `if(lt(X/W,clip((${q}-${band}*0.6)/0.4,0,1)),B,A)`,
    flash: `if(eq(PLANE,0),min(255,${mix}+230*${flashAmt}),${mix}+(128-(${mix}))*${flashAmt})`,
    filmburn: `if(eq(PLANE,0),min(255,${mix}+170*${burnAmt}),if(eq(PLANE,1),${mix}-55*${burnAmt},${mix}+65*${burnAmt}))`,
    wavewipe: `if(lt(X/W,${q}*1.2-0.1+0.06*sin(Y/H*18+P*10)),B,A)`,
    pixelrain: `if(lt(Y/H,(${q}-${column}*0.45)/0.55),B,A)`,
};
for (const [id, expr] of Object.entries(CUSTOM_TRANSITIONS)) TRANSITIONS[id] = `custom:expr='${expr}'`;

export function normalizeTransition(raw) {
    if (!raw || typeof raw !== 'object' || !Object.hasOwn(TRANSITIONS, raw.type)) return null;
    return { type: raw.type, duration: num(raw.duration, 0.6, 0.2, 2) };
}
