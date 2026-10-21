import path from 'path';
import { fileURLToPath } from 'url';
import { captionFrames } from './caption-motion.js';
import { evaluateKeyframes, keyframeTimes } from './keyframes.js';

/**
 * Editor text elements → one ASS subtitle script, burned in with a single libass filter.
 * Far faster than one drawtext filter per element (an edited podcast can have 1,500 captions),
 * and it supports what the editor shows: outline, box, rotation, fade and pop animations, and
 * the bundled caption fonts (assets/fonts: Anton, Bebas Neue, Poppins).
 */

export const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');

const BUNDLED = { anton: 'Anton', 'bebas neue': 'Bebas Neue', bebas: 'Bebas Neue', poppins: 'Poppins' };

/** Font family libass should ask for. Bundled fonts everywhere; Impact maps to Anton off Windows. */
function familyFor(name) {
    const key = String(name || '').toLowerCase().trim();
    if (BUNDLED[key]) return BUNDLED[key];
    if (process.platform !== 'win32') {
        if (key === 'impact') return 'Anton';
        if (key.includes('georgia')) return 'DejaVu Serif';
        if (key.includes('courier')) return 'DejaVu Sans Mono';
        return 'DejaVu Sans';
    }
    return name || 'Arial';
}

/** { hex: 'rrggbb', alpha: 0..1 } → ASS colour (&HBBGGRR&) and alpha (&HAA&, 00 = opaque). */
const assColor = (hex) => `&H${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}&`.toUpperCase();
const assAlpha = (opacity) => `&H${Math.round((1 - Math.min(1, Math.max(0, opacity))) * 255).toString(16).padStart(2, '0').toUpperCase()}&`;

function assTime(seconds) {
    const cs = Math.max(0, Math.round(seconds * 100));
    const h = Math.floor(cs / 360000);
    const m = Math.floor((cs % 360000) / 6000);
    const s = Math.floor((cs % 6000) / 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** Text must not open override blocks; newlines become ASS line breaks. */
const clean = (text) =>
    String(text)
        .replace(/[{}]/g, '')
        .replace(/\\/g, '/')
        .split(/\r?\n/)
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .join('\\N');

// libass sizes text by line height (ascent + descent); CSS and drawtext size by the em box.
const EM_TO_ASS = 1.16;

/**
 * @param {Array} items normalized text items (timeline-render.service normalizeText)
 * @param {number} W canvas width
 * @param {number} H canvas height
 */
export function buildTextAss(items, W, H, fps = 30) {
    let expandedCount = 0;
    const motionExpanded = items.flatMap((t, index) => {
        if (!t.captionMotion) return [{ ...t, layer: index }];
        if (t.captionDuration > 30) throw new Error('Animated captions must be 30 seconds or shorter. Split the caption first.');
        const frames = captionFrames(t.content, t.captionWords, t.captionMotion, t.captionDuration, `#${t.color.hex}`, `#${t.accentColor.hex}`);
        expandedCount += frames.length;
        if (expandedCount > 120000) throw new Error('Too many animated caption frames. Export a shorter selection.');
        return frames.flatMap(({ start, end, frame }) => {
            const from = Math.max(0, start - t.captionOffset);
            const to = Math.min(t.timelineEnd - t.timelineStart, end - t.captionOffset);
            if (to <= from) return [];
            return [{ ...t, layer: index, timelineStart: t.timelineStart + from, timelineEnd: t.timelineStart + to, motionFrame: frame }];
        });
    });
    // Keyframed text: one event per frame across the animated range, each with the exact values the
    // preview computes (keyframes.js). Before the first and after the last keyframe the text holds.
    const expanded = motionExpanded.flatMap((t) => {
        if (!t.keyframes) return [t];
        const times = keyframeTimes(t.keyframes);
        const base = t.elementStart ?? t.timelineStart;
        const animFrom = base + times[0];
        const animTo = base + times[times.length - 1];
        const out = [];
        const step = 1 / fps;
        let cursor = t.timelineStart;
        while (cursor < t.timelineEnd - 1e-6) {
            let next;
            if (cursor < animFrom - 1e-6) next = Math.min(animFrom, t.timelineEnd);
            else if (cursor >= animTo - 1e-6) next = t.timelineEnd;
            else next = Math.min(t.timelineEnd, animTo, base + (Math.floor((cursor - base) / step + 1e-6) + 1) * step);
            if (next <= cursor + 1e-6) next = Math.min(t.timelineEnd, cursor + step);
            out.push({ ...t, timelineStart: cursor, timelineEnd: next, kfFrame: evaluateKeyframes(t.keyframes, cursor - base) });
            cursor = next;
            expandedCount += 1;
            if (expandedCount > 120000) throw new Error('Too many animated text frames. Shorten the keyframed text or export a shorter selection.');
        }
        return out;
    });
    const events = expanded.map((t) => {
        const lines = t.content.split(/\r?\n/);
        const size = Math.round(t.fontSize * EM_TO_ASS);
        const kf = t.kfFrame || {};
        const opacity = t.opacity * (kf.opacity ?? 1);
        t = { ...t, opacity };
        const centreX = W / 2 + (kf.x ?? t.x);
        const centreY = H / 2 + (kf.y ?? t.y) + (t.motionFrame?.y || 0);
        const blockWidth = Math.max(...lines.map((l) => l.length)) * t.fontSize * 0.52;
        const [an, x] = t.align === 'left' ? [4, centreX - blockWidth / 2] : t.align === 'right' ? [6, centreX + blockWidth / 2] : [5, centreX];
        const boxed = t.background.alpha > 0;
        const tags = [
            `\\an${an}`,
            `\\pos(${x.toFixed(1)},${centreY.toFixed(1)})`,
            `\\fn${familyFor(t.fontFamily)}`,
            `\\fs${size}`,
            `\\b${t.bold ? 1 : 0}`,
            `\\1c${assColor(t.color.hex)}\\1a${assAlpha(t.color.alpha * t.opacity)}`,
        ];
        if (boxed) {
            // Style "Box" uses BorderStyle 3: the outline colour fills a box around the text.
            tags.push(`\\3c${assColor(t.background.hex)}\\3a${assAlpha(t.background.alpha * t.opacity)}`, `\\bord${Math.max(4, Math.round(t.fontSize * 0.2))}`, '\\shad0');
        } else if (t.stroke.width > 0 && t.stroke.color.alpha > 0) {
            tags.push(`\\3c${assColor(t.stroke.color.hex)}\\3a${assAlpha(t.stroke.color.alpha * t.opacity)}`, `\\bord${t.stroke.width}`, `\\shad${Math.max(1, Math.round(t.fontSize / 30))}`, `\\4a${assAlpha(0.5 * t.opacity)}`);
        } else {
            tags.push('\\bord0', `\\shad${Math.max(1, Math.round(t.fontSize / 30))}`, `\\4a${assAlpha(0.6 * t.opacity)}`);
        }
        const rotation = kf.rotation ?? t.rotation;
        if (rotation) tags.push(`\\frz${(-rotation).toFixed(2)}`);
        if (kf.scale !== undefined && !t.motionFrame) tags.push(`\\fscx${(kf.scale * 100).toFixed(2)}\\fscy${(kf.scale * 100).toFixed(2)}`);
        if (t.animation === 'fade') tags.push('\\fad(250,0)');
        if (t.animation === 'pop') tags.push('\\fad(90,0)\\fscx72\\fscy72\\t(0,140,\\fscx100\\fscy100)');
        let content = clean(t.content);
        if (t.motionFrame) {
            const frame = t.motionFrame;
            const s = frame.scale * (kf.scale ?? 1);
            tags.push(`\\fscx${(s * 100).toFixed(2)}\\fscy${(s * 100).toFixed(2)}`);
            content = frame.chunks.map((chunk, i) => {
                const alpha = assAlpha(t.opacity * t.color.alpha * frame.opacity * chunk.opacity);
                const tokenColor = chunk.color.replace('#', '');
                return `{\\1c${assColor(tokenColor)}\\alpha${alpha}\\u${chunk.underline ? 1 : 0}}${clean(chunk.text)}`
                    + (chunk.tail ? `{\\alpha&HFF&}${clean(chunk.tail)}` : '')
                    + (chunk.breakAfter ? '\\N' : i < frame.chunks.length - 1 ? ' ' : '');
            }).join('');
        }
        // Later elements draw on top, matching the editor (text tracks listed bottom-up).
        return `Dialogue: ${t.layer},${assTime(t.timelineStart)},${assTime(t.timelineEnd)},${boxed ? 'Box' : 'Text'},,0,0,0,,{${tags.join('')}}${content}`;
    });

    const style = (name, borderStyle) =>
        `Style: ${name},Arial,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,${borderStyle},0,0,5,0,0,0,1`;
    return [
        '[Script Info]',
        'ScriptType: v4.00+',
        `PlayResX: ${W}`,
        `PlayResY: ${H}`,
        'WrapStyle: 2',
        'ScaledBorderAndShadow: yes',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        style('Text', 1),
        style('Box', 3),
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        ...events,
        '',
    ].join('\n');
}
