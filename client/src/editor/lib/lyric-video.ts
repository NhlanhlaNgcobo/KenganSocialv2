/**
 * Lyric video generator helpers: background loop presets, free lyric timing (SRT, LRC, pasted
 * text placed on the song, tap-along) and turning lyric lines into caption-template text.
 * Only "AI listens" goes to the server (POST /api/lyrics/analyze, costs credits).
 */
import type { AudioFeatures } from './audio-features';
import { captionLook, captionText, CAPTION_TEMPLATE_MAP } from './caption-templates';
import type { LyricAnalysis, LyricLine, LyricWord } from './lyrics';
import type { TextElement } from '../types';

// ---------------------------------------------------------------------------------------------
// Background loops (client/public/lyric-loops, built by scripts/build-lyric-loops.mjs)
// ---------------------------------------------------------------------------------------------
export interface LoopPreset {
    id: string;
    name: string;
    seconds: number;
    files: Partial<Record<'vertical' | 'landscape', { video: string; poster: string }>>;
}

export async function loadLoopPresets(): Promise<LoopPreset[]> {
    const response = await fetch('/lyric-loops/manifest.json');
    if (!response.ok) throw new Error('Background presets are not available.');
    return response.json();
}

/** The loop file that fits the canvas: vertical for 9:16 and 1:1, landscape for 16:9. */
export function loopFileFor(preset: LoopPreset, width: number, height: number) {
    return (width > height ? preset.files.landscape : preset.files.vertical) || preset.files.vertical || preset.files.landscape || null;
}

/** Search words for loop-friendly stock video (Pexels). */
export const STOCK_LOOP_QUERIES = [
    { id: 'abstract', label: 'Abstract', query: 'abstract loop background' },
    { id: 'neon', label: 'Neon', query: 'neon lights loop' },
    { id: 'particles', label: 'Particles', query: 'particles background loop' },
    { id: 'clouds', label: 'Clouds', query: 'clouds timelapse sky' },
    { id: 'ocean', label: 'Ocean', query: 'ocean waves slow motion' },
    { id: 'city', label: 'City night', query: 'city lights night bokeh' },
    { id: 'smoke', label: 'Smoke', query: 'smoke ink black background' },
    { id: 'nature', label: 'Nature', query: 'forest light rays' },
];

/**
 * Zoom that makes a picture fill the canvas. The export fits media inside the frame
 * (letterboxing), so a background is scaled up until no bars remain.
 */
export function coverScale(mediaW: number, mediaH: number, canvasW: number, canvasH: number) {
    if (!mediaW || !mediaH) return 1;
    const fit = Math.min(canvasW / mediaW, canvasH / mediaH);
    const cover = Math.max(canvasW / mediaW, canvasH / mediaH);
    return Math.round((cover / fit) * 1000) / 1000;
}

// ---------------------------------------------------------------------------------------------
// Lyric lines from text, SRT, LRC
// ---------------------------------------------------------------------------------------------
export interface TimedLine {
    text: string;
    start: number;
    end: number;
}

const cleanLine = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').replace(/\s+/g, ' ').trim();

/** "00:01:02,500" or "01:02.5" → seconds. */
function clock(value: string) {
    const parts = value.trim().replace(',', '.').split(':').map(Number);
    if (parts.some((n) => !Number.isFinite(n))) return NaN;
    return parts.reduce((total, n) => total * 60 + n, 0);
}

export function parseSrt(text: string): TimedLine[] {
    const lines: TimedLine[] = [];
    for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
        const rows = block.split('\n').filter(Boolean);
        const timing = rows.findIndex((r) => r.includes('-->'));
        if (timing < 0) continue;
        const [a, b] = rows[timing].split('-->');
        const start = clock(a);
        const end = clock(b.split(/\s/).filter(Boolean)[0] || '');
        const words = cleanLine(rows.slice(timing + 1).join(' '));
        if (words && Number.isFinite(start) && Number.isFinite(end) && end > start) lines.push({ text: words, start, end });
    }
    return lines.sort((x, y) => x.start - y.start);
}

export function parseLrc(text: string, songDuration: number): TimedLine[] {
    const stamped: { text: string; start: number }[] = [];
    for (const row of text.replace(/\r/g, '').split('\n')) {
        // [mm:ss], [mm:ss.xx] or [mm:ss:xx]; a line can carry several stamps (repeated chorus).
        const stamps = [...row.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
        const words = cleanLine(row.replace(/\[[^\]]*\]/g, ''));
        for (const [, m, s, frac] of stamps) {
            stamped.push({ text: words, start: Number(m) * 60 + Number(s) + (frac ? Number(`0.${frac}`) : 0) });
        }
    }
    stamped.sort((a, b) => a.start - b.start);
    return stamped
        .map((line, i) => ({ text: line.text, start: line.start, end: Math.min(stamped[i + 1]?.start ?? line.start + 4, line.start + 8, songDuration || Infinity) }))
        .filter((line) => line.text && line.end > line.start);
}

// ---------------------------------------------------------------------------------------------
// Paragraphs → singable lines
// ---------------------------------------------------------------------------------------------
const SECTION_LABEL = /^\s*[[(]?\s*(intro|verse|pre-?chorus|chorus|hook|bridge|refrain|outro|interlude|breakdown|post-?chorus)\b[^\])]*[\])]?\s*:?\s*$/i;
const I_WORDS = /^(I|I'm|I'll|I've|I'd|I’m|I’ll|I’ve|I’d)$/;
const LONG_LINE = 12; // words: anything longer was pasted as a paragraph

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Words that often begin a sung line; preferred break points in unpunctuated lowercase text. */
const LINE_STARTERS = new Set(['i', "i'm", 'im', "i'll", "i've", 'you', "you're", 'we', "we're", 'they', 'she', 'he', 'and', 'but', 'so', 'cause', "'cause", 'when', 'now', 'no', 'never', 'oh', 'baby', 'yeah', 'if', 'just', 'tell', 'let', 'my', 'every', 'all', 'this']);
const MAX_LINE = 9; // words before a forced break

/** Keeps comma pieces of at least 3 words (a 2-word fragment joins the next piece). */
function splitCommas(line: string): string[] {
    const out: string[] = [];
    let current = '';
    for (const part of line.split(/(?<=,)\s+/)) {
        current = current ? `${current} ${part}` : part;
        if (wordCount(current) >= 3) {
            out.push(current);
            current = '';
        }
    }
    if (current) out.length ? (out[out.length - 1] += ` ${current}`) : out.push(current);
    return out;
}

/** A long run with no cues: break before a likely line start once there are ~5 words, at 9 at most. */
function splitRun(line: string): string[] {
    const out: string[] = [];
    let current: string[] = [];
    for (const word of line.split(/\s+/).filter(Boolean)) {
        const starter = LINE_STARTERS.has(word.toLowerCase().replace(/[^a-z']/g, ''));
        if (current.length >= MAX_LINE || (starter && current.length >= 5)) {
            out.push(current.join(' '));
            current = [];
        }
        current.push(word);
    }
    if (current.length) out.push(current.join(' '));
    return out;
}

/** One over-long line → lyric lines: full stops, capitalised line starts, commas, then likely line starts. */
function breakParagraph(line: string): string[] {
    const lines: string[] = [];
    for (const sentence of line.split(/(?<=[.!?;])\s+/)) {
        // Lyrics usually capitalise each line: split before a capital once the line has some words.
        let current: string[] = [];
        for (const word of sentence.split(/\s+/).filter(Boolean)) {
            if (/^[A-Z]/.test(word) && current.length >= (I_WORDS.test(word) ? 4 : 3)) {
                // "…loved me, and / I believed" reads better as "…loved me, / and I believed".
                const carry = /^(and|but|so|or|then|cause|'cause)$/i.test(current[current.length - 1]) ? current.splice(-1) : [];
                lines.push(current.join(' '));
                current = carry;
            }
            current.push(word);
        }
        if (current.length) lines.push(current.join(' '));
    }
    return lines.flatMap((l) => (wordCount(l) <= MAX_LINE ? [l] : splitCommas(l))).flatMap((l) => (wordCount(l) <= LONG_LINE - 2 ? [l] : splitRun(l)));
}

/**
 * Lyrics as one lyric line per row, blank rows between sections. Lyrics pasted as a paragraph
 * (or copied from a site that lost the line breaks) are split into singable lines, and labels
 * like "[Chorus]" become section breaks. Lines already short are left exactly as typed.
 */
export function splitLyricLines(text: string): { text: string; changed: boolean; lines: number } {
    const out: string[] = [];
    let changed = false;
    for (const raw of text.replace(/\r/g, '').split('\n')) {
        const line = raw.replace(/\s+/g, ' ').trim();
        if (!line || SECTION_LABEL.test(line)) {
            if (line) changed = true;
            if (out.length && out[out.length - 1] !== '') out.push('');
            continue;
        }
        if (wordCount(line) > LONG_LINE) {
            out.push(...breakParagraph(line));
            changed = true;
        } else out.push(line);
    }
    while (out[out.length - 1] === '') out.pop();
    return { text: out.join('\n'), changed, lines: out.filter(Boolean).length };
}

export const looksLikeSrt = (text: string) => /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(text);
export const looksLikeLrc = (text: string) => /^\s*\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/m.test(text);

/**
 * Places pasted lyrics on the song without AI (free): lines share the sung part of the song in
 * proportion to their length, blank lines become short pauses between sections, and starts snap
 * to the beat when a tempo was found. Close enough to fine-tune with the nudge buttons or tap-along.
 */
export function placeLyrics(text: string, features: AudioFeatures | null, duration: number): TimedLine[] {
    const blocks = text
        .replace(/\r/g, '')
        .split(/\n\s*\n/)
        .map((b) => b.split('\n').map(cleanLine).filter(Boolean))
        .filter((b) => b.length);
    const rows = blocks.flatMap((b, i) => b.map((t, j) => ({ text: t, breakBefore: i > 0 && j === 0 })));
    if (!rows.length || !(duration > 0)) return [];

    // Where singing likely starts and ends: the first and last sustained loud stretch.
    let start = 0;
    let end = duration;
    if (features?.envelope?.length) {
        const env = features.envelope;
        const rate = features.envelopeRate;
        const win = Math.max(1, Math.round(rate)); // 1-second average
        const avg = (i: number) => {
            let s = 0;
            for (let k = i; k < Math.min(env.length, i + win); k++) s += env[k];
            return s / win;
        };
        const sorted = Array.from(env).sort((a, b) => a - b);
        const loud = sorted[Math.floor(sorted.length * 0.6)] || 0.3;
        for (let i = 0; i < env.length; i += Math.max(1, Math.round(rate / 4))) {
            if (avg(i) >= loud) {
                start = i / rate;
                break;
            }
        }
        for (let i = env.length - win; i > 0; i -= Math.max(1, Math.round(rate / 4))) {
            if (avg(i) >= loud * 0.8) {
                end = (i + win) / rate;
                break;
            }
        }
        start = Math.min(start, duration * 0.25);
        end = Math.max(end, start + Math.min(duration - start, rows.length * 1.5));
    }

    const beat = features?.bpm ? 60 / features.bpm : 0;
    const pause = beat ? beat * 2 : 1.5;
    const weights = rows.map((r) => Math.max(8, r.text.length) + 6);
    const pauses = rows.filter((r) => r.breakBefore).length * pause;
    const usable = Math.max(rows.length * 0.8, end - start - pauses);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    // A few pasted lines shouldn't stretch across the whole song: about 6 s for an average line at most.
    const perUnit = Math.min(usable / totalWeight, 6 / (totalWeight / rows.length));
    const snap = (t: number) => (beat ? start + Math.round((t - start) / beat) * beat : t);

    let cursor = start;
    const lines: TimedLine[] = [];
    rows.forEach((row, i) => {
        if (row.breakBefore) cursor += pause;
        const lineStart = Math.max(lines.at(-1)?.end ?? 0, snap(cursor));
        cursor += weights[i] * perUnit;
        lines.push({ text: row.text, start: lineStart, end: Math.max(lineStart + 0.6, Math.min(duration, cursor - 0.05)) });
    });
    return lines;
}

/** Words spread through a line by length (used when there are no sung word timings). */
function spreadWords(line: TimedLine): LyricWord[] {
    const words = line.text.split(/\s+/).filter(Boolean);
    const total = words.reduce((a, w) => a + w.length + 1, 0);
    let t = line.start;
    return words.map((w) => {
        const len = ((w.length + 1) / total) * (line.end - line.start);
        const word = { text: w, start: t, end: t + len };
        t += len;
        return word;
    });
}

/** Timed lines → the analysis shape the Lyrics view and preview overlay already use. */
export function toAnalysis(lines: TimedLine[], timingSource: LyricAnalysis['timingSource']): LyricAnalysis {
    return {
        lines: lines.map((l, i): LyricLine => ({ id: `line-${i}`, text: l.text, start: l.start, end: l.end, words: spreadWords(l), section: 'verse', emphasis: [] })),
        mood: 'chill',
        keywords: [],
        suggestedStyle: 'karaoke',
        timingSource,
        analysisSource: 'heuristic',
    };
}

// ---------------------------------------------------------------------------------------------
// Lyrics → caption-template text for the timeline
// ---------------------------------------------------------------------------------------------
export type LyricTextElement = Partial<TextElement> & { content: string; startTime: number; duration: number };

/**
 * One text element per lyric line in the chosen caption template's look. Templates built for one
 * or two words at a time (punchy styles) show the line in those chunks, timed by the sung words.
 */
export function lyricElements(lines: { line: LyricLine; start: number; end: number }[], templateId: string, canvasHeight: number): LyricTextElement[] {
    const template = CAPTION_TEMPLATE_MAP[templateId];
    const chunk = template && template.words <= 2 ? template.words : 0;
    const out: LyricTextElement[] = [];
    let index = 0;
    for (const { line, start, end } of lines) {
        const scale = (end - start) / Math.max(0.01, line.end - line.start); // song → timeline time
        const pieces = chunk && line.words.length > chunk
            ? Array.from({ length: Math.ceil(line.words.length / chunk) }, (_, k) => line.words.slice(k * chunk, (k + 1) * chunk))
            : [line.words.length ? line.words : spreadWords(line)];
        pieces.forEach((words, k) => {
            const text = words.map((w) => w.text).join(' ') || line.text;
            const pieceStart = start + (words[0].start - line.start) * scale;
            const pieceEnd = k === pieces.length - 1 ? end : start + (pieces[k + 1][0].start - line.start) * scale;
            out.push({
                ...captionLook(templateId, index, text, canvasHeight),
                content: captionText(templateId, text),
                startTime: Math.max(0, pieceStart),
                duration: Math.max(0.2, pieceEnd - pieceStart),
            });
            index++;
        });
    }
    return out;
}
