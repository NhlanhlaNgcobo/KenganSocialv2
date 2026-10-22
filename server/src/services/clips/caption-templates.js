/**
 * Caption templates for short clips, burned in with libass (FFmpeg's `subtitles` filter).
 *
 * The presets follow the look of popular short-form caption styles and are modelled on
 * the open-source OpenShorts caption presets and pycaps templates (both MIT, see
 * THIRD_PARTY_NOTICES.md). Fonts are bundled in server/assets/fonts (SIL Open Font Licence).
 *
 * Modes:
 *  static    - the phrase appears as a block
 *  highlight - the phrase stays up and the spoken word lights up (and pops)
 *  karaoke   - the phrase fills word by word as it is spoken
 *  punch     - one word at a time, popping in
 */

import { luminance } from './brand.js';

export const CAPTION_TEMPLATES = {
    bold: {
        label: 'Bold Pop',
        description: 'Heavy white caps, the spoken word pops in yellow',
        font: 'Poppins Black', size: 0.1, upper: true, words: 3, mode: 'highlight',
        color: '#ffffff', active: '#ffe11a', outline: '#000000', outlineWidth: 0.07, shadow: 0.03, pop: 1.12,
    },
    impact: {
        label: 'Impact',
        description: 'Condensed caps with a thick outline, spoken word in green',
        font: 'Anton', size: 0.125, upper: true, words: 2, mode: 'highlight',
        color: '#ffffff', active: '#2bd86b', outline: '#000000', outlineWidth: 0.08, shadow: 0.04, pop: 1.15,
    },
    punch: {
        label: 'One Word',
        description: 'One big word at a time, punching in',
        font: 'Anton', size: 0.16, upper: true, words: 1, mode: 'punch',
        color: '#ffffff', active: '#ffffff', outline: '#000000', outlineWidth: 0.07, shadow: 0.04, pop: 1.25,
    },
    karaoke: {
        label: 'Karaoke Fill',
        description: 'The phrase fills with colour as it is spoken',
        font: 'Poppins Black', size: 0.09, upper: true, words: 4, mode: 'karaoke',
        color: '#ffcc00', idle: '#ffffff', outline: '#000000', outlineWidth: 0.07, shadow: 0.03,
    },
    highlighter: {
        label: 'Highlighter',
        description: 'Dark caption box, the spoken word in orange',
        font: 'Poppins', bold: true, size: 0.078, upper: false, words: 4, mode: 'highlight',
        color: '#ffffff', active: '#ff7a3d', box: '#000000', boxAlpha: 0.35, pop: 1,
    },
    neon: {
        label: 'Neon',
        description: 'Tall caps with a cyan glow',
        font: 'Bebas Neue', size: 0.13, upper: true, words: 3, mode: 'highlight',
        color: '#bff7ff', active: '#ffffff', outline: '#00d4ff', outlineWidth: 0.05, blur: 6, shadow: 0, pop: 1.1,
    },
    accent: {
        label: 'Accent',
        description: 'White text on a bold orange box',
        font: 'Poppins', bold: true, size: 0.085, upper: false, words: 3, mode: 'static',
        color: '#ffffff', box: '#e04a18', boxAlpha: 0, pop: 1,
    },
    clean: {
        label: 'Clean',
        description: 'Simple sentence-case captions with a soft shadow',
        font: 'Poppins', bold: true, size: 0.068, upper: false, words: 5, mode: 'static',
        color: '#ffffff', outline: '#000000', outlineWidth: 0.04, shadow: 0.04,
    },
    none: { label: 'No captions', description: 'Leave the video clean' },
};

/** Accent colour of a template, used for the hook card and progress bar. */
export function templateAccent(id) {
    const t = CAPTION_TEMPLATES[id];
    return t?.box && t.box !== '#000000' ? t.box : t?.active && t.active !== '#ffffff' ? t.active : t?.color && t.mode === 'karaoke' ? t.color : '#e04a18';
}

/**
 * A template recoloured with the brand accent: the spoken word, karaoke fill or caption box take the
 * brand colour. Text on a brand-coloured box turns black when the colour is light.
 */
export function brandTemplate(t, accent) {
    if (!t || !accent) return t;
    const light = luminance(accent) > 0.45;
    if (t.mode === 'highlight') return { ...t, active: accent };
    if (t.mode === 'karaoke') return { ...t, color: accent };
    if (t.box && t.box !== '#000000') return { ...t, box: accent, color: light ? '#111111' : '#ffffff' };
    return t;
}

/** '#rrggbb' + alpha (0 = opaque, 1 = transparent) → ASS &HAABBGGRR. */
function assColor(hex, alpha = 0) {
    const h = String(hex || '#ffffff').replace('#', '').padEnd(6, '0');
    const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    const part = (n) => n.toString(16).toUpperCase().padStart(2, '0');
    return `&H${part(a)}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

function assTime(seconds) {
    const cs = Math.max(0, Math.round(seconds * 100));
    const h = Math.floor(cs / 360000);
    const m = Math.floor((cs % 360000) / 6000);
    const s = Math.floor((cs % 6000) / 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** User/transcript text must not open override blocks or line breaks. */
function clean(text) {
    return String(text).replace(/[{}]/g, '').replace(/\\/g, '/').replace(/\s+/g, ' ').trim();
}

/** Words in the clip, grouped into short phrases; times relative to the clip start. */
function groupWords(words, start, end, maxWords) {
    const inClip = words
        .filter((w) => w.end > start && w.start < end)
        .map((w) => ({ text: clean(w.text), start: Math.max(0, w.start - start), end: Math.min(end, w.end) - start }))
        .filter((w) => w.text);
    const groups = [];
    let current = [];
    const flush = () => {
        if (current.length) groups.push(current);
        current = [];
    };
    for (const word of inClip) {
        const prev = current[current.length - 1];
        if (prev && word.start - prev.end > 0.35) flush();
        current.push(word);
        if (current.length >= maxWords || /[.!?,;:]$/.test(word.text)) flush();
    }
    flush();
    return groups.map((g, i) => {
        const next = groups[i + 1];
        const gStart = g[0].start;
        let gEnd = g[g.length - 1].end;
        // Close small gaps so captions do not flicker, and keep each one readable.
        if (next && next[0].start - gEnd < 0.3) gEnd = next[0].start;
        if (gEnd - gStart < 0.3) gEnd = gStart + 0.3;
        return { words: g, start: gStart, end: gEnd };
    });
}

function style(name, t, { W, H, unit, alignment, marginV }) {
    const fontSize = Math.round(unit * t.size);
    const boxed = Boolean(t.box);
    const outline = boxed ? Math.round(fontSize * 0.22) : Math.round(fontSize * (t.outlineWidth || 0));
    const fields = [
        name,
        t.font,
        fontSize,
        assColor(t.color),
        assColor(t.mode === 'karaoke' ? t.idle : t.active || t.color),
        boxed ? assColor(t.box, t.boxAlpha || 0) : assColor(t.outline || '#000000'),
        assColor('#000000', 0.45),
        t.bold || /Black/.test(t.font) ? -1 : 0, 0, 0, 0,
        100, 100, 0, 0,
        boxed ? 3 : 1,
        outline,
        Math.round(fontSize * (t.shadow || 0)),
        alignment,
        Math.round(W * 0.08), Math.round(W * 0.08), marginV,
        1,
    ];
    return `Style: ${fields.join(',')}`;
}

/**
 * @param {object} opts
 * @param {Array<{text:string,start:number,end:number}>} opts.words   transcript words (source time)
 * @param {{start:number,end:number,hook?:string}} opts.clip
 * @param {number} opts.length        clip duration in seconds
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {string} opts.template      CAPTION_TEMPLATES id
 * @param {boolean} opts.hookTitle
 * @param {'bottom'|'middle'} opts.position   middle sits on the seam of a split layout
 * @param {{ safeTop: number, safeBottom: number }} opts.safe   fractions of the height kept clear of app UI
 * @returns {string|null} ASS script, or null when there is nothing to draw
 */
export function buildAss({ words, clip, length, width: W, height: H, template, hookTitle, position = 'bottom', safe = { safeTop: 0.1, safeBottom: 0.2 }, brand = null }) {
    const unit = Math.min(W, H);
    const t = brandTemplate(CAPTION_TEMPLATES[template], brand?.accent);
    const captions = t && template !== 'none' && words.length;
    const hook = hookTitle && clip.hook ? clean(clip.hook) : '';
    if (!captions && !hook) return null;

    const styles = [];
    const events = [];
    const at = (start, end, styleName, text, layer = 0) => {
        const s = Math.max(0, Math.min(length, start));
        const e = Math.max(s + 0.05, Math.min(length, end));
        events.push(`Dialogue: ${layer},${assTime(s)},${assTime(e)},${styleName},,0,0,0,,${text}`);
    };

    if (captions) {
        const middle = position === 'middle';
        styles.push(style('Caption', t, { W, H, unit, alignment: middle ? 5 : 2, marginV: middle ? 0 : Math.round(H * safe.safeBottom) }));
        const blur = t.blur ? `\\blur${t.blur}` : '';
        const word = (w) => (t.upper ? w.text.toUpperCase() : w.text);
        const pop = (scale) => (scale > 1 ? `\\fscx${Math.round(scale * 100)}\\fscy${Math.round(scale * 100)}\\t(0,90,\\fscx100\\fscy100)` : '');

        for (const group of groupWords(words, clip.start, clip.end, t.words)) {
            if (t.mode === 'static') {
                at(group.start, group.end, 'Caption', `{${blur}}${group.words.map(word).join(' ')}`);
            } else if (t.mode === 'punch') {
                group.words.forEach((w, i) => {
                    const end = group.words[i + 1]?.start ?? group.end;
                    at(w.start, Math.max(end, w.start + 0.18), 'Caption', `{${blur}${pop(t.pop)}}${word(w)}`);
                });
            } else if (t.mode === 'karaoke') {
                let cursor = group.start;
                const parts = group.words.map((w, i) => {
                    const until = group.words[i + 1]?.start ?? group.end;
                    const lead = Math.max(0, w.start - cursor);
                    cursor = until;
                    return `${lead > 0.02 ? `{\\k${Math.round(lead * 100)}}` : ''}{\\kf${Math.max(1, Math.round((until - w.start) * 100))}}${word(w)}`;
                });
                at(group.start, group.end, 'Caption', `{${blur}}${parts.join(' ')}`);
            } else {
                // highlight: one event per spoken word, the active word recoloured and popped
                group.words.forEach((w, i) => {
                    const from = i === 0 ? group.start : w.start;
                    const to = group.words[i + 1]?.start ?? group.end;
                    const text = group.words
                        .map((other, j) => (j === i ? `{\\c${assColor(t.active)}${pop(t.pop)}}${word(other)}{\\r}${blur ? `{${blur}}` : ''}` : word(other)))
                        .join(' ');
                    at(from, to, 'Caption', `{${blur}}${text}`);
                });
            }
        }
    }

    if (hook) {
        const accent = brand?.accent || templateAccent(template);
        const hookText = luminance(accent) > 0.45 ? '#111111' : '#ffffff';
        styles.push(
            style('Hook', { font: 'Poppins Black', size: 0.06, color: hookText, box: accent, boxAlpha: 0.05 }, {
                W, H, unit, alignment: 8, marginV: Math.round(H * safe.safeTop),
            })
        );
        at(0, Math.min(3, length), 'Hook', `{\\fad(120,250)}${hook}`, 1);
    }

    return [
        '[Script Info]',
        'ScriptType: v4.00+',
        `PlayResX: ${W}`,
        `PlayResY: ${H}`,
        'WrapStyle: 0',
        'ScaledBorderAndShadow: yes',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        ...styles,
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        ...events,
        '',
    ].join('\n');
}
