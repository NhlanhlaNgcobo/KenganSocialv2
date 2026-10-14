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
    return `rotate(${t.rotation}deg) translate(${t.x * pxScale}px, ${t.y * pxScale}px) scale(${s}) scale(${t.flipH ? -1 : 1}, ${t.flipV ? -1 : 1})`;
}

/** Zoom that makes a clip cover the whole canvas (no letterbox bars), relative to the fitted size. */
export function fillScale(mediaWidth: number, mediaHeight: number, canvasWidth: number, canvasHeight: number): number {
    if (!mediaWidth || !mediaHeight) return 1;
    const fit = Math.min(canvasWidth / mediaWidth, canvasHeight / mediaHeight);
    const cover = Math.max(canvasWidth / mediaWidth, canvasHeight / mediaHeight);
    return Math.round((cover / fit) * 1000) / 1000;
}
