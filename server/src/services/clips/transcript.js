/**
 * Transcript helpers for the clip finder. The Python service returns words with
 * millisecond timestamps; everything here works in seconds.
 */

const SENTENCE_END = /[.!?…]["')\]]?$/;
const MAX_SENTENCE_WORDS = 28;
const PAUSE_BREAK_SEC = 0.75;
const MAX_PROMPT_CHARS = 90000;

/** Words in seconds, sorted, without empty tokens. */
export function normalizeWords(words = []) {
    return (Array.isArray(words) ? words : [])
        .map((w) => ({
            text: String(w.text ?? w.word ?? '').trim(),
            start: Number(w.start) / 1000,
            end: Number(w.end) / 1000,
        }))
        .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start)
        .sort((a, b) => a.start - b.start);
}

/** Groups words into sentences using punctuation, long pauses and a length cap. */
export function buildSentences(words) {
    const sentences = [];
    let current = [];
    const flush = () => {
        if (!current.length) return;
        sentences.push({
            start: current[0].start,
            end: current[current.length - 1].end,
            text: current.map((w) => w.text).join(' ').replace(/\s+([,.!?;:])/g, '$1'),
        });
        current = [];
    };
    for (let i = 0; i < words.length; i += 1) {
        const word = words[i];
        const prev = current[current.length - 1];
        if (prev && word.start - prev.end >= PAUSE_BREAK_SEC) flush();
        current.push(word);
        if ((SENTENCE_END.test(word.text) && current.length >= 3) || current.length >= MAX_SENTENCE_WORDS) flush();
    }
    flush();
    return sentences;
}

const fmt = (s) => s.toFixed(1);

/**
 * Timestamped lines for the model: "[12.3-17.8] text". Very long transcripts are
 * thinned evenly so the prompt stays bounded.
 */
export function transcriptForPrompt(sentences) {
    let lines = sentences.map((s) => `[${fmt(s.start)}-${fmt(s.end)}] ${s.text}`);
    let total = lines.reduce((sum, l) => sum + l.length + 1, 0);
    if (total > MAX_PROMPT_CHARS) {
        const keepEvery = Math.ceil(total / MAX_PROMPT_CHARS);
        lines = lines.filter((_, i) => i % keepEvery === 0);
        total = lines.reduce((sum, l) => sum + l.length + 1, 0);
    }
    return lines.join('\n');
}

/** Plain text spoken between two times. */
export function textBetween(words, start, end) {
    return words
        .filter((w) => w.start >= start - 0.05 && w.end <= end + 0.05)
        .map((w) => w.text)
        .join(' ')
        .replace(/\s+([,.!?;:])/g, '$1');
}

export function formatTimestamp(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
