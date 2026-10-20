/**
 * Effects and transitions: catalogue plus CSS previews. The export renders them with FFmpeg
 * (server/src/services/timeline-fx.js: vignette, noise, gblur, rgbashift, chromashift, pixelize,
 * lagfun, edgedetect; transitions with xfade, the same family as gl-transitions). Names must match.
 * Previews are close approximations; the export is exact.
 */
import type { CSSProperties } from 'react';
import type { ClipEffect, ClipTransition, EffectType, MediaElement, TimelineTrack, TransitionType } from '../types';
import { getElementEnd } from './time';
import { TREND_TRANSITIONS, trendTransitionStyles } from './trend-transitions.js';
import { TREND_EFFECTS, trendEffectPreview } from './trend-effects.js';

export interface EffectInfo {
    type: EffectType;
    label: string;
    description: string;
    /** Shown only after export (no faithful live preview). */
    exportOnly?: boolean;
}

export const EFFECTS: EffectInfo[] = [
    ...TREND_EFFECTS as EffectInfo[],
    { type: 'vignette', label: 'Vignette', description: 'Darker edges that pull the eye to the centre' },
    { type: 'grain', label: 'Film grain', description: 'Moving film-style grain' },
    { type: 'blur', label: 'Blur', description: 'Soft-focus the whole picture' },
    { type: 'glow', label: 'Soft glow', description: 'Dreamy lifted highlights' },
    { type: 'rgbsplit', label: 'RGB split', description: 'Red and blue channels pulled apart' },
    { type: 'glitch', label: 'Glitch', description: 'Digital colour shift with noise' },
    { type: 'vhs', label: 'VHS', description: 'Retro tape: colour bleed, grain, soft picture' },
    { type: 'pixelate', label: 'Pixelate', description: 'Blocky mosaic', exportOnly: true },
    { type: 'shake', label: 'Camera shake', description: 'Handheld energy, good on beats' },
    { type: 'echo', label: 'Echo trails', description: 'Motion leaves ghost trails', exportOnly: true },
    { type: 'sketch', label: 'Sketch', description: 'Edge-drawn comic look' },
];

const GRAIN_SVG =
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

export interface EffectPreview {
    /** Added to the clip's CSS filter. */
    filter: string;
    /** Extra transform (shake). */
    transform: string;
    /** Overlay layers drawn over the clip. */
    overlays: CSSProperties[];
}

/**
 * CSS approximation of a clip's effects at `time` seconds into the clip.
 * @param pxScale preview pixels per canvas pixel
 */
export function effectPreview(effects: ClipEffect[] | undefined, time: number, pxScale: number): EffectPreview {
    const out: EffectPreview = { filter: '', transform: '', overlays: [] };
    for (const { type, amount: a, enabled } of effects || []) {
        if (enabled === false) continue;
        if (type.startsWith('ks-')) {
            const trend = trendEffectPreview(type, a, time, pxScale);
            out.filter += ` ${trend.filter}`;
            out.transform += ` ${trend.transform}`;
            out.overlays.push(...trend.overlays as CSSProperties[]);
            continue;
        }
        if (type === 'vignette') out.overlays.push({ background: `radial-gradient(ellipse at center, transparent ${Math.round(60 - a * 25)}%, rgba(0,0,0,${(0.45 + a * 0.45).toFixed(2)}) 100%)` });
        if (type === 'grain' || type === 'vhs' || type === 'glitch') {
            const strength = type === 'grain' ? 0.12 + a * 0.3 : 0.1 + a * 0.15;
            // Shift the noise tile each frame so it moves like real grain.
            const offset = Math.floor(time * 24) % 7;
            out.overlays.push({ backgroundImage: GRAIN_SVG, backgroundPosition: `${offset * 23}px ${offset * 17}px`, opacity: strength, mixBlendMode: 'overlay' });
        }
        if (type === 'blur') out.filter += ` blur(${((1 + a * 14) * pxScale).toFixed(1)}px)`;
        if (type === 'glow') out.filter += ` brightness(${(1.04 + a * 0.06).toFixed(3)}) contrast(${(0.94 - a * 0.06).toFixed(3)}) saturate(${(1 + a * 0.15).toFixed(3)})`;
        if (type === 'rgbsplit' || type === 'glitch') out.filter += ` saturate(${(1.15 + a * 0.3).toFixed(2)}) contrast(1.06)`;
        if (type === 'vhs') out.filter += ' sepia(0.25) saturate(0.85) contrast(0.95) blur(0.6px)';
        if (type === 'sketch') out.filter += ' grayscale(1) contrast(2.2) brightness(1.15)';
        if (type === 'shake') {
            const amp = (4 + a * 26) * pxScale;
            const n = time * 30;
            out.transform += ` translate(${(amp * Math.sin(n * 1.7)).toFixed(1)}px, ${(amp * Math.cos(n * 2.3)).toFixed(1)}px) scale(${(1 + (amp * 4) / 1000).toFixed(3)})`;
        }
    }
    return out;
}

export interface TransitionInfo {
    type: TransitionType;
    label: string;
    group: 'Basic' | 'Wipe' | 'Slide' | 'Shape' | 'Stylised' | 'Kengan originals' | 'Kengan motion';
    description?: string;
}

export const TRANSITIONS: TransitionInfo[] = [
    ...TREND_TRANSITIONS as TransitionInfo[],
    { type: 'fade', label: 'Cross fade', group: 'Basic' },
    { type: 'dissolve', label: 'Dissolve', group: 'Basic' },
    { type: 'fadeblack', label: 'Dip to black', group: 'Basic' },
    { type: 'fadewhite', label: 'Dip to white', group: 'Basic' },
    { type: 'wipeleft', label: 'Wipe left', group: 'Wipe' },
    { type: 'wiperight', label: 'Wipe right', group: 'Wipe' },
    { type: 'wipeup', label: 'Wipe up', group: 'Wipe' },
    { type: 'wipedown', label: 'Wipe down', group: 'Wipe' },
    { type: 'smoothleft', label: 'Soft wipe', group: 'Wipe' },
    { type: 'slideleft', label: 'Slide left', group: 'Slide' },
    { type: 'slideright', label: 'Slide right', group: 'Slide' },
    { type: 'slideup', label: 'Slide up', group: 'Slide' },
    { type: 'slidedown', label: 'Slide down', group: 'Slide' },
    { type: 'circleopen', label: 'Circle open', group: 'Shape' },
    { type: 'circleclose', label: 'Circle close', group: 'Shape' },
    { type: 'radial', label: 'Clock wipe', group: 'Shape' },
    { type: 'zoomin', label: 'Zoom in', group: 'Stylised' },
    { type: 'hblur', label: 'Blur', group: 'Stylised' },
    { type: 'pixelize', label: 'Pixelate', group: 'Stylised' },
    { type: 'squeezeh', label: 'Squeeze', group: 'Stylised' },
    { type: 'blinds', label: 'Blinds', group: 'Kengan originals' },
    { type: 'vblinds', label: 'Shutters', group: 'Kengan originals' },
    { type: 'checker', label: 'Checkerboard', group: 'Kengan originals' },
    { type: 'diamond', label: 'Diamond', group: 'Kengan originals' },
    { type: 'barndoor', label: 'Barn doors', group: 'Kengan originals' },
    { type: 'boxiris', label: 'Box iris', group: 'Kengan originals' },
    { type: 'diagsoft', label: 'Soft diagonal', group: 'Kengan originals' },
    { type: 'pixeldissolve', label: 'Pixel dissolve', group: 'Kengan originals' },
    { type: 'spiral', label: 'Spiral', group: 'Kengan originals' },
    { type: 'heart', label: 'Heart', group: 'Kengan originals' },
    { type: 'glitchbands', label: 'Glitch bands', group: 'Kengan originals' },
    { type: 'flash', label: 'Flash', group: 'Kengan originals' },
    { type: 'filmburn', label: 'Film burn', group: 'Kengan originals' },
    { type: 'wavewipe', label: 'Wave wipe', group: 'Kengan originals' },
    { type: 'pixelrain', label: 'Pixel rain', group: 'Kengan originals' },
];

export const TRANSITION_GROUPS: TransitionInfo['group'][] = ['Kengan motion', 'Basic', 'Wipe', 'Slide', 'Shape', 'Stylised', 'Kengan originals'];

/** Heart outline (classic parametric heart) as unit points around the centre. */
const HEART: [number, number][] = [[0.000, -0.294], [0.002, -0.314], [0.016, -0.371], [0.053, -0.454], [0.118, -0.545], [0.212, -0.627], [0.333, -0.683], [0.470, -0.701], [0.611, -0.676], [0.742, -0.609], [0.848, -0.506], [0.917, -0.378], [0.941, -0.235], [0.917, -0.088], [0.848, 0.056], [0.742, 0.193], [0.611, 0.324], [0.470, 0.447], [0.333, 0.565], [0.212, 0.677], [0.118, 0.780], [0.053, 0.869], [0.016, 0.940], [0.002, 0.985], [0.000, 1.000], [-0.002, 0.985], [-0.016, 0.940], [-0.053, 0.869], [-0.118, 0.780], [-0.212, 0.677], [-0.333, 0.565], [-0.470, 0.447], [-0.611, 0.324], [-0.742, 0.193], [-0.848, 0.056], [-0.917, -0.088], [-0.941, -0.235], [-0.917, -0.378], [-0.848, -0.506], [-0.742, -0.609], [-0.611, -0.676], [-0.470, -0.701], [-0.333, -0.683], [-0.212, -0.627], [-0.118, -0.545], [-0.053, -0.454], [-0.016, -0.371], [-0.002, -0.314]];

export const DEFAULT_TRANSITION_SECONDS = 0.6;

/**
 * CSS for the outgoing (A) and incoming (B) clip at progress p (0..1), plus an optional colour wash
 * (dip to black/white). B is drawn above A.
 */
export function transitionStyles(type: TransitionType, p: number): { a: CSSProperties; b: CSSProperties; wash?: CSSProperties } {
    const trend = trendTransitionStyles(type, p);
    if (trend) return trend as { a: CSSProperties; b: CSSProperties; wash?: CSSProperties };
    const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
    const ease = p * p * (3 - 2 * p);
    switch (type) {
        case 'fade':
        case 'dissolve':
            return { a: {}, b: { opacity: ease } };
        case 'fadeblack':
        case 'fadewhite': {
            const colour = type === 'fadeblack' ? '#000' : '#fff';
            return { a: { opacity: p < 0.5 ? 1 : 0 }, b: { opacity: p < 0.5 ? 0 : 1 }, wash: { background: colour, opacity: p < 0.5 ? p * 2 : 2 - p * 2 } };
        }
        case 'wipeleft':
            return { a: {}, b: { clipPath: `inset(0 0 0 ${pct(1 - p)})` } };
        case 'wiperight':
            return { a: {}, b: { clipPath: `inset(0 ${pct(1 - p)} 0 0)` } };
        case 'wipeup':
            return { a: {}, b: { clipPath: `inset(${pct(1 - p)} 0 0 0)` } };
        case 'wipedown':
            return { a: {}, b: { clipPath: `inset(0 0 ${pct(1 - p)} 0)` } };
        case 'smoothleft': {
            const edge = (1 - p) * 120 - 10;
            const mask = `linear-gradient(to right, transparent ${edge}%, black ${edge + 20}%)`;
            return { a: {}, b: { maskImage: mask, WebkitMaskImage: mask } };
        }
        case 'slideleft':
            return { a: { transform: `translateX(${-ease * 100}%)` }, b: { transform: `translateX(${(1 - ease) * 100}%)` } };
        case 'slideright':
            return { a: { transform: `translateX(${ease * 100}%)` }, b: { transform: `translateX(${-(1 - ease) * 100}%)` } };
        case 'slideup':
            return { a: { transform: `translateY(${-ease * 100}%)` }, b: { transform: `translateY(${(1 - ease) * 100}%)` } };
        case 'slidedown':
            return { a: { transform: `translateY(${ease * 100}%)` }, b: { transform: `translateY(${-(1 - ease) * 100}%)` } };
        case 'circleopen':
            return { a: {}, b: { clipPath: `circle(${(p * 75).toFixed(2)}% at 50% 50%)` } };
        case 'circleclose': {
            // A shrinks into a circle: B shows everywhere outside it.
            const r = (1 - p) * 100;
            const mask = `radial-gradient(circle at 50% 50%, transparent ${r.toFixed(2)}%, black ${(r + 0.5).toFixed(2)}%)`;
            return { a: {}, b: { maskImage: mask, WebkitMaskImage: mask } };
        }
        case 'radial': {
            const mask = `conic-gradient(from 0deg, black ${(p * 360).toFixed(1)}deg, transparent ${(p * 360 + 0.5).toFixed(1)}deg)`;
            return { a: {}, b: { maskImage: mask, WebkitMaskImage: mask } };
        }
        case 'zoomin':
            return { a: { transform: `scale(${1 + ease})`, opacity: 1 - ease }, b: { opacity: ease } };
        case 'hblur': {
            const blur = Math.sin(Math.PI * p) * 14;
            return { a: { filter: `blur(${blur}px)` }, b: { opacity: ease, filter: `blur(${blur}px)` } };
        }
        case 'pixelize': {
            const blur = Math.sin(Math.PI * p) * 10;
            return { a: { filter: `blur(${blur}px) contrast(1.1)` }, b: { opacity: p < 0.5 ? 0 : 1, filter: `blur(${blur}px) contrast(1.1)` } };
        }
        case 'squeezeh':
            return { a: { transform: `scaleY(${Math.max(0.001, 1 - ease)})` }, b: { opacity: 1 } };
        case 'blinds': {
            const mask = `repeating-linear-gradient(to bottom, black 0, black ${(p * 10).toFixed(2)}%, transparent ${(p * 10).toFixed(2)}%, transparent 10%)`;
            return { a: {}, b: { maskImage: mask, WebkitMaskImage: mask } };
        }
        case 'vblinds': {
            const mask = `repeating-linear-gradient(to right, black 0, black ${(p * 8.333).toFixed(2)}%, transparent ${(p * 8.333).toFixed(2)}%, transparent 8.333%)`;
            return { a: {}, b: { maskImage: mask, WebkitMaskImage: mask } };
        }
        case 'checker': {
            // First half: alternate squares; second half: the rest fill in.
            const rest = Math.max(0, p * 2 - 1) * 100;
            const mask = `conic-gradient(black 0 25%, transparent 0 50%, black 0 75%, transparent 0) 0 0 / 25% 25%, linear-gradient(black, black) 0 0 / 100% ${rest.toFixed(1)}% no-repeat`;
            return { a: {}, b: { maskImage: mask, WebkitMaskImage: mask, opacity: p < 0.5 ? Math.min(1, p * 3) : 1 } };
        }
        case 'diamond': {
            const d = p * 105;
            return { a: {}, b: { clipPath: `polygon(50% ${50 - d}%, ${50 + d}% 50%, 50% ${50 + d}%, ${50 - d}% 50%)` } };
        }
        case 'barndoor':
            return { a: {}, b: { clipPath: `inset(0 ${(50 - p * 52).toFixed(2)}% 0 ${(50 - p * 52).toFixed(2)}%)` } };
        case 'boxiris':
            return { a: {}, b: { clipPath: `inset(${(50 - p * 52).toFixed(2)}%)` } };
        case 'diagsoft': {
            const e = (p * 1.3 - 0.15) * 100;
            const mask = `linear-gradient(135deg, black ${e - 7.5}%, transparent ${e + 7.5}%)`;
            return { a: {}, b: { maskImage: mask, WebkitMaskImage: mask } };
        }
        case 'pixeldissolve':
            return { a: {}, b: { opacity: p, filter: `contrast(${(1 + Math.sin(Math.PI * p) * 0.3).toFixed(2)})` } };
        case 'spiral': {
            const mask = `conic-gradient(from 90deg, black ${(p * 360).toFixed(1)}deg, transparent ${(p * 360 + 25).toFixed(1)}deg), radial-gradient(circle, black ${(p * 60).toFixed(1)}%, transparent ${(p * 60 + 10).toFixed(1)}%)`;
            return { a: {}, b: { maskImage: mask, WebkitMaskImage: mask } };
        }
        case 'heart': {
            const sc = p * 95;
            const poly = HEART.map(([x, y]) => `${(50 + x * sc).toFixed(2)}% ${(53 + y * sc * 0.9).toFixed(2)}%`).join(', ');
            return { a: {}, b: { clipPath: `polygon(${poly})` } };
        }
        case 'glitchbands':
            return { a: {}, b: { clipPath: `inset(0 ${((1 - p) * 100).toFixed(1)}% 0 0)`, filter: `hue-rotate(${(Math.sin(Math.PI * p) * 40).toFixed(0)}deg)` } };
        case 'flash':
            return { a: {}, b: { opacity: ease }, wash: { background: '#fff', opacity: Math.pow(Math.sin(Math.PI * p), 6) } };
        case 'filmburn':
            return {
                a: {},
                b: { opacity: ease },
                wash: {
                    background: `radial-gradient(ellipse at ${(15 + 70 * p).toFixed(0)}% 50%, rgba(255,170,60,0.95), rgba(255,80,20,0.6) 40%, transparent 75%)`,
                    opacity: Math.pow(Math.sin(Math.PI * p), 2),
                    mixBlendMode: 'screen',
                },
            };
        case 'wavewipe': {
            const e = (p * 1.2 - 0.1) * 100;
            const mask = `linear-gradient(to right, black ${e - 4}%, transparent ${e + 4}%)`;
            return { a: {}, b: { maskImage: mask, WebkitMaskImage: mask } };
        }
        case 'pixelrain':
            return { a: {}, b: { clipPath: `inset(0 0 ${((1 - p) * 100).toFixed(1)}% 0)` } };
        default:
            return { a: {}, b: { opacity: ease } };
    }
}

export interface TransitionWindow {
    /** Cut time (start of the incoming clip). */
    at: number;
    duration: number;
    type: TransitionType;
    outgoingId: string;
    incomingId: string;
}

/** Transitions on the main track, centred on each cut between adjacent clips. */
export function transitionWindows(main: TimelineTrack | undefined): TransitionWindow[] {
    if (!main) return [];
    const clips = (main.elements.filter((e) => e.type === 'media' && !e.hidden) as MediaElement[]).sort((x, y) => x.startTime - y.startTime);
    const out: TransitionWindow[] = [];
    for (let i = 1; i < clips.length; i += 1) {
        const prev = clips[i - 1];
        const cur = clips[i];
        const t = cur.transitionIn;
        if (!t || Math.abs(getElementEnd(prev) - cur.startTime) > 0.05) continue;
        const d = Math.min(t.duration, (getElementEnd(prev) - prev.startTime) * 0.9, (getElementEnd(cur) - cur.startTime) * 0.9);
        if (d >= 0.15) out.push({ at: cur.startTime, duration: d, type: t.type, outgoingId: prev.id, incomingId: cur.id });
    }
    return out;
}

/** True when two clips meet with no gap, so a transition can join them. */
export function canTransition(prev: MediaElement | undefined, cur: MediaElement): boolean {
    return !!prev && Math.abs(getElementEnd(prev) - cur.startTime) <= 0.05;
}

export type { ClipTransition };
