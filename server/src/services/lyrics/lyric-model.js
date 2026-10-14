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
