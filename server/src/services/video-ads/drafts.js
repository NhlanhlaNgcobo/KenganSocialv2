import { productImage } from './cutout.js';
import { maxWords, wordCount } from './validation.js';

/**
 * A product ad draft: the photos prepared for the 3D scene, the colours and a starting
 * voiceover script built from the creator's own words. No AI call and no website fetch,
 * so making a draft is instant and free; the creator edits the script before rendering.
 */

/** Perceived lightness 0..1 of a #rrggbb colour; 0.5 for anything else. */
function lightness(color) {
    const m = String(color || '').match(/^#([0-9a-f]{6})$/i);
    if (!m) return 0.5;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** Name and tagline, the selling points, the offer and the call to action, trimmed to fit the ad. */
export function draftScript(input) {
    const opening = input.tagline ? [sentence(input.name), sentence(input.tagline)] : [sentence(`Meet ${input.name}`)];
    const closing = [input.offer, input.cta].filter(Boolean).map(sentence);
    const points = input.points.map(sentence);
    const limit = Math.floor(maxWords(input.duration) * 0.85);
    // Drop selling points from the end until it fits, then the tagline.
    while (points.length && wordCount([...opening, ...points, ...closing].join(' ')) > limit) points.pop();
    if (wordCount([...opening, ...closing].join(' ')) > limit) opening.splice(1);
    return [...opening, ...points, ...closing].join(' ');
}

function palette(kit = {}, accent) {
    const colors = kit.colors || {};
    const bg = colors.background || '#0d0d10';
    const dark = lightness(bg) < 0.55;
    const brand = colors.primary || colors.accent || accent || (dark ? '#dcdce2' : '#1c1c22');
    return {
        bg,
        fg: colors.text || (dark ? '#f6f6f8' : '#111114'),
        accent: brand,
        accentText: lightness(brand) > 0.6 ? '#0c0c0e' : '#ffffff',
    };
}

export async function prepareDraft(input, files, kit = {}) {
    const photos = await Promise.all(files.map((file) => productImage(file.buffer)));
    const accent = photos.find((p) => p.accent)?.accent || null;
    return {
        input,
        photos: photos.map(({ src, cutout, width, height }) => ({ src, cutout, aspect: width / height })),
        palette: palette(kit, accent),
        fontFamily: (kit.fonts?.heading || kit.fonts?.body || 'Inter').split(',')[0].replace(/["']/g, '').trim() || 'Inter',
        script: draftScript(input),
        name: input.name,
        description: input.tagline,
    };
}
