import fs from 'fs';
import axios from 'axios';
import { safeGet } from '../../utils/safe-fetch.js';
import { getTrack, getTrackFile, pickTrack } from '../music-library.js';

/**
 * Background music for launch videos.
 *  1. The royalty-free library (Kevin MacLeod / incompetech, CC BY 4.0): a track the user picked,
 *     or one matching their genre/mood, or the tone's default.
 *  2. Openverse (Creative Commons, commercial use allowed) if the library is unreachable.
 * /brag bundles tracks whose licence it leaves unverified, so they are not used here.
 */
const OPENVERSE = 'https://api.openverse.org/v1/audio/';
const MAX_BYTES = 15 * 1024 * 1024;

/** Default genre and mood per tone, used when the user leaves music on "Match the tone". */
export const TONE_MUSIC = {
    default: { genre: 'Electronica', mood: 'Bouncy' },
    polished: { genre: 'Modern', mood: 'Calming' },
    'yc-parody': { genre: 'Contemporary', mood: 'Uplifting' },
    chaotic: { genre: 'Rock', mood: 'Driving' },
    deadpan: { genre: 'Jazz', mood: 'Relaxed' },
    cinematic: { genre: 'Soundtrack', mood: 'Epic' },
    'app-store': { genre: 'Pop', mood: 'Bright' },
};

async function fromLibrary({ trackId, genre, mood, tone }, minSeconds) {
    const defaults = TONE_MUSIC[tone] || TONE_MUSIC.default;
    let track = trackId ? await getTrack(trackId) : null;
    if (!track) {
        track = await pickTrack({
            genre: genre || (mood ? undefined : defaults.genre),
            mood: mood || (genre ? undefined : defaults.mood),
            minSeconds: minSeconds + 1,
            maxSeconds: 300,
        });
    }
    if (!track) return null;
    const file = await getTrackFile(track);
    const buffer = fs.readFileSync(file);
    if (buffer.length > MAX_BYTES) throw new Error('Track too large to embed');
    return {
        dataUrl: `data:audio/mpeg;base64,${buffer.toString('base64')}`,
        title: track.title,
        trackId: track.id,
        credit: track.credit,
    };
}

async function fromOpenverse(query, minSeconds) {
    // Jamendo (via Openverse) has full produced songs; fall back to every source.
    const attempts = [
        { q: query, source: 'jamendo' },
        { q: 'upbeat', source: 'jamendo' },
        { q: query },
        { q: 'upbeat electronic' },
    ];
    for (const { q, source } of attempts) {
        try {
            const { data } = await axios.get(OPENVERSE, {
                params: { q, page_size: 20, license_type: 'commercial', extension: 'mp3', mature: false, ...(source ? { source } : {}) },
                timeout: 15000,
            });
            const track = (data.results || []).find((r) => r.url && (r.duration || 0) / 1000 >= minSeconds + 1 && (r.duration || 0) / 1000 <= 600);
            if (!track) continue;
            const { data: audio } = await safeGet(track.url, { responseType: 'arraybuffer', maxBytes: MAX_BYTES, timeout: 30000 });
            return {
                dataUrl: `data:audio/mpeg;base64,${Buffer.from(audio).toString('base64')}`,
                title: track.title,
                trackId: null,
                credit: String(track.attribution || `"${track.title}" by ${track.creator}`).split('. To view')[0],
            };
        } catch (error) {
            console.warn(`[Brag] Music search "${q}" failed:`, error.message);
        }
    }
    return null;
}

/**
 * @param {{ trackId?: string, genre?: string, mood?: string, tone?: string, query?: string }} choice
 * @param {number} minSeconds  the video length; the track must cover it
 */
export async function findMusic(choice, minSeconds) {
    try {
        const track = await fromLibrary(choice, minSeconds);
        if (track) return track;
    } catch (error) {
        console.warn('[Brag] Music library failed, falling back to Openverse:', error.message);
    }
    return fromOpenverse(choice.query || 'upbeat electronic', minSeconds);
}
