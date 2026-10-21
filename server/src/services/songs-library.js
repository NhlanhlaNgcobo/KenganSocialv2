import fs from 'fs';
import path from 'path';
import axios from 'axios';

/**
 * Songs with vocals that are free to use commercially, uploaded by independent artists.
 *
 * Sources (both free, no API key):
 *  - ccMixter (https://ccmixter.org/query-api): community songs and remixes, tagged by genre and
 *    female_vocals / male_vocals, with an nsfw flag. Queried with lic=by (CC BY only).
 *  - Openverse (https://api.openverse.org): Creative Commons audio, mostly Jamendo, which tags
 *    tracks as vocal/instrumental and male/female. Anonymous use is 200 requests a day, so
 *    results are cached.
 *
 * Only CC BY, CC0 and public domain tracks are returned. ShareAlike is excluded on purpose:
 * CC 4.0 treats music synced to video as an adaptation, so a BY-SA song would force the
 * user's whole video under BY-SA. NonCommercial and NoDerivatives are excluded too.
 *
 * Tracks are addressed as ccm-<upload id> or ov-<openverse uuid>. Download URLs are always
 * resolved server-side from the source API, never taken from the client.
 */

const CCMIXTER = 'https://ccmixter.org/api/query';
const OPENVERSE = 'https://api.openverse.org/v1/audio';
const CACHE_DIR = path.join(process.cwd(), '.cache', 'songs');
const MAX_CACHE_BYTES = 600 * 1024 * 1024;
const MAX_TRACK_BYTES = 40 * 1024 * 1024;
const SEARCH_TTL_MS = 6 * 60 * 60 * 1000;
const PER_QUERY = 10;

const ALLOWED_OPENVERSE_LICENSES = new Set(['by', 'cc0', 'pdm']);

export const SONG_GENRES = [
    { id: 'hip_hop', name: 'Hip hop / Rap', openverse: 'hip hop rap' },
    { id: 'pop', name: 'Pop', openverse: 'pop' },
    { id: 'soul', name: 'R&B / Soul', openverse: 'soul rnb' },
    { id: 'rock', name: 'Rock', openverse: 'rock' },
    { id: 'electronic', name: 'Electronic', openverse: 'electronic' },
    { id: 'dance', name: 'Dance', openverse: 'dance' },
    { id: 'trip_hop', name: 'Trip hop / Chill', openverse: 'chill trip hop' },
    { id: 'jazz', name: 'Jazz', openverse: 'jazz' },
    { id: 'acoustic', name: 'Acoustic', openverse: 'acoustic' },
    { id: 'folk', name: 'Folk', openverse: 'folk' },
    { id: 'reggae', name: 'Reggae', openverse: 'reggae' },
    { id: 'latin', name: 'Latin', openverse: 'latin' },
];

export const VOCALS = ['any', 'female', 'male'];

const searchCache = new Map(); // key -> { at, value }
const trackCache = new Map(); // id -> track
const downloads = new Map();

function cached(key, load) {
    const hit = searchCache.get(key);
    if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.value;
    const value = load().catch((error) => {
        searchCache.delete(key);
        throw error;
    });
    searchCache.set(key, { at: Date.now(), value });
    if (searchCache.size > 400) searchCache.delete(searchCache.keys().next().value);
    return value;
}

function remember(track) {
    trackCache.set(track.id, track);
    if (trackCache.size > 5000) trackCache.delete(trackCache.keys().next().value);
    return track;
}

function parseLength(value) {
    const parts = String(value || '').split(':').map(Number);
    if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
    return parts.reduce((total, n) => total * 60 + n, 0);
}

function licenseLabel(url) {
    const match = /licenses\/([a-z-]+)\/([\d.]+)/i.exec(url || '');
    return match ? `CC ${match[1].toUpperCase()} ${match[2]}` : 'CC BY';
}

function creditFor({ title, artist, featuring, pageUrl, license, licenseUrl }) {
    const feat = featuring ? ` ft. ${featuring}` : '';
    return `"${title}" by ${artist}${feat} (${pageUrl}), licensed under ${license}${licenseUrl ? ` (${licenseUrl})` : ''}`;
}

// ---------------------
// ccMixter
// ---------------------

/** ccMixter's API sometimes answers with an empty body, so retry a couple of times. */
async function ccmixterQuery(params) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const { data } = await axios.get(CCMIXTER, {
                params: { f: 'jsex', ...params }, // f=json also copies the whole result into an X-JSON header, which overflows Node's parser
                timeout: 20000,
                maxContentLength: 5 * 1024 * 1024,
                responseType: 'json',
            });
            if (Array.isArray(data)) return data;
            lastError = new Error('Empty response from ccMixter');
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

function normalizeCcmixter(upload) {
    const tags = String(upload.upload_tags || '').split(',').filter(Boolean);
    const licenseUrl = String(upload.license_url || '').replace(/^http:/, 'https:');
    // Defence in depth: the query asks for lic=by, but check every result anyway.
    if (!/creativecommons\.org\/licenses\/by\//.test(licenseUrl)) return null;
    const file = (upload.files || []).find((f) => f.file_format_info?.mime_type === 'audio/mpeg' && f.download_url);
    if (!file) return null;
    const duration = parseLength(file.file_format_info?.ps);
    if (!duration) return null;
    // Songs need tagged vocals; instrumentals (used for ad soundtracks) are labelled 'none'.
    const vocals = tags.includes('female_vocals') ? 'female' : tags.includes('male_vocals') ? 'male' : tags.includes('instrumental') ? 'none' : null;
    if (!vocals) return null;

    const genre = SONG_GENRES.find((g) => tags.includes(g.id));
    const license = licenseLabel(licenseUrl);
    const track = {
        id: `ccm-${Number(upload.upload_id)}`,
        title: String(upload.upload_name || 'Untitled').slice(0, 120),
        artist: String(upload.user_real_name || upload.user_name || 'Unknown').slice(0, 80),
        featuring: String(upload.upload_extra?.featuring || '').slice(0, 120),
        duration,
        bpm: Number(upload.upload_extra?.bpm) || null,
        genre: genre?.name || 'Other',
        vocals,
        explicit: !!upload.upload_extra?.nsfw,
        description: String(upload.upload_description_plain || '').slice(0, 300),
        pageUrl: String(upload.file_page_url || '').replace(/^http:/, 'https:'),
        license,
        licenseUrl,
        source: 'ccMixter',
        downloadUrl: String(file.download_url).replace(/^http:\/\/ccmixter\.org\//, 'https://ccmixter.org/'),
    };
    track.credit = creditFor(track);
    return track;
}

async function searchCcmixter({ genre, vocals, q, page }) {
    const genders = vocals === 'any' ? ['female', 'male'] : [vocals];
    const results = await Promise.all(
        genders.map((gender) =>
            ccmixterQuery({
                lic: 'by',
                tags: [genre, `${gender}_vocals`].filter(Boolean).join(','),
                ...(q ? { search: q } : {}),
                sort: 'rank',
                limit: PER_QUERY,
                offset: (page - 1) * PER_QUERY,
            }).catch((error) => {
                console.warn('[Songs] ccMixter search failed:', error.message);
                return [];
            })
        )
    );
    const hasMore = results.some((r) => r.length === PER_QUERY);
    // Interleave female and male results so neither dominates the first screen.
    const merged = [];
    for (let i = 0; i < PER_QUERY; i++) for (const list of results) if (list[i]) merged.push(list[i]);
    return { tracks: merged.map(normalizeCcmixter).filter(Boolean), hasMore };
}

/**
 * Instrumental tracks for ad soundtracks (ccMixter, CC BY only). Cached like song searches.
 * @param {string[]} tags  extra ccMixter tags, e.g. ['electronic']
 */
export async function searchInstrumentals(tags = [], page = 1) {
    const key = `inst:${tags.join(',')}:${page}`;
    const uploads = await cached(key, () =>
        ccmixterQuery({ lic: 'by', tags: ['instrumental', ...tags].join(','), sort: 'rank', limit: 30, offset: (page - 1) * 30 })
    );
    return uploads
        .map(normalizeCcmixter)
        .filter((t) => t && t.vocals === 'none' && !t.explicit)
        .map(remember);
}

// ---------------------
// Openverse
// ---------------------

function normalizeOpenverse(item) {
    const license = String(item.license || '').toLowerCase();
    if (!ALLOWED_OPENVERSE_LICENSES.has(license) || !item.url || item.mature) return null;
    const tags = (item.tags || []).map((t) => String(t.name || '').toLowerCase());
    if (!tags.includes('vocal')) return null;
    const vocals = tags.includes('female') ? 'female' : tags.includes('male') ? 'male' : 'vocal';
    const duration = Math.round((Number(item.duration) || 0) / 1000);
    if (!duration) return null;

    const licenseName = license === 'by' ? `CC BY ${item.license_version || ''}`.trim() : license === 'cc0' ? 'CC0' : 'Public Domain';
    const track = {
        id: `ov-${item.id}`,
        title: String(item.title || 'Untitled').slice(0, 120),
        artist: String(item.creator || 'Unknown').slice(0, 80),
        featuring: '',
        duration,
        bpm: null,
        genre: (item.genres || [])[0] || 'Other',
        vocals,
        explicit: false,
        description: '',
        pageUrl: item.foreign_landing_url || '',
        license: licenseName,
        licenseUrl: item.license_url || '',
        source: item.source === 'jamendo' ? 'Jamendo' : item.source || 'Openverse',
        downloadUrl: item.url,
    };
    track.credit = creditFor(track);
    return track;
}

async function searchOpenverse({ genre, vocals, q, page }) {
    const genreTerm = SONG_GENRES.find((g) => g.id === genre)?.openverse || '';
    const query = [genreTerm, q].filter(Boolean).join(' ') || 'vocal';
    try {
        const { data } = await axios.get(`${OPENVERSE}/`, {
            // Jamendo is Openverse's music catalogue; its other audio sources are effects and recordings.
            params: { q: query, license: [...ALLOWED_OPENVERSE_LICENSES].join(','), category: 'music', source: 'jamendo', mature: false, page_size: 20, page },
            timeout: 15000,
        });
        const tracks = (data?.results || [])
            .map(normalizeOpenverse)
            .filter(Boolean)
            .filter((t) => vocals === 'any' || t.vocals === vocals);
        return { tracks, hasMore: page < (data?.page_count || 0) };
    } catch (error) {
        console.warn('[Songs] Openverse search failed:', error.response?.status || error.message);
        return { tracks: [], hasMore: false };
    }
}

// ---------------------
// Public API
// ---------------------

export function publicSong(track) {
    const { downloadUrl, ...rest } = track;
    return { ...rest, fileUrl: `/api/music/songs/file/${track.id}` };
}

export function getSongGenres() {
    return {
        genres: SONG_GENRES.map(({ id, name }) => ({ id, name })),
        vocals: VOCALS,
        licenses: ['CC BY', 'CC0', 'Public Domain'],
        sources: ['ccMixter', 'Openverse (Jamendo)'],
    };
}

/**
 * Searches both sources. Every filter is optional.
 * explicit=false (default) hides tracks the artist marked as NSFW.
 */
export async function searchSongs({ genre = '', vocals = 'any', q = '', page = 1, explicit = false } = {}) {
    const genreId = SONG_GENRES.some((g) => g.id === genre) ? genre : '';
    const vocalFilter = VOCALS.includes(vocals) ? vocals : 'any';
    const text = String(q || '').trim().slice(0, 80);
    const pageNumber = Math.max(1, Math.min(50, Number(page) || 1));
    const args = { genre: genreId, vocals: vocalFilter, q: text, page: pageNumber };

    const key = JSON.stringify(args);
    const [cc, ov] = await Promise.all([cached(`ccm:${key}`, () => searchCcmixter(args)), cached(`ov:${key}`, () => searchOpenverse(args))]);

    const seen = new Set();
    const tracks = [...cc.tracks, ...ov.tracks]
        .filter((t) => (explicit || !t.explicit) && !seen.has(t.id) && seen.add(t.id))
        .map(remember)
        .map(publicSong);

    return { page: pageNumber, hasMore: cc.hasMore || ov.hasMore, tracks };
}

export async function getSong(id) {
    const value = String(id);
    if (trackCache.has(value)) return trackCache.get(value);

    const ccm = /^ccm-(\d{1,9})$/.exec(value);
    if (ccm) {
        const [upload] = await ccmixterQuery({ ids: ccm[1] });
        const track = upload ? normalizeCcmixter(upload) : null;
        return track ? remember(track) : null;
    }

    const ov = /^ov-([0-9a-f-]{36})$/.exec(value);
    if (ov) {
        try {
            const { data } = await axios.get(`${OPENVERSE}/${ov[1]}/`, { timeout: 15000 });
            const track = normalizeOpenverse(data);
            return track ? remember(track) : null;
        } catch (error) {
            if (error.response?.status === 404) return null;
            throw error;
        }
    }
    return null;
}

/**
 * Picks a song for automatic use (templates, launch videos) that is at least `minSeconds` long.
 * Loosens the filters step by step: genre + vocals, genre, vocals, anything.
 * Random among the matches so re-rolls and repeat templates vary.
 */
export async function pickSong({ genre = '', vocals = 'any', minSeconds = 0, maxSeconds = 480, exclude = [] } = {}) {
    const attempts = [
        { genre, vocals },
        { genre, vocals: 'any' },
        { genre: '', vocals },
        { genre: '', vocals: 'any' },
    ];
    const tried = new Set();
    for (const filters of attempts) {
        const key = JSON.stringify(filters);
        if (tried.has(key)) continue;
        tried.add(key);
        for (const page of [1, 2]) {
            const { tracks, hasMore } = await searchSongs({ ...filters, page });
            const fitting = tracks.filter((t) => t.duration >= minSeconds && t.duration <= maxSeconds && !exclude.includes(t.id));
            if (fitting.length) return getSong(fitting[Math.floor(Math.random() * fitting.length)].id);
            if (!hasMore) break;
        }
    }
    return null;
}

/** Deletes the least recently used files in the cache until it is under MAX_CACHE_BYTES. */
function pruneCache() {
    try {
        const files = fs
            .readdirSync(CACHE_DIR)
            .filter((f) => f.endsWith('.mp3'))
            .map((f) => {
                const full = path.join(CACHE_DIR, f);
                const stat = fs.statSync(full);
                return { full, size: stat.size, used: stat.atimeMs || stat.mtimeMs };
            })
            .sort((a, b) => a.used - b.used);
        let total = files.reduce((sum, f) => sum + f.size, 0);
        for (const file of files) {
            if (total <= MAX_CACHE_BYTES) break;
            fs.rmSync(file.full, { force: true });
            total -= file.size;
        }
    } catch (error) {
        console.warn('[Songs] Cache prune failed:', error.message);
    }
}

function looksLikeAudio(buffer, contentType) {
    if (/^audio\//i.test(contentType || '')) return true;
    if (buffer.subarray(0, 3).toString('latin1') === 'ID3') return true;
    return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0; // MPEG frame sync
}

/** Returns a local path to the song's mp3, downloading it once. */
export async function getSongFile(track) {
    const target = path.join(CACHE_DIR, `${track.id}.mp3`);
    if (fs.existsSync(target)) {
        const now = new Date();
        fs.utimes(target, now, now, () => {});
        return target;
    }
    if (downloads.has(track.id)) return downloads.get(track.id);

    const job = (async () => {
        if (!/^https:\/\//i.test(track.downloadUrl)) throw new Error('Unsupported download URL');
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        const response = await axios.get(track.downloadUrl, {
            responseType: 'arraybuffer',
            timeout: 120000,
            maxContentLength: MAX_TRACK_BYTES,
            maxRedirects: 3,
            // ccMixter only serves files to requests coming from the track's own page (hotlink check).
            headers: track.source === 'ccMixter' && track.pageUrl ? { Referer: track.pageUrl } : {},
            beforeRedirect: (options) => {
                if (options.protocol !== 'https:') throw new Error('Unexpected redirect');
            },
        });
        const buffer = Buffer.from(response.data);
        if (buffer.length < 1024 || !looksLikeAudio(buffer, response.headers['content-type'])) throw new Error('The song download was not an audio file');
        const temp = `${target}.${process.pid}.part`;
        fs.writeFileSync(temp, buffer);
        fs.renameSync(temp, target);
        pruneCache();
        return target;
    })().finally(() => downloads.delete(track.id));

    downloads.set(track.id, job);
    return job;
}
