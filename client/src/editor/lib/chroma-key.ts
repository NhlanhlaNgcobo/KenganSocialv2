/**
 * Green/blue screen keying for overlay clips.
 *
 * The export runs FFmpeg `chromakey` (distance in the U/V colour plane, BT.601 limited range) and
 * `despill` (mix 0.5). The preview shader in GradedCanvas runs the same maths, so what you key in
 * the preview is what you get in the file.
 */
import type { ChromaKey } from '../types';

export const KEY_PRESETS: { id: 'green' | 'blue'; label: string; color: string }[] = [
    { id: 'green', label: 'Green screen', color: '#00b140' },
    { id: 'blue', label: 'Blue screen', color: '#0047bb' },
];

export const DEFAULT_KEY: ChromaKey = { color: '#00b140', similarity: 0.15, blend: 0.08, spill: 0.6 };

export function hexToRgb(hex: string): [number, number, number] {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    const n = m ? parseInt(m[1], 16) : 0x00b140;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** U/V of a colour on FFmpeg's 0..1 scale (RGB_TO_U_CCIR / RGB_TO_V_CCIR, centred on 0). */
export function keyUv(hex: string): [number, number] {
    const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
    const k = 224 / 255;
    return [k * (-0.168736 * r - 0.331264 * g + 0.5 * b), k * (0.5 * r - 0.418688 * g - 0.081312 * b)];
}

/** Blue screens despill the blue channel; anything else is treated as green. */
export function isBlueKey(hex: string): boolean {
    const [, g, b] = hexToRgb(hex);
    return b > g;
}
