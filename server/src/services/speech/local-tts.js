/**
 * Local voiceover for testing: an OpenAI-style TTS server on this machine, e.g. Kokoro-82M
 * (scripts/local-ai/kokoro_server.py). Used only when TTS_BASE_URL is set; production doesn't set
 * it, so video ads keep using ElevenLabs there.
 *
 *  TTS_BASE_URL   http://127.0.0.1:8880   (local only; never a public address)
 */
import { problem } from '../video-ads/validation.js';

export const localTtsEnabled = () => !!process.env.TTS_BASE_URL;
const base = () => String(process.env.TTS_BASE_URL || '').replace(/\/+$/, '');

async function call(path, init) {
    let res;
    try {
        res = await fetch(`${base()}${path}`, { ...init, signal: AbortSignal.timeout(120000) });
    } catch {
        throw problem(502, 'The local voice server is not running. Start it (scripts/local-ai/README.md) and try again.');
    }
    if (!res.ok) throw problem(502, `The local voice server returned ${res.status}.`);
    return res;
}

/** Voices in the same shape as the ElevenLabs list the picker shows. */
export async function listLocalVoices() {
    const data = await (await call('/v1/voices')).json();
    return (data.voices || []).map((v) => ({ id: v.id, name: v.name, accent: v.language, language: v.language, gender: v.gender, age: '', use: 'local test voice', description: 'Kokoro (open source, on this PC)', preview: '' }));
}

/**
 * Kokoro gives no per-character timings, so they are estimated from the audio length: each
 * character gets an equal share, with longer pauses at punctuation. Close enough for test captions.
 */
export function estimatedAlignment(text, duration) {
    const characters = [...String(text)];
    const weight = (c) => (/[.!?]/.test(c) ? 6 : /[,;:]/.test(c) ? 3 : /\s/.test(c) ? 1.2 : 1);
    const total = characters.reduce((n, c) => n + weight(c), 0) || 1;
    const starts = [];
    const ends = [];
    let t = 0;
    for (const c of characters) {
        const d = (weight(c) / total) * duration;
        starts.push(Number(t.toFixed(3)));
        t += d;
        ends.push(Number(t.toFixed(3)));
    }
    return { characters, character_start_times_seconds: starts, character_end_times_seconds: ends, estimated: true };
}

/** { audio: mp3 Buffer, alignment } like createSpeech's ElevenLabs result. */
export async function localSpeech(text, voiceId) {
    const res = await call('/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: text, voice: voiceId || 'af_heart' }) });
    const audio = Buffer.from(await res.arrayBuffer());
    const duration = Number(res.headers.get('x-audio-duration')) || 0;
    if (!audio.length) throw problem(502, 'The local voice server returned no audio.');
    return { audio, alignment: duration ? estimatedAlignment(text, duration) : null };
}
