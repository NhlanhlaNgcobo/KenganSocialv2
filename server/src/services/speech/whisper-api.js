/**
 * Whisper speech-to-text through an API: OpenRouter's /audio/transcriptions first (same key as
 * chat), then OpenAI's. Used by lyric videos and by clip projects for long videos.
 * Limits: 25 MB per request and about a minute per call, so long audio is sent in pieces.
 */

const PROVIDERS = {
    openrouter: { url: 'https://openrouter.ai/api/v1/audio/transcriptions', model: 'openai/whisper-1', key: () => process.env.OPENROUTER_API_KEY },
    openai: { url: 'https://api.openai.com/v1/audio/transcriptions', model: 'whisper-1', key: () => process.env.OPENAI_API_KEY },
};

/** Configured providers, OpenRouter first. */
export const whisperProviders = () => Object.keys(PROVIDERS).filter((id) => PROVIDERS[id].key());

/**
 * @param {Buffer} buffer audio
 * @param {{ filename?: string, mimetype?: string, prompt?: string, language?: string, via?: string }} opts
 * @returns {Promise<{ text: string, language: string, segments: {text, start, end, words}[], words: {text, start, end}[] }>} seconds
 */
export async function whisperTranscribe(buffer, { filename = 'audio.mp3', mimetype = 'audio/mpeg', prompt, language, via = whisperProviders()[0] } = {}) {
    const provider = PROVIDERS[via];
    if (!provider?.key()) throw new Error('No speech-to-text provider is configured.');
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimetype }), filename);
    form.append('model', provider.model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    form.append('timestamp_granularities[]', 'word');
    // Whisper only reads the last ~224 tokens of the prompt.
    if (prompt) form.append('prompt', prompt.slice(-900));
    if (language) form.append('language', language);

    const response = await fetch(provider.url, { method: 'POST', headers: { Authorization: `Bearer ${provider.key()}` }, body: form, signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Whisper (${via}) transcription failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    const { text = '', language: detected = '', segments = [], words = [] } = await response.json();
    if (!Array.isArray(words) || !Array.isArray(segments)) throw new Error(`Whisper (${via}) returned an invalid transcript.`);
    const cleanWords = words.map((w) => ({ text: typeof w.word === 'string' ? w.word.trim() : '', start: w.start, end: w.end }))
        .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= 0 && w.end >= w.start)
        .sort((a, b) => a.start - b.start);
    if (String(text).trim() && !cleanWords.length) throw new Error(`Whisper (${via}) returned speech without usable word timestamps.`);
    return {
        provider: via,
        text,
        language: detected,
        words: cleanWords,
        segments: segments
            .map((segment) => ({
                text: String(segment.text).trim(),
                start: segment.start,
                end: segment.end,
                words: cleanWords.filter((w) => w.start >= segment.start - 0.05 && w.end <= segment.end + 0.05),
            }))
            .filter((segment) => segment.text),
    };
}
