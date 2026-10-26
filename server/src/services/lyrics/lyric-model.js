/**
 * Lyric timing + structure heuristics. No API keys needed; the analyzer layers
 * Whisper / OpenRouter results on top of these.
 * All timestamps are seconds of *song* time.
 * The client mirrors the result type in client/src/editor/lib/lyrics.ts.
 */

export const SECTIONS = ['intro', 'verse', 'pre-chorus', 'chorus', 'bridge', 'hook', 'outro'];
export const VISUALIZER_STYLES = ['karaoke', 'kinetic', 'spotlight'];
export const MOODS = ['hype', 'uplifting', 'romantic', 'melancholic', 'aggressive', 'chill'];

const LRC_TIMESTAMP = /\[(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)\]/g;

const STOP_WORDS = new Set(
    "a an and are as at be but by for from i i'm im in is it it's its me my of oh on or so that the this to up we yeah you your ooh ah na la uh".split(' ')
);

const MOOD_LEXICON = {
    hype: ['party', 'turn', 'lit', 'money', 'run', 'fire', 'go', 'win', 'top', 'shine'],
    uplifting: ['rise', 'light', 'free', 'fly', 'hope', 'dream', 'sun', 'alive', 'together'],
    romantic: ['love', 'baby', 'heart', 'kiss', 'hold', 'touch', 'darling', 'yours'],
    melancholic: ['cry', 'tears', 'alone', 'lost', 'gone', 'cold', 'miss', 'broken', 'rain'],
    aggressive: ['fight', 'kill', 'war', 'hate', 'blood', 'rage', 'enemy', 'smoke'],
    chill: ['slow', 'easy', 'wave', 'vibe', 'ride', 'sunday', 'calm', 'float'],
};

const normalize = (text) =>
    text.toLowerCase().replace(/[^a-z0-9' ]/g, '').replace(/\s+/g, ' ').trim();

export const hasLrcTimestamps = (text) => /\[\d{1,2}:\d{1,2}(?:\.\d{1,3})?\]/.test(text);

/** Parses LRC lyrics (`[01:23.45] line`). A line with several stamps repeats. */
export function parseLrc(text, songDuration) {
    const entries = [];
    for (const rawLine of text.split(/\r?\n/)) {
        const stamps = [...rawLine.matchAll(LRC_TIMESTAMP)];
        const lineText = rawLine.replace(LRC_TIMESTAMP, '').trim();
        if (!stamps.length || !lineText) continue;
        for (const stamp of stamps) {
            entries.push({ start: Number(stamp[1]) * 60 + Number(stamp[2]), text: lineText });
        }
    }
    entries.sort((a, b) => a.start - b.start);
    return entries.map((entry, index) => ({
        text: entry.text,
        start: entry.start,
        end: entries[index + 1]?.start ?? Math.max(entry.start + 3, songDuration),
    }));
}

/** Spreads untimed lines across the song, weighted by word count. */
export function estimateLineTimings(text, songDuration, leadInSec = 0) {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !/^\[.*\]$/.test(line)); // drop "[Chorus]" headers
    if (!lines.length) return [];

    const usable = Math.max(1, songDuration - leadInSec);
    const weights = lines.map((line) => Math.max(1, line.split(/\s+/).length) + 1);
    const total = weights.reduce((sum, w) => sum + w, 0);

    let cursor = leadInSec;
    return lines.map((line, index) => {
        const span = (weights[index] / total) * usable;
        const entry = { text: line, start: cursor, end: cursor + span };
        cursor += span;
        return entry;
    });
}

/** Word timings: real ones when the transcriber gave them, else sized by character count. */
export function splitLineIntoWords(line) {
    if (line.words?.length) return line.words;
    const tokens = line.text.split(/\s+/).filter(Boolean);
    const totalChars = tokens.reduce((sum, t) => sum + t.length, 0) || 1;
    const span = Math.max(0.2, line.end - line.start);
    let cursor = line.start;
    return tokens.map((token) => {
        const duration = (token.length / totalChars) * span;
        const word = { text: token, start: cursor, end: cursor + duration };
        cursor += duration;
        return word;
    });
}

/** Repeated lines are the chorus; intro/outro at the edges; everything else verse. */
export function detectSections(lines) {
    const counts = new Map();
    for (const line of lines) {
        const key = normalize(line.text);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return lines.map((line, index) => {
        if ((counts.get(normalize(line.text)) ?? 0) >= 2) return 'chorus';
        if (index === 0 && lines.length > 4 && line.start < 8) return 'intro';
        if (index === lines.length - 1 && lines.length > 4) return 'outro';
        return 'verse';
    });
}

export function extractKeywords(lines, limit = 8) {
    const counts = new Map();
    for (const line of lines) {
        for (const token of normalize(line.text).split(' ')) {
            if (token.length < 3 || STOP_WORDS.has(token)) continue;
            counts.set(token, (counts.get(token) ?? 0) + 1);
        }
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
        .slice(0, limit)
        .map(([word]) => word);
}

export function guessMood(lines, energy) {
    const words = new Set(lines.flatMap((line) => normalize(line.text).split(' ')));
    let best = energy !== undefined && energy > 0.6 ? 'hype' : 'chill';
    let bestScore = 0;
    for (const mood of MOODS) {
        const score = MOOD_LEXICON[mood].filter((word) => words.has(word)).length;
        if (score > bestScore) {
            best = mood;
            bestScore = score;
        }
    }
    return best;
}

export function suggestStyleForMood(mood) {
    if (mood === 'hype' || mood === 'aggressive') return 'kinetic';
    if (mood === 'romantic' || mood === 'melancholic') return 'spotlight';
    return 'karaoke';
}

/**
 * @param {{ text: string, start: number, end: number, words?: object[] }[]} timed
 * @param {'whisper' | 'audio-model' | 'lrc' | 'estimated'} timingSource
 * @param {number} [energy] mean loudness 0..1 from the browser
 */
export function buildHeuristicAnalysis(timed, timingSource, energy) {
    const sections = detectSections(timed);
    const keywords = extractKeywords(timed);
    const keywordSet = new Set(keywords);
    const mood = guessMood(timed, energy);

    return {
        lines: timed.map((line, index) => ({
            id: `line-${index}`,
            text: line.text,
            start: line.start,
            end: line.end,
            words: splitLineIntoWords(line),
            section: sections[index],
            emphasis: normalize(line.text).split(' ').filter((word) => keywordSet.has(word)),
        })),
        mood,
        keywords,
        suggestedStyle: suggestStyleForMood(mood),
        timingSource,
        analysisSource: 'heuristic',
    };
}

// ---------------------------------------------------------------------------------------------
// Syncing the user's own lyrics to the sung words (POST /api/lyrics/sync)
// ---------------------------------------------------------------------------------------------
const wordKey = (word) => String(word).toLowerCase().replace(/[^a-z0-9]/g, '');

function editDistance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let prev = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const cur = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = cur;
        }
    }
    return row[b.length];
}

const similarity = (a, b) => (a === b ? 1 : !a || !b ? 0 : 1 - editDistance(a, b) / Math.max(a.length, b.length));

/**
 * Times the user's lyric lines from the sung words a transcriber heard. The user's text is kept
 * exactly; each of their words is matched, in order, to the closest-sounding transcribed word a
 * little ahead (so misheard or ad-libbed words don't derail it), and unmatched words are spread
 * between their matched neighbours.
 *
 * @param {string[]} lines the user's lines
 * @param {{text: string, start: number, end: number}[]} sung transcribed words with times
 * @returns {{text, start, end, words}[]} empty when too little matched to trust
 */
export function alignLyricsToWords(lines, sung, duration) {
    const heard = sung.map((w) => ({ ...w, key: wordKey(w.text) })).filter((w) => w.key && Number.isFinite(w.start));
    const words = lines.flatMap((line, li) => line.split(/\s+/).filter(Boolean).map((text) => ({ text, li, key: wordKey(text), start: NaN, end: NaN })));
    if (!words.length || !heard.length) return [];

    let j = 0;
    let matched = 0;
    for (const word of words) {
        if (!word.key) continue;
        let best = -1;
        let bestScore = 0;
        for (let k = j; k < Math.min(heard.length, j + 12); k++) {
            const score = similarity(word.key, heard[k].key) - (k - j) * 0.01; // prefer the nearest
            if (score > bestScore) [best, bestScore] = [k, score];
        }
        if (best >= 0 && bestScore >= 0.72) {
            word.start = heard[best].start;
            word.end = heard[best].end;
            j = best + 1;
            matched++;
        }
    }
    if (matched < Math.max(2, words.length * 0.25)) return [];

    // Fill the gaps: spread unmatched words between matched neighbours (0.35 s each at the edges).
    const step = 0.35;
    for (let i = 0; i < words.length; i++) {
        if (Number.isFinite(words[i].start)) continue;
        let a = i - 1;
        while (a >= 0 && !Number.isFinite(words[a].start)) a--;
        let b = i;
        while (b < words.length && !Number.isFinite(words[b].start)) b++;
        const from = a >= 0 ? words[a].end : b < words.length ? Math.max(0, words[b].start - (b - a - 1) * step) : 0;
        const to = b < words.length ? words[b].start : Math.min(duration, from + (b - a - 1) * step);
        const each = Math.max(0.05, (to - from) / (b - a - 1));
        for (let k = a + 1; k < b; k++) {
            words[k].start = from + (k - a - 1) * each;
            words[k].end = words[k].start + each;
        }
    }

    const timed = lines.map((text, li) => {
        const own = words.filter((w) => w.li === li);
        return own.length ? { text, start: own[0].start, end: Math.max(own[0].start + 0.3, own.at(-1).end), words: own.map(({ text: t, start, end }) => ({ text: t, start, end })) } : null;
    }).filter(Boolean);
    // Never let a line start before the previous one.
    for (let i = 1; i < timed.length; i++) if (timed[i].start < timed[i - 1].start) timed[i].start = timed[i - 1].start + 0.05;
    return timed;
}

/**
 * Transcriber segments are sentence-sized; a lyric video wants sung lines. Splits each segment
 * at its words: after sentence punctuation or a comma once a line has 3+ words, or at 8 words.
 */
export function segmentsToLines(segments) {
    const out = [];
    for (const segment of segments) {
        const words = segment.words || [];
        if (words.length <= 8 && !/[.!?]\s+\S/.test(segment.text)) {
            out.push(segment);
            continue;
        }
        // Word lists carry no punctuation or capitals; the segment text does, word for word.
        const tokens = String(segment.text).trim().split(/\s+/);
        const shown = tokens.length === words.length ? tokens : words.map((w) => w.text);
        let current = [];
        const flush = () => {
            if (!current.length) return;
            out.push({ text: current.map((i) => shown[i]).join(' '), start: words[current[0]].start, end: words[current.at(-1)].end, words: current.map((i) => ({ ...words[i], text: shown[i] })) });
            current = [];
        };
        words.forEach((_, i) => {
            // A new line starts at a capitalised word (lyrics capitalise line starts), except "I".
            if (current.length >= 3 && /^[A-Z]/.test(shown[i]) && !/^I('|’|$)/.test(shown[i])) flush();
            current.push(i);
            const token = shown[i];
            if ((/[.!?]$/.test(token) && current.length >= 2) || (/,$/.test(token) && current.length >= 3) || current.length >= 8) flush();
        });
        flush();
    }
    return out;
}
