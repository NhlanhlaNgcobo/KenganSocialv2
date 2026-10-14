import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

/**
 * Royalty-free music library: Kevin MacLeod's incompetech catalogue (~1,400 tracks, CC BY 4.0).
 * The catalogue is public machine-readable JSON (see https://incompetech.com/llms.txt), no API key.
 *
 * - The catalogue is cached in memory and on disk and refreshed daily; a stale copy is used if the
 *   refresh fails.
 * - Tracks are addressed by an opaque id derived from the filename. Downloads only ever go to the
 *   incompetech mp3 directory, so clients cannot make the server fetch arbitrary URLs.
 * - Downloaded mp3s are cached on disk (capped) so previews, templates and launch videos reuse them.
 */

const BASE = 'https://incompetech.com/music/royalty-free';
const CATALOG_URL = `${BASE}/pieces.json`;
const MP3_DIR = `${BASE}/mp3-royaltyfree/`;
const CACHE_DIR = path.join(process.cwd(), '.cache', 'music');
const CATALOG_FILE = path.join(CACHE_DIR, 'catalog.json');
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TRACK_BYTES = 30 * 1024 * 1024;
const MAX_CACHE_BYTES = 600 * 1024 * 1024;
const PAGE_SIZE = 30;

export const LICENSE = 'CC BY 4.0';
export const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';

// Genre ids from incompetech's genre key (genre.json).
export const GENRES = {
    2: 'African',
    3: 'Blues',
    4: 'Classical',
    5: 'Contemporary',
    6: 'Disco',
    7: 'Electronica',
    8: 'Funk',
    9: 'Holiday',
    10: 'Horror',
    11: 'Jazz',
    12: 'Latin',
    13: 'Modern',
    14: 'Musical',
    15: 'Polka',
    16: 'Pop',
    18: 'Reggae',
    19: 'Rock',
    20: 'Silent Film Score',
    21: 'Ska',
    22: 'Soundtrack',
    23: 'Stings',
    24: 'Unclassifiable',
    25: 'World',
    26: 'Urban',
};

export const MOODS = [
    'Bright', 'Bouncy', 'Uplifting', 'Grooving', 'Driving', 'Relaxed', 'Calming', 'Epic', 'Action',
    'Intense', 'Aggressive', 'Humorous', 'Mysterious', 'Mystical', 'Dark', 'Somber', 'Suspenseful', 'Eerie', 'Unnerving',
];

export const LENGTHS = {
    short: [0, 60],
    medium: [60, 180],
    long: [180, Infinity],
};

let catalog = null; // { loadedAt, tracks, byId }
let loading = null;
const downloads = new Map();

function parseLength(value) {
    const parts = String(value || '').split(':').map(Number);
    if (parts.some((n) => !Number.isFinite(n))) return 0;
    return parts.reduce((total, n) => total * 60 + n, 0);
}

function splitList(value) {
    return String(value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

export function creditFor(track) {
    return `"${track.title}" Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0 (${LICENSE_URL})`;
}

function normalize(piece) {
    const filename = typeof piece.filename === 'string' ? piece.filename.trim() : '';
    // Only plain mp3 filenames; anything with a path separator is ignored.
    if (!filename || !/\.mp3$/i.test(filename) || /[\\/]/.test(filename) || filename.includes('..')) return null;
    const duration = parseLength(piece.length);
    if (!duration) return null;
    const genreId = Number(piece.genre) || 24;
    const track = {
        id: crypto.createHash('sha1').update(filename).digest('hex').slice(0, 16),
        title: String(piece.title || filename.replace(/\.mp3$/i, '')).slice(0, 120),
        artist: 'Kevin MacLeod',
        duration,
        bpm: Number(piece.bpm) || null,
        genreId,
        genre: GENRES[genreId] || 'Unclassifiable',
        moods: splitList(piece.feel).filter((m) => MOODS.includes(m)),
        instruments: splitList(piece.instruments).slice(0, 8),
        description: String(piece.description || '').slice(0, 400),
        uploaded: String(piece.uploaded || ''),
        filename,
    };
    track.credit = creditFor(track);
    return track;
}

function index(pieces, loadedAt) {
    const tracks = [];
    const byId = new Map();
    for (const piece of Array.isArray(pieces) ? pieces : []) {
        const track = normalize(piece);
        if (!track || byId.has(track.id)) continue;
        tracks.push(track);
        byId.set(track.id, track);
    }
    // Newest first, so browsing without filters surfaces recent work.
    tracks.sort((a, b) => b.uploaded.localeCompare(a.uploaded));
    return { loadedAt, tracks, byId };
}

async function fetchCatalog() {
    const { data } = await axios.get(CATALOG_URL, { timeout: 30000, maxContentLength: 20 * 1024 * 1024, responseType: 'json' });
    if (!Array.isArray(data) || data.length < 50) throw new Error('Unexpected catalogue format');
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(data));
    return data;
}

function readDiskCatalog() {
    try {
        const stat = fs.statSync(CATALOG_FILE);
        return { data: JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8')), mtime: stat.mtimeMs };
    } catch {
        return null;
    }
}

export async function loadCatalog() {
    if (catalog && Date.now() - catalog.loadedAt < CATALOG_TTL_MS) return catalog;
    if (loading) return loading;

    loading = (async () => {
        const disk = readDiskCatalog();
        if (!catalog && disk && Date.now() - disk.mtime < CATALOG_TTL_MS) {
            catalog = index(disk.data, disk.mtime);
            return catalog;
        }
        try {
            catalog = index(await fetchCatalog(), Date.now());
        } catch (error) {
            console.warn('[Music] Catalogue refresh failed:', error.message);
            if (catalog) catalog.loadedAt = Date.now() - CATALOG_TTL_MS + 30 * 60 * 1000; // retry in 30 min
            else if (disk) catalog = index(disk.data, Date.now() - CATALOG_TTL_MS + 30 * 60 * 1000);
            else throw Object.assign(new Error('The music library is unavailable right now.'), { status: 502 });
        }
        return catalog;
    })().finally(() => {
        loading = null;
    });
    return loading;
}

export function publicTrack(track) {
    const { filename, ...rest } = track;
    return { ...rest, license: LICENSE, fileUrl: `/api/music/file/${track.id}` };
}

export async function getSummary() {
    const { tracks } = await loadCatalog();
    const counts = {};
    const moodCounts = {};
    for (const t of tracks) {
        counts[t.genreId] = (counts[t.genreId] || 0) + 1;
        for (const m of t.moods) moodCounts[m] = (moodCounts[m] || 0) + 1;
    }
    return {
        total: tracks.length,
        genres: Object.entries(GENRES)
            .map(([id, name]) => ({ id: Number(id), name, count: counts[id] || 0 }))
            .filter((g) => g.count > 0)
            .sort((a, b) => b.count - a.count),
        moods: MOODS.filter((m) => moodCounts[m]).map((name) => ({ name, count: moodCounts[name] })),
        lengths: Object.keys(LENGTHS),
        license: LICENSE,
        licenseUrl: LICENSE_URL,
        source: 'Kevin MacLeod, incompetech.com',
    };
}

function resolveGenre(value) {
    if (value === undefined || value === null || value === '') return null;
    const id = Number(value);
    if (GENRES[id]) return id;
    const match = Object.entries(GENRES).find(([, name]) => name.toLowerCase() === String(value).toLowerCase());
    return match ? Number(match[0]) : null;
}

function resolveMood(value) {
    if (!value) return null;
    return MOODS.find((m) => m.toLowerCase() === String(value).toLowerCase()) || null;
}

function matchesText(track, words) {
    if (!words.length) return true;
    const hay = `${track.title} ${track.genre} ${track.moods.join(' ')} ${track.instruments.join(' ')} ${track.description}`.toLowerCase();
    return words.every((w) => hay.includes(w));
}

function filterTracks(tracks, { genre, mood, q, length, minSeconds, maxSeconds }) {
    const genreId = resolveGenre(genre);
    const moodName = resolveMood(mood);
    const words = String(q || '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 6);
    const range = LENGTHS[length] || [0, Infinity];
    return tracks.filter(
        (t) =>
            (genreId === null || t.genreId === genreId) &&
            (!moodName || t.moods.includes(moodName)) &&
            t.duration >= Math.max(range[0], minSeconds || 0) &&
            t.duration < Math.min(range[1], maxSeconds || Infinity) &&
            matchesText(t, words)
    );
}

/** Filters the library. Every filter is optional. */
export async function searchLibrary({ genre, mood, q, length, page = 1 } = {}) {
    const { tracks } = await loadCatalog();
    const matches = filterTracks(tracks, { genre, mood, q, length });
    const pageNumber = Math.max(1, Math.min(200, Number(page) || 1));
    const start = (pageNumber - 1) * PAGE_SIZE;
    return {
        total: matches.length,
        page: pageNumber,
        pageSize: PAGE_SIZE,
        hasMore: start + PAGE_SIZE < matches.length,
        tracks: matches.slice(start, start + PAGE_SIZE).map(publicTrack),
    };
}

export async function getTrack(id) {
    if (!/^[0-9a-f]{16}$/.test(String(id))) return null;
    const { byId } = await loadCatalog();
    return byId.get(String(id)) || null;
}

/**
 * Picks a track that fits a mood for automatic use (templates, launch videos).
 * Loosens the filters step by step so it always returns something when the catalogue loads.
 * Stings are excluded unless asked for: they are a few seconds long.
 */
export async function pickTrack({ genre, mood, minSeconds = 0, maxSeconds = 300, exclude = [] } = {}) {
    const { tracks } = await loadCatalog();
    const pool = tracks.filter((t) => !exclude.includes(t.id) && (t.genreId !== 23 || resolveGenre(genre) === 23));
    const attempts = [
        { genre, mood, minSeconds, maxSeconds },
        { genre, minSeconds, maxSeconds },
        { mood, minSeconds, maxSeconds },
        { minSeconds, maxSeconds: Infinity },
    ];
    for (const filters of attempts) {
        const matches = filterTracks(pool, filters);
        // Random among the matches so re-rolls and repeat templates vary.
        if (matches.length) return matches[Math.floor(Math.random() * matches.length)];
    }
    return null;
}

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
        console.warn('[Music] Cache prune failed:', error.message);
    }
}

/** Returns a local path to the track's mp3, downloading it once. */
export async function getTrackFile(track) {
    const target = path.join(CACHE_DIR, `${track.id}.mp3`);
    if (fs.existsSync(target)) {
        const now = new Date();
        fs.utimes(target, now, now, () => {});
        return target;
    }
    if (downloads.has(track.id)) return downloads.get(track.id);

    const job = (async () => {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        const { data } = await axios.get(MP3_DIR + encodeURIComponent(track.filename), {
            responseType: 'arraybuffer',
            timeout: 90000,
            maxContentLength: MAX_TRACK_BYTES,
            maxRedirects: 3,
            beforeRedirect: (options) => {
                if (options.protocol !== 'https:' || options.hostname !== 'incompetech.com') throw new Error('Unexpected redirect');
            },
        });
        const buffer = Buffer.from(data);
        if (buffer.length < 1024) throw new Error('Track download was empty');
        const temp = `${target}.${process.pid}.part`;
        fs.writeFileSync(temp, buffer);
        fs.renameSync(temp, target);
        pruneCache();
        return target;
    })().finally(() => downloads.delete(track.id));

    downloads.set(track.id, job);
    return job;
}
