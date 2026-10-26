/**
 * Picture-in-picture layouts for clips on overlay tracks (any media track above the main one).
 *
 * Geometry matches the preview and the export: a clip is first fitted inside the canvas
 * (contain), then zoomed by `scale` about the canvas centre and moved by (x, y) canvas pixels.
 * So the visible box of a clip is centred at (W/2 + x, H/2 + y) with size fit × scale.
 */
import type { ClipTransform } from '../types';
import { DEFAULT_TRANSFORM } from './transform';

export type OverlayAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'presenter-left' | 'presenter-right' | 'center' | 'full';
export type OverlaySize = 'small' | 'medium' | 'large';

export const OVERLAY_LAYOUTS: { id: OverlayAnchor; label: string; hint: string }[] = [
    { id: 'top-left', label: 'Top left', hint: 'Reaction in the top-left corner' },
    { id: 'top-right', label: 'Top right', hint: 'Reaction in the top-right corner' },
    { id: 'bottom-left', label: 'Bottom left', hint: 'Reaction in the bottom-left corner' },
    { id: 'bottom-right', label: 'Bottom right', hint: 'Reaction in the bottom-right corner' },
    { id: 'presenter-left', label: 'Presenter left', hint: 'You (portrait) standing on the left, the landscape clip behind' },
    { id: 'presenter-right', label: 'Presenter right', hint: 'You (portrait) standing on the right, the landscape clip behind' },
    { id: 'center', label: 'Centre', hint: 'In the middle of the frame' },
    { id: 'full', label: 'Full frame', hint: 'Covers the whole frame' },
];

export const OVERLAY_SIZES: { id: OverlaySize; label: string }[] = [
    { id: 'small', label: 'Small' },
    { id: 'medium', label: 'Medium' },
    { id: 'large', label: 'Large' },
];

interface Size {
    width: number;
    height: number;
}

/** Margin from the frame edge, in canvas pixels. */
export const overlayMargin = (canvas: Size) => Math.round(Math.min(canvas.width, canvas.height) * 0.035);

/** Size of a clip once fitted inside the canvas (before the overlay zoom). */
export function fittedSize(media: Partial<Size>, canvas: Size): Size {
    const w = media.width || canvas.width;
    const h = media.height || canvas.height;
    const fit = Math.min(canvas.width / w, canvas.height / h);
    return { width: w * fit, height: h * fit };
}

/** The visible box of an overlay on the canvas: left, top, width, height in canvas pixels. */
export function overlayBox(media: Partial<Size>, canvas: Size, t: Pick<ClipTransform, 'scale' | 'x' | 'y'>) {
    const fitted = fittedSize(media, canvas);
    const width = fitted.width * t.scale;
    const height = fitted.height * t.scale;
    return { left: canvas.width / 2 + t.x - width / 2, top: canvas.height / 2 + t.y - height / 2, width, height };
}

/** Transform that puts a box of `width` (height follows the clip's shape) with its top-left at (left, top). */
export function transformForBox(media: Partial<Size>, canvas: Size, box: { left: number; top: number; width: number }): Pick<ClipTransform, 'scale' | 'x' | 'y'> {
    const fitted = fittedSize(media, canvas);
    const scale = Math.max(0.05, box.width / fitted.width);
    const height = fitted.height * scale;
    return { scale: Math.round(scale * 1000) / 1000, x: Math.round(box.left + box.width / 2 - canvas.width / 2), y: Math.round(box.top + height / 2 - canvas.height / 2) };
}

/** Share of the frame an overlay takes, by size: corners use width, presenters use height. */
const CORNER_WIDTH: Record<OverlaySize, number> = { small: 0.24, medium: 0.32, large: 0.42 };
const PRESENTER_HEIGHT: Record<OverlaySize, number> = { small: 0.7, medium: 0.85, large: 0.96 };

/** The transform for a layout. Keeps flips and rotation from `current`. */
export function layoutTransform(anchor: OverlayAnchor, size: OverlaySize, media: Partial<Size>, canvas: Size, current?: Partial<ClipTransform>): ClipTransform {
    const base: ClipTransform = { ...DEFAULT_TRANSFORM, ...(current || {}), animation: 'none' };
    const fitted = fittedSize(media, canvas);
    const m = overlayMargin(canvas);
    if (anchor === 'full') {
        const cover = Math.max(canvas.width / fitted.width, canvas.height / fitted.height);
        return { ...base, scale: Math.round(cover * 1000) / 1000, x: 0, y: 0 };
    }
    let width: number;
    if (anchor === 'presenter-left' || anchor === 'presenter-right') {
        width = (canvas.height * PRESENTER_HEIGHT[size] * fitted.width) / fitted.height;
    } else {
        // In a portrait frame a corner overlay needs a larger share of the narrow width.
        const portrait = canvas.height > canvas.width;
        width = canvas.width * CORNER_WIDTH[size] * (portrait ? 1.35 : 1);
    }
    width = Math.min(width, canvas.width - 2 * m);
    const height = (width * fitted.height) / fitted.width;
    const left = {
        'top-left': m,
        'bottom-left': m,
        'presenter-left': m,
        'top-right': canvas.width - m - width,
        'bottom-right': canvas.width - m - width,
        'presenter-right': canvas.width - m - width,
        center: (canvas.width - width) / 2,
    }[anchor];
    const top = {
        'top-left': m,
        'top-right': m,
        'bottom-left': canvas.height - m - height,
        'bottom-right': canvas.height - m - height,
        // Presenters stand on the bottom edge, like someone in front of a screen.
        'presenter-left': canvas.height - height,
        'presenter-right': canvas.height - height,
        center: (canvas.height - height) / 2,
    }[anchor];
    return { ...base, ...transformForBox(media, canvas, { left, top, width }) };
}

/** Layout for a newly added overlay: a portrait clip over a landscape frame stands as a presenter. */
export function defaultLayout(media: Partial<Size>, canvas: Size): OverlayAnchor {
    const portraitClip = (media.height || 0) > (media.width || 0);
    return portraitClip && canvas.width > canvas.height ? 'presenter-right' : 'bottom-right';
}

/** Snaps a dragged box to the frame margins, edges and centre when within `threshold` pixels. */
export function snapBox(box: { left: number; top: number; width: number; height: number }, canvas: Size, threshold: number) {
    const m = overlayMargin(canvas);
    const xs = [m, 0, (canvas.width - box.width) / 2, canvas.width - box.width - m, canvas.width - box.width];
    const ys = [m, 0, (canvas.height - box.height) / 2, canvas.height - box.height - m, canvas.height - box.height];
    const near = (value: number, options: number[]) => options.reduce((best, o) => (Math.abs(o - value) < Math.abs(best - value) ? o : best), value);
    const left = near(box.left, xs);
    const top = near(box.top, ys);
    return { ...box, left: Math.abs(left - box.left) <= threshold ? left : box.left, top: Math.abs(top - box.top) <= threshold ? top : box.top };
}
