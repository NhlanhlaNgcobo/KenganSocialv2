import { cameraEndpoints } from './camera-motion.js';
import { evaluateKeyframes } from './keyframes.js';
import type { ClipTransform, MediaElement } from '../types';

export const DEFAULT_TRANSFORM: ClipTransform = {
    scale: 1,
    x: 0,
    y: 0,
    rotation: 0,
    flipH: false,
    flipV: false,
    animation: 'none',
    animationAmount: 0.2,
};

export function getTransform(el: MediaElement): ClipTransform {
    return { ...DEFAULT_TRANSFORM, ...(el.transform || {}) };
}

export function isIdentity(t: ClipTransform): boolean {
    return t.scale === 1 && t.x === 0 && t.y === 0 && t.rotation === 0 && !t.flipH && !t.flipV && t.animation === 'none';
}

/** Start and end zoom of a clip, including its Ken Burns animation. */
export function scaleRange(t: ClipTransform): [number, number] {
    const motion = cameraEndpoints(t);
    if (motion) return [motion.scaleStart, motion.scaleEnd];
    const extra = 1 + Math.max(0, t.animationAmount);
    if (t.animation === 'zoom-in') return [t.scale, t.scale * extra];
    if (t.animation === 'zoom-out') return [t.scale * extra, t.scale];
    return [t.scale, t.scale];
}

/**
 * CSS transform for the preview. Matches the export filter order: flip, zoom about the
 * canvas centre, move, then rotate about the canvas centre.
 * @param progress 0..1 position within the clip (drives the zoom animation)
 * @param pxScale preview pixels per canvas pixel
 */
export function cssTransform(t: ClipTransform, progress: number, pxScale: number): string | undefined {
    if (isIdentity(t)) return undefined;
    const [s0, s1] = scaleRange(t);
    const s = s0 + (s1 - s0) * Math.min(1, Math.max(0, progress));
    const motion = cameraEndpoints(t);
    const p = Math.min(1, Math.max(0, progress));
    const x = motion ? motion.x + (motion.xEnd - motion.x) * p : t.x;
    const y = motion ? motion.y + (motion.yEnd - motion.y) * p : t.y;
    return `rotate(${t.rotation}deg) translate(${x * pxScale}px, ${y * pxScale}px) scale(${s}) scale(${t.flipH ? -1 : 1}, ${t.flipV ? -1 : 1})`;
}

/**
 * Values of a clip at element time `local` with keyframes applied: keyframed properties replace the
 * static/camera value (same rule as the export).
 */
export function animatedTransform(el: MediaElement, local: number, length: number) {
    const t = getTransform(el);
    const kf = evaluateKeyframes(el.keyframes, local) as Partial<Record<'x' | 'y' | 'scale' | 'rotation' | 'opacity', number>>;
    const p = Math.min(1, Math.max(0, local / Math.max(length, 0.001)));
    const [s0, s1] = scaleRange(t);
    const motion = cameraEndpoints(t);
    const ownMotion = !el.keyframes?.x?.length && !el.keyframes?.y?.length && !el.keyframes?.scale?.length;
    return {
        scale: kf.scale ?? (ownMotion ? s0 + (s1 - s0) * p : t.scale),
        x: kf.x ?? (motion && ownMotion ? motion.x + (motion.xEnd - motion.x) * p : t.x),
        y: kf.y ?? (motion && ownMotion ? motion.y + (motion.yEnd - motion.y) * p : t.y),
        rotation: kf.rotation ?? t.rotation,
        opacity: kf.opacity ?? 1,
        flipH: t.flipH,
        flipV: t.flipV,
    };
}

/** CSS transform for animatedTransform() values. */
export function cssFromValues(v: ReturnType<typeof animatedTransform>, pxScale: number): string | undefined {
    if (v.scale === 1 && !v.x && !v.y && !v.rotation && !v.flipH && !v.flipV) return undefined;
    return `rotate(${v.rotation}deg) translate(${v.x * pxScale}px, ${v.y * pxScale}px) scale(${v.scale}) scale(${v.flipH ? -1 : 1}, ${v.flipV ? -1 : 1})`;
}

/** Zoom that makes a clip cover the whole canvas (no letterbox bars), relative to the fitted size. */
export function fillScale(mediaWidth: number, mediaHeight: number, canvasWidth: number, canvasHeight: number): number {
    if (!mediaWidth || !mediaHeight) return 1;
    const fit = Math.min(canvasWidth / mediaWidth, canvasHeight / mediaHeight);
    const cover = Math.max(canvasWidth / mediaWidth, canvasHeight / mediaHeight);
    return Math.round((cover / fit) * 1000) / 1000;
}
