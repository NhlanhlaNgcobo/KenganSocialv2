import {
    MOODS,
    SECTIONS,
    VISUALIZER_STYLES,
    alignLyricsToWords,
    buildHeuristicAnalysis,
    estimateLineTimings,
    hasLrcTimestamps,
    parseLrc,
    segmentsToLines,
    splitLineIntoWords,
} from './lyric-model.js';
import {
    OPENROUTER_AUDIO_MODEL,
    OPENROUTER_MODEL,
    extractJsonObject,
    openRouterConfigured,
    requestOpenRouterText,
} from '../openrouter.js';
import { whisperProviders, whisperTranscribe } from '../speech/whisper-api.js';

/**
 * Lyric analyzer behind POST /api/lyrics/analyze.
 *
 * Timing, best source first:
 *   1. pasted LRC lyrics (exact),
 *   2. Whisper word timestamps (OpenRouter's /audio/transcriptions first, then OPENAI_API_KEY),
 *   3. an audio-capable model on OpenRouter (OPENROUTER_API_KEY, ~±1s),
 *   4. pasted plain lyrics spread across the song (estimated).
 * Structure (sections, emphasis, mood, style) comes from Claude on OpenRouter,
 * falling back to local heuristics if it's unavailable or fails.
 */

export class LyricsInputError extends Error {
    constructor(message) {
        super(message);
        this.status = 400;
    }
}

/**
 * @param {{ audio?: { buffer: Buffer, originalname: string, mimetype: string } | null, lyrics?: string, duration: number, energy?: number }} input
 */
export async function analyzeLyrics({ audio, lyrics = '', duration, energy, ai = true }) {
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new LyricsInputError('Song duration is required.');
    }

    const pasted = lyrics.trim();
    let timed = [];
    let timingSource = 'estimated';

    if (pasted && hasLrcTimestamps(pasted)) {
        timed = parseLrc(pasted, duration);
        timingSource = 'lrc';
    } else if (audio && ai) {
        ({ timed, timingSource } = await transcribe(audio, duration, pasted || undefined));
    }

    if (!timed.length && pasted) {
        timed = estimateLineTimings(pasted, duration);
        timingSource = 'estimated';
    } else if (!timed.length && !audio) {
        throw new LyricsInputError('Paste the lyrics (plain or LRC) to analyze this track.');
    } else if (!timed.length && !process.env.OPENAI_API_KEY && !openRouterConfigured()) {
        throw new LyricsInputError('Automatic transcription needs OPENAI_API_KEY or OPENROUTER_API_KEY. Paste the lyrics instead.');
    }

    if (!timed.length) {
        throw new LyricsInputError('No lyric lines were found in that track.');
    }

    const analysis = buildHeuristicAnalysis(timed, timingSource, energy);

    if (ai && openRouterConfigured()) {
        try {
            return await enrichWithClaude(analysis);
        } catch (error) {
            // Heuristics are a usable result on their own, so fall back rather than failing.
            console.warn('[Lyrics] Claude enrichment failed, using heuristics:', error.message);
        }
    }
    return analysis;
}

/**
 * POST /api/lyrics/sync: the user's own lyric lines, timed to the vocals. Whisper hears the
 * words (the lines are its spelling hint) and each of the user's words is matched to a sung
 * word, so their wording and line breaks are kept exactly. Speech-to-text only, no structuring
 * model, so it costs far less than a full analysis.
 */
export async function syncLyrics({ audio, lines, duration, energy }) {
    if (!Number.isFinite(duration) || duration <= 0) throw new LyricsInputError('Song duration is required.');
    const clean = (lines || []).map((l) => String(l).trim()).filter(Boolean).slice(0, 400);
    if (!clean.length) throw new LyricsInputError('Add the lyrics first, one line per lyric line.');
    if (!audio) throw new LyricsInputError('Upload the song to sync the lyrics to it.');
    // Whisper gives word times; if it's unavailable (no key, no credit), an audio model on
    // OpenRouter gives line times (about ±1 s), whose words are spread across each line.
    const attempts = [
        ...whisperProviders().map((via) => ['whisper', async () => (await transcribeWithWhisper(audio, clean.join('\n'), via)).flatMap((s) => s.words || [])]),
        ...(openRouterConfigured() ? [['audio-model', async () => (await transcribeWithAudioModel(audio, duration, clean.join('\n'))).flatMap((line) => splitLineIntoWords(line))]] : []),
    ];
    if (!attempts.length) throw new LyricsInputError('Syncing to the vocals needs OPENAI_API_KEY or OPENROUTER_API_KEY on the server. Use Place automatically or Tap along instead.');
    let heardAnything = false;
    for (const [timingSource, hear] of attempts) {
        try {
            const sung = await hear();
            heardAnything ||= sung.length > 0;
            const timed = alignLyricsToWords(clean, sung, duration);
            if (timed.length) return buildHeuristicAnalysis(timed, timingSource, energy);
        } catch (error) {
            console.warn(`[Lyrics] Sync via ${timingSource} failed:`, String(error.message).slice(0, 200));
        }
    }
    if (heardAnything) throw new LyricsInputError('The lyrics didn’t match the vocals well enough. Check they belong to this song, or use Tap along.');
    throw new Error('No transcriber could hear the song.');
}

/**
 * Tries each configured transcriber in order of timing quality, so one provider
 * being down (or out of credit) falls through to the next. Returns no lines when
 * none are configured or all fail, letting the caller use pasted lyrics instead.
 */
async function transcribe(audio, duration, knownLyrics) {
    const attempts = [
        ...whisperProviders().map((via) => ['whisper', async () => segmentsToLines(await transcribeWithWhisper(audio, knownLyrics, via))]),
        ['audio-model', () => openRouterConfigured() && transcribeWithAudioModel(audio, duration, knownLyrics)],
    ];

    for (const [timingSource, run] of attempts) {
        try {
            const timed = await run();
            if (timed?.length) return { timed, timingSource };
        } catch (error) {
            console.warn(`[Lyrics] ${timingSource} transcription failed:`, error.message.slice(0, 300));
        }
    }
    return { timed: [], timingSource: 'estimated' };
}

/** Whisper through OpenRouter (or OpenAI): sentence segments with word times, in seconds. */
async function transcribeWithWhisper(audio, prompt, via) {
    const { segments } = await whisperTranscribe(audio.buffer, { filename: audio.originalname, mimetype: audio.mimetype || 'audio/mpeg', prompt, via });
    return segments;
}

/** Line timings from a chat model are approximate, which is why the editor has nudge controls. */
async function transcribeWithAudioModel(audio, duration, knownLyrics) {
    const extension = audio.originalname.split('.').pop()?.toLowerCase() || 'mp3';
    const format = extension === 'm4a' ? 'mp4' : extension;

    const text = await requestOpenRouterText({
        model: OPENROUTER_AUDIO_MODEL,
        maxTokens: 8000,
        messages: [
            {
                role: 'system',
                content: [
                    'You transcribe sung lyrics from music for a lyric video.',
                    'Split the lyrics into short lines as they are sung (one phrase per line, max ~8 words).',
                    'Give each line its start and end time in seconds from the start of the audio.',
                    `The track is ${duration.toFixed(1)} seconds long; never exceed that. Skip instrumental sections.`,
                    'Return ONLY valid JSON: { "lines": [{ "text": string, "start": number, "end": number }] }',
                ].join(' '),
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: knownLyrics
                            ? `Align these known lyrics to the audio, keeping their wording:\n${knownLyrics}`
                            : 'Transcribe and time the lyrics in this track.',
                    },
                    { type: 'input_audio', input_audio: { data: audio.buffer.toString('base64'), format } },
                ],
            },
        ],
    });

    const parsed = JSON.parse(extractJsonObject(text));
    const lines = Array.isArray(parsed?.lines) ? parsed.lines : [];
    return lines
        .map((line) => ({
            text: String(line.text ?? '').trim(),
            start: Math.max(0, Math.min(Number(line.start) || 0, duration)),
            end: Math.max(0, Math.min(Number(line.end) || 0, duration)),
        }))
        .filter((line) => line.text && line.end > line.start)
        .sort((a, b) => a.start - b.start);
}

async function enrichWithClaude(analysis) {
    const numbered = analysis.lines.map((line, index) => `${index}: ${line.text}`).join('\n');

    const text = await requestOpenRouterText({
        model: OPENROUTER_MODEL,
        maxTokens: 8000,
        reasoningEffort: 'low',
        messages: [
            {
                role: 'system',
                content: [
                    'You analyze song lyrics to drive an animated lyric video.',
                    `For every numbered line, label its section (${SECTIONS.join(', ')}) and list 0-2 words from that line worth visually emphasizing.`,
                    `Pick the overall mood (${MOODS.join(', ')}), up to 8 theme keywords, and the best visualizer style:`,
                    'karaoke = word-by-word fill, kinetic = punchy scaling words for energetic tracks, spotlight = one calm centered line for emotional tracks.',
                    'Return ONLY valid JSON: { "sections": string[], "emphasis": string[][], "mood": string, "keywords": string[], "suggestedStyle": string }',
                    'sections and emphasis must each have exactly one entry per input line.',
                ].join(' '),
            },
            { role: 'user', content: numbered },
        ],
    });

    const result = JSON.parse(extractJsonObject(text));
    const sections = Array.isArray(result.sections) ? result.sections : [];
    if (sections.length !== analysis.lines.length || !sections.every((s) => SECTIONS.includes(s))) {
        throw new Error('Section list does not match the lyric lines.');
    }
    if (!MOODS.includes(result.mood) || !VISUALIZER_STYLES.includes(result.suggestedStyle)) {
        throw new Error('Unexpected mood or style value.');
    }

    return {
        ...analysis,
        lines: analysis.lines.map((line, index) => ({
            ...line,
            section: sections[index],
            emphasis: (Array.isArray(result.emphasis?.[index]) ? result.emphasis[index] : line.emphasis).map((w) => String(w).toLowerCase()),
        })),
        mood: result.mood,
        keywords: (Array.isArray(result.keywords) ? result.keywords : analysis.keywords).slice(0, 12).map(String),
        suggestedStyle: result.suggestedStyle,
        analysisSource: 'claude',
    };
}
