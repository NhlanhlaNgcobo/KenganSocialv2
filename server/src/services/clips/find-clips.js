import { aiConfigured, generateJson } from '../gemini-json.js';
import { buildSentences, formatTimestamp, textBetween, transcriptForPrompt } from './transcript.js';

/**
 * Picks the moments in a long video that work as standalone short clips.
 *
 * With speech, a language model reads the timestamped transcript and chooses
 * self-contained moments (hook at the start, complete thought at the end), scoring
 * each one. Without speech, or if the model is unavailable, the signal-based
 * windows from the Python analysis (scene changes, speech density, faces) are used.
 */

export const CLIP_LENGTHS = {
    short: { min: 15, max: 30, label: '15–30s' },
    medium: { min: 30, max: 60, label: '30–60s' },
    long: { min: 60, max: 90, label: '60–90s' },
};

const SCORE_WEIGHTS = { hook: 0.35, flow: 0.25, value: 0.25, trend: 0.15 };

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const int = (v, fallback = 50) => clamp(Math.round(Number(v) || fallback), 0, 100);
const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function buildPrompt({ transcript, duration, count, min, max, prompt }) {
    return `You are a senior short-form video editor. You turn long videos (podcasts, interviews, talks, vlogs) into clips for TikTok, Reels and Shorts.

Below is the timestamped transcript of a ${formatTimestamp(duration)} video. Each line is "[start-end] sentence", in seconds.

Choose up to ${count} clips. Rules:
- Each clip is ${min}–${max} seconds long (end minus start is at least ${min}; usually several sentences, never a single line) and stands alone: a stranger understands it without the rest of the video.
- Start on the first word of a sentence that grabs attention in the first 2 seconds (a bold claim, a question, a surprising fact, a strong opinion, the start of a story). Never start mid-thought.
- End on the last word of a sentence that completes the thought or lands the punchline.
- Prefer moments with emotion, a clear takeaway, a story, humour or a contrarian point. Skip intros, sponsor reads, small talk and housekeeping.
- Clips must not overlap.
${prompt ? `- The user only wants moments matching this request: "${prompt}". Return fewer clips rather than ones that do not match.\n` : ''}
Score every clip 0–100 on:
- hook: how strongly the first 2 seconds stop the scroll
- flow: whether it is a complete, coherent mini-story with a clean ending
- value: how useful, funny, emotional or insightful it is to a viewer
- trend: how well the topic fits what performs on short-form social right now

Return ONLY JSON:
{"clips":[{"start":12.3,"end":41.0,"title":"short punchy title, max 60 characters","hook":"the opening line as on-screen text, max 80 characters","caption":"post caption for the clip, 1–2 sentences plus 2–4 relevant hashtags","why":"one sentence on why this clip will perform","scores":{"hook":82,"flow":71,"value":64,"trend":58}}]}
(The scores above are only an example: score each clip on its own merits.)

TRANSCRIPT:
${transcript}`;
}

/** Moves start/end onto sentence boundaries near the model's suggestion. */
function snap(clip, sentences, duration, min, max) {
    let start = clamp(Number(clip.start), 0, duration);
    let end = clamp(Number(clip.end), 0, duration);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

    if (sentences.length) {
        const startSentence = sentences.reduce((best, s) => (Math.abs(s.start - start) < Math.abs(best.start - start) ? s : best), sentences[0]);
        if (Math.abs(startSentence.start - start) <= 3) start = startSentence.start;
        const endSentence = sentences.reduce((best, s) => (Math.abs(s.end - end) < Math.abs(best.end - end) ? s : best), sentences[0]);
        if (Math.abs(endSentence.end - end) <= 4 && endSentence.end > start) end = endSentence.end;
    }

    // A little air so words are not clipped.
    start = Math.max(0, start - 0.15);
    end = Math.min(duration, end + 0.35);

    // Too short (smaller models often pick a single line): run on to the end of the sentence that
    // reaches the minimum length, so a strong opening still becomes a complete clip.
    if (end - start < min) {
        const target = Math.min(duration, start + min);
        const closing = sentences.find((s) => s.end >= target && s.end <= start + max);
        end = closing ? Math.min(duration, closing.end + 0.35) : target;
    }

    const length = end - start;
    if (length < min * 0.6) return null;
    if (length > max * 1.25) end = start + max;
    return { start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 };
}

function overlapRatio(a, b) {
    const overlap = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
    return overlap / Math.min(a.end - a.start, b.end - b.start);
}

function finalize(candidates, count) {
    const chosen = [];
    for (const clip of candidates.sort((a, b) => b.score - a.score)) {
        if (chosen.some((c) => overlapRatio(c, clip) > 0.25)) continue;
        chosen.push(clip);
        if (chosen.length >= count) break;
    }
    return chosen.map((clip, i) => ({ ...clip, id: `clip_${i + 1}`, rank: i + 1 }));
}

async function findWithModel({ words, sentences, duration, count, min, max, prompt }) {
    const raw = await generateJson(
        [{ text: buildPrompt({ transcript: transcriptForPrompt(sentences), duration, count, min, max, prompt }) }],
        { temperature: 0.4 }
    );
    const list = Array.isArray(raw?.clips) ? raw.clips : [];
    const candidates = [];
    for (const item of list.slice(0, count * 2)) {
        const range = snap(item, sentences, duration, min, max);
        if (!range) continue;
        const scores = {
            hook: int(item.scores?.hook),
            flow: int(item.scores?.flow),
            value: int(item.scores?.value),
            trend: int(item.scores?.trend),
        };
        const score = Math.round(Object.entries(SCORE_WEIGHTS).reduce((sum, [k, w]) => sum + scores[k] * w, 0));
        const transcriptText = textBetween(words, range.start, range.end);
        candidates.push({
            ...range,
            title: text(item.title, 70) || text(transcriptText, 60),
            hook: text(item.hook, 90) || text(transcriptText.split(/(?<=[.!?])\s/)[0], 90),
            caption: text(item.caption, 400),
            why: text(item.why, 200),
            scores,
            score,
            transcript: text(transcriptText, 2000),
            source: 'ai',
        });
    }
    return finalize(candidates, count);
}

/** Signal-only fallback: grows the Python analysis windows to the requested length. */
function findWithSignals({ words, signalClips, duration, count, min, max }) {
    const target = (min + max) / 2;
    let windows = (signalClips || [])
        .map((c) => ({ start: Number(c.startSec), end: Number(c.endSec), raw: Number(c.score) || 0, reason: c.reason }))
        .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start);

    if (!windows.length) {
        // Nothing detected: spread clips evenly across the video.
        const n = Math.max(1, Math.min(count, Math.floor(duration / Math.max(min, 1))));
        windows = Array.from({ length: n }, (_, i) => {
            const start = ((duration - target) * (i + 0.5)) / n;
            return { start: Math.max(0, start), end: Math.min(duration, start + target), raw: 0.3, reason: 'evenly spaced' };
        });
    }

    const maxRaw = Math.max(...windows.map((w) => w.raw), 0.01);
    const candidates = windows.map((w) => {
        const centre = (w.start + w.end) / 2;
        const length = clamp(Math.max(w.end - w.start, target), min, Math.min(max, duration));
        const start = clamp(centre - length / 2, 0, Math.max(0, duration - length));
        const end = Math.min(duration, start + length);
        const spoken = textBetween(words, start, end);
        const score = Math.round(55 + (w.raw / maxRaw) * 30);
        return {
            start: Math.round(start * 100) / 100,
            end: Math.round(end * 100) / 100,
            title: text(spoken, 60) || `Highlight at ${formatTimestamp(start)}`,
            hook: text(spoken.split(/(?<=[.!?])\s/)[0], 90),
            caption: '',
            why: w.reason ? `Picked for ${w.reason}.` : '',
            scores: null,
            score,
            transcript: text(spoken, 2000),
            source: 'signals',
        };
    });
    return finalize(candidates, count);
}

/**
 * @param {object} opts
 * @param {Array} opts.words          words in seconds (normalizeWords)
 * @param {number} opts.duration      video length in seconds
 * @param {Array} opts.signalClips    Python analysis windows ({startSec, endSec, score, reason})
 * @param {number} opts.count
 * @param {'short'|'medium'|'long'} opts.length
 * @param {string} [opts.prompt]      optional "find moments about…" request
 * @returns {Promise<{clips: Array, finder: 'ai'|'signals', note: string|null}>}
 */
export async function findClips({ words, duration, signalClips, count, length, prompt, range = null }) {
    // `range` ({ min, max } seconds) overrides the preset lengths (AI Edit's target durations).
    const { min, max } = range || CLIP_LENGTHS[length] || CLIP_LENGTHS.short;
    const effectiveMax = Math.min(max, duration);
    const effectiveMin = Math.min(min, Math.max(5, duration * 0.5));
    const sentences = buildSentences(words);
    const spokenWords = words.length;

    if (spokenWords >= 40 && aiConfigured()) {
        try {
            const clips = await findWithModel({ words, sentences, duration, count, min: effectiveMin, max: effectiveMax, prompt });
            if (clips.length) return { clips, finder: 'ai', note: null };
            if (!prompt) console.warn('[Clips] Model clip finder returned no usable clips, using signal analysis.');
            if (prompt) return { clips: [], finder: 'ai', note: `No moments matched "${prompt}".` };
        } catch (error) {
            console.warn('[Clips] Model clip finder failed, using signal analysis:', error.message);
        }
    }

    const clips = findWithSignals({ words, signalClips, duration, count, min: effectiveMin, max: effectiveMax });
    const note = spokenWords < 40
        ? 'Little or no speech was found, so clips were picked from visual activity.'
        : prompt
            ? 'The AI clip finder was unavailable, so your request could not be applied; clips were picked from visual and speech activity.'
            : 'The AI clip finder was unavailable, so clips were picked from visual and speech activity.';
    return { clips, finder: 'signals', note };
}
