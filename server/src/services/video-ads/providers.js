import { setTimeout as sleep } from 'node:timers/promises';
import { safeGet } from '../../utils/safe-fetch.js';
import { problem } from './validation.js';

const ELEVEN = 'https://api.elevenlabs.io/v1';
const TREBLO = 'https://api.treblo.com/v1';

export function providerStatus() {
    return { voice: !!process.env.ELEVENLABS_API_KEY, music: !!process.env.TREBLO_API_KEY };
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
    if (!process.env[name]) throw problem(503, `${name === 'ELEVENLABS_API_KEY' ? 'Voiceover' : 'Music'} generation is not configured on the server.`);
    return process.env[name];
}
export async function listVoices(fetcher = fetch) {
    const data = await request(`${ELEVEN}/voices`, { headers: { 'xi-api-key': key('ELEVENLABS_API_KEY') } }, 'ElevenLabs', fetcher);
    return (data.voices || []).map(v => ({ id: v.voice_id, name: v.name, accent: v.labels?.accent || '', language: v.labels?.language || '' }));
}
export async function createSpeech(text, voiceId, fetcher = fetch) {
    const data = await request(`${ELEVEN}/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': key('ELEVENLABS_API_KEY') },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    }, 'ElevenLabs', fetcher);
    if (!data.audio_base64) throw problem(502, 'ElevenLabs returned no audio.');
    return { audio: Buffer.from(data.audio_base64, 'base64'), alignment: data.normalized_alignment || data.alignment || null };
}
export async function startMusic(mood, fetcher = fetch) {
    const data = await request(`${TREBLO}/generations/v3`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key('TREBLO_API_KEY')}` },
        body: JSON.stringify({ prompt: `${mood} instrumental background music for a short product advertisement. Clean mix, space for spoken narration, no vocals.`, instrumental: true, length_range: [0, 30], output_format: 'mp3' }),
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
