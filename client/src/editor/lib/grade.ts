import { FILTER_PREVIEW_CSS } from '../constants';
import type { ColorGrade, ColorSettings, VideoFilter } from '../types';
import { neutralColor } from './color-pipeline.js';

export const NEUTRAL_GRADE: Required<ColorGrade> = { brightness: 0, contrast: 1, saturation: 1, temperature: 0, vibrance: 0, tint: 0, highlights: 0, shadows: 0, fade: 0 };

export function isNeutralGrade(g?: ColorGrade | null): boolean {
    return !g || (!g.brightness && g.contrast === 1 && g.saturation === 1 && !g.temperature && !g.vibrance && !g.tint && !g.highlights && !g.shadows && !g.fade);
}

/**
 * CSS approximation of the renderer's grade (FFmpeg eq + colorbalance), for preview only.
 * Warmth reads as a touch of sepia; coolness as a slight hue shift towards blue.
 */
export function gradeCss(g?: ColorGrade | null): string {
    if (isNeutralGrade(g)) return '';
    const parts = [`brightness(${(1 + g!.brightness * 1.4).toFixed(3)})`, `contrast(${g!.contrast.toFixed(3)})`, `saturate(${g!.saturation.toFixed(3)})`];
    if (g!.temperature > 0) parts.push(`sepia(${(g!.temperature * 0.28).toFixed(3)})`);
    if (g!.temperature < 0) parts.push(`hue-rotate(${(-g!.temperature * 14).toFixed(1)}deg)`, `saturate(${(1 - g!.temperature * 0.05).toFixed(3)})`);
    // Approximations of the renderer's vibrance, tint and tone curve.
    if (g!.vibrance) parts.push(`saturate(${(1 + g!.vibrance * 0.35).toFixed(3)})`);
    if (g!.tint) parts.push(`hue-rotate(${(g!.tint * 9).toFixed(1)}deg)`);
    const lift = (g!.shadows || 0) * 0.05 + (g!.highlights || 0) * 0.04 + (g!.fade || 0) * 0.08;
    if (lift) parts.push(`brightness(${(1 + lift).toFixed(3)})`);
    if (g!.fade || g!.shadows || g!.highlights) parts.push(`contrast(${(1 - (g!.fade || 0) * 0.22 - (g!.shadows || 0) * 0.08 + (g!.highlights || 0) * 0.05).toFixed(3)})`);
    return parts.join(' ');
}

/** Preset filter plus grade, as one CSS filter value. */
export function previewFilter(filter: VideoFilter | undefined, grade?: ColorGrade | null): string {
    const preset = FILTER_PREVIEW_CSS[filter || 'none'];
    const adjust = gradeCss(grade);
    if (preset === 'none') return adjust || 'none';
    return adjust ? `${preset} ${adjust}` : preset;
}

/** Maps the quick grade (AI Edit, older projects) onto Lumetri settings. */
export function colorFromLegacy(g?: ColorGrade | null): ColorSettings {
    const c = neutralColor() as ColorSettings;
    if (!g) return c;
    c.basic.exposure = Math.round((g.brightness || 0) * 3 * 100) / 100;
    c.basic.contrast = Math.round(((g.contrast ?? 1) - 1) * 100);
    c.basic.saturation = Math.round((g.saturation ?? 1) * 100);
    c.basic.temperature = Math.round((g.temperature || 0) * 100);
    c.basic.tint = Math.round((g.tint || 0) * 100);
    c.basic.highlights = Math.round((g.highlights || 0) * 100);
    c.basic.shadows = Math.round((g.shadows || 0) * 100);
    c.creative.vibrance = Math.round((g.vibrance || 0) * 100);
    c.creative.fadedFilm = Math.round((g.fade || 0) * 100);
    return c;
}

