import fs from 'fs';
import { getSong, getSongFile, pickSong, SONG_GENRES } from '../songs-library.js';

/**
 * Background music for launch videos: songs with vocals by independent artists
 * (ccMixter + Openverse, CC BY / CC0 only; see songs-library.js).
 * A song the user picked, or one matching their genre/vocals, or the tone's default genre.
 * /brag bundles tracks whose licence it leaves unverified, so they are not used here.
 */
const MAX_BYTES = 15 * 1024 * 1024;

const genreName = (id) => SONG_GENRES.find((g) => g.id === id)?.name || id;

/** Default song genre per tone, used when the user leaves music on "Match the tone". */
export const TONE_MUSIC = Object.fromEntries(
    Object.entries({
        default: 'electronic',
        polished: 'acoustic',
        'yc-parody': 'pop',
        chaotic: 'rock',
        deadpan: 'jazz',
        cinematic: 'trip_hop',
        'app-store': 'pop',
    }).map(([tone, genre]) => [tone, { genre, genreName: genreName(genre), vocals: 'any' }])
);

/**
 * @param {{ trackId?: string, genre?: string, vocals?: string, tone?: string }} choice
 * @param {number} minSeconds  the video length; the song must cover it
 */
export async function findMusic({ trackId, genre, vocals, tone }, minSeconds) {
    const exclude = [];
    let chosen = trackId ? await getSong(trackId).catch(() => null) : null;
    // A few tries: a pick can fail to download or be too large to embed.
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const track =
                chosen && chosen.duration >= minSeconds + 1
                    ? chosen
                    : await pickSong({
                          genre: genre || (TONE_MUSIC[tone] || TONE_MUSIC.default).genre,
                          vocals: vocals || 'any',
                          minSeconds: minSeconds + 1,
                          exclude,
                      });
            chosen = null;
            if (!track) return null;
            exclude.push(track.id);
            const buffer = fs.readFileSync(await getSongFile(track));
            if (buffer.length > MAX_BYTES) continue;
            return {
                dataUrl: `data:audio/mpeg;base64,${buffer.toString('base64')}`,
                title: track.title,
                trackId: track.id,
                credit: track.credit,
            };
        } catch (error) {
            console.warn('[Brag] Music failed:', error.message);
        }
    }
    return null;
}
