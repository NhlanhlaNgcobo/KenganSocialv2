import { setTimeout as sleep } from 'node:timers/promises';
import { safeGet } from '../../utils/safe-fetch.js';
import { problem } from './validation.js';
import { AD_MOODS } from './catalog.js';
import { COMING_SOON, aiFeature } from '../../config/ai-features.ts';

const ELEVEN = 'https://api.elevenlabs.io/v1';
const TREBLO = 'https://api.treblo.com/v1';

export function providerStatus() {
    return { voice: !!process.env.ELEVENLABS_API_KEY && aiFeature('voiceover'), music: !!process.env.TREBLO_API_KEY && aiFeature('aiMusic') };
}
async function request(url, init, provider, fetcher = fetch) {
    let response;
    try { response = await fetcher(url, { ...init, signal: AbortSignal.timeout(120000) }); }
    catch { throw problem(502, `${provider} did not respond. Try again later.`); }
    if (!response.ok) {
        // Never log upstream bodies/headers: they can contain credentials or submitted copy.
        const body = await response.json().catch(() => ({}));
        if (provider === 'ElevenLabs' && body.detail?.status === 'api_key_id_used_as_api_key') throw problem(503, 'ElevenLabs is configured with a key ID instead of a secret API key. Ask your administrator to replace it.');
        const detail = response.status === 401 || response.status === 403 ? 'Check the server API key and provider permissions.' : response.status === 402 ? 'The provider account needs credits.' : response.status === 429 ? 'The provider is busy or its quota has been reached.' : 'Try again later.';
        throw problem(502, `${provider} returned ${response.status}. ${detail}`);
    }
    return response.json();
}
function key(name) {
    if (!aiFeature(name === 'ELEVENLABS_API_KEY' ? 'voiceover' : 'aiMusic')) throw problem(503, COMING_SOON);
    if (!process.env[name]) throw problem(503, `${name === 'ELEVENLABS_API_KEY' ? 'Voiceover' : 'Music'} generation is not configured on the server.`);
    return process.env[name];
}
const tidy = (value) => String(value || '').replace(/_/g, ' ').trim().slice(0, 60);
const previewUrl = (value) => (/^https:\/\/[^\s"'<>]+$/.test(value || '') ? value : '');
// The voice list rarely changes; one ElevenLabs call an hour serves every workspace.
let voiceCache = { at: 0, voices: null };
const VOICE_TTL = 60 * 60 * 1000;

/** The account's voices with what the picker shows: gender, age, accent, use and a sample to play. */
export async function listVoices(fetcher = fetch, { fresh = false } = {}) {
    if (!fresh && voiceCache.voices && Date.now() - voiceCache.at < VOICE_TTL) return voiceCache.voices;
    const data = await request(`${ELEVEN}/voices`, { headers: { 'xi-api-key': key('ELEVENLABS_API_KEY') } }, 'ElevenLabs', fetcher);
    const voices = (data.voices || []).map(v => ({
        id: v.voice_id, name: tidy(v.name), accent: tidy(v.labels?.accent), language: tidy(v.labels?.language),
        gender: tidy(v.labels?.gender), age: tidy(v.labels?.age), use: tidy(v.labels?.use_case || v.labels?.['use case']),
        description: tidy(v.labels?.description || v.description), preview: previewUrl(v.preview_url),
    })).sort((a, b) => a.name.localeCompare(b.name));
    voiceCache = { at: Date.now(), voices };
    return voices;
}
export async function createSpeech(text, voiceId, fetcher = fetch) {
    const data = await request(`${ELEVEN}/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': key('ELEVENLABS_API_KEY') },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    }, 'ElevenLabs', fetcher);
    if (!data.audio_base64) throw problem(502, 'ElevenLabs returned no audio.');
    return { audio: Buffer.from(data.audio_base64, 'base64'), alignment: data.normalized_alignment || data.alignment || null };
}
// What each mood should sound like, so a cinematic ad gets a trailer score and not generic pop.
// Covers the product ad moods (catalog.js) and the launch/tutorial video moods.
const MUSIC_STYLES = {
    ...Object.fromEntries(Object.entries(AD_MOODS).map(([id, m]) => [id, m.style])),
    hype: 'high-energy electronic with punchy drums, big drops and driving bass',
    hiphop: 'head-nodding hip hop beat, crisp drums, warm bass and a confident swagger',
    chill: 'relaxed lofi chill, warm keys, soft drums and a laid-back groove',
};
const PURPOSES = {
    ad: 'for a short product advertisement. Clean mix, space for spoken narration',
    launch: 'for a product launch video. Steady beat with clear accents so cuts can land on it',
    tutorial: 'for a software tutorial walkthrough. Unobtrusive and even, stays under on-screen instructions',
};

export function musicPrompt(mood, purpose = 'ad', subject = '') {
    const style = MUSIC_STYLES[mood] || 'bright, upbeat modern pop';
    return `${style} instrumental background music ${PURPOSES[purpose] || PURPOSES.ad}${subject ? `, for ${subject}` : ''}. No vocals.`;
}

/** Treblo takes a length range in steps of 30 seconds; asks for the smallest one that covers `seconds`. */
export function lengthRange(seconds = 30) {
    const hi = Math.min(240, Math.max(30, Math.ceil(seconds / 30) * 30));
    return [hi - 30, hi];
}

export async function startMusic(mood, fetcher = fetch, { purpose = 'ad', seconds = 30, subject = '' } = {}) {
    const data = await request(`${TREBLO}/generations/v3`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key('TREBLO_API_KEY')}` },
        body: JSON.stringify({ prompt: musicPrompt(mood, purpose, subject), instrumental: true, length_range: lengthRange(seconds), output_format: 'mp3' }),
    }, 'Treblo', fetcher);
    if (typeof data.task_id !== 'string') throw problem(502, 'Treblo returned no generation ID.');
    return data.task_id;
}
export async function waitForMusic(taskId, { fetcher = fetch, delay = sleep, attempts = 100, download = safeGet } = {}) {
    for (let i = 0; i < attempts; i++) {
        const data = await request(`${TREBLO}/generations/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${key('TREBLO_API_KEY')}` } }, 'Treblo', fetcher);
        if (data.status === 'FAILURE') throw problem(502, 'Treblo could not generate this soundtrack. Try again later.');
        if (data.status === 'SUCCESS' || data.song_paths?.length) {
            if (!data.song_paths?.[0]) throw problem(502, 'Treblo returned no soundtrack.');
            const result = await download(data.song_paths[0], { responseType: 'arraybuffer', maxBytes: 30 * 1024 * 1024, timeout: 60000 });
            return Buffer.from(result.data);
        }
        await delay(6000);
    }
    throw problem(504, 'Music generation timed out. Try again later.');
}
