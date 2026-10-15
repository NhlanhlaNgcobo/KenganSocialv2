import fs from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { FFMPEG, run } from '../ffmpeg-runner.js';
import { getSong, getSongFile, searchInstrumentals } from '../songs-library.js';

/**
 * Soundtracks for launch and tutorial videos.
 *
 * Ads need energy, not lyrics: tracks come from ccMixter instrumentals (CC BY) picked by mood.
 * Each candidate is analysed (tempo, beat grid, loudness curve), the most energetic stretch
 * that fits the video is cut out starting on a beat (ideally where the music "drops"),
 * loudness-normalised and faded. The beat times go back to the planner so cuts land on the beat.
 */

const SAMPLE_RATE = 11025;
const HOP = 128; // ~11.6 ms
const HOP_SEC = HOP / SAMPLE_RATE;
const CACHE_DIR = path.join(process.cwd(), '.cache', 'songs');
const WORK_DIR = path.join(os.tmpdir(), 'kengan-renders');
const MAX_BYTES = 15 * 1024 * 1024;
const ANALYSIS_VERSION = 2;
// Seasonal or novelty tracks sound wrong under a product ad.
const SEASONAL = /christmas|xmas|santa|halloween|holiday|easter|valentine|jingle|birthday/i;

export const MOODS = {
    hype: { label: 'Hype', description: 'Fast electronic and trap, for bold launches', tags: [['electronic'], ['dance'], ['trap'], ['house']], bpm: [118, 150] },
    upbeat: { label: 'Upbeat', description: 'Bright pop and funk grooves', tags: [['pop'], ['funk'], ['electronic'], ['dance']], bpm: [98, 130] },
    hiphop: { label: 'Hip hop', description: 'Head-nodding beats', tags: [['hip_hop'], ['trap']], bpm: [80, 105] },
    chill: { label: 'Chill', description: 'Relaxed, warm and modern', tags: [['chill'], ['trip_hop'], ['lofi']], bpm: [70, 112] },
    cinematic: { label: 'Cinematic', description: 'Big, building, trailer feel', tags: [['orchestral'], ['soundtrack'], ['ambient'], ['electronic']], bpm: [60, 140] },
};

/** Default mood per tone (the user can override it). */
export const TONE_MOOD = {
    default: 'upbeat',
    polished: 'chill',
    'yc-parody': 'upbeat',
    chaotic: 'hype',
    deadpan: 'chill',
    cinematic: 'cinematic',
    'app-store': 'upbeat',
    tutorial: 'chill',
};

// ---------------------
// Analysis
// ---------------------

async function decode(file) {
    fs.mkdirSync(WORK_DIR, { recursive: true });
    const raw = path.join(WORK_DIR, `pcm_${uuidv4()}.f32`);
    try {
        await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-t', '420', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', raw]);
        const buf = fs.readFileSync(raw);
        return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
    } finally {
        fs.rm(raw, { force: true }, () => {});
    }
}

function smooth(values, radius) {
    const out = new Float32Array(values.length);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i > 2 * radius) sum -= values[i - 2 * radius - 1];
        out[Math.max(0, i - radius)] = sum / Math.min(i + 1, 2 * radius + 1);
    }
    return out;
}

/**
 * Tempo, beat grid and loudness curve from the samples.
 * Onsets: rectified rise of a high-passed energy envelope. Tempo: autocorrelation of the
 * onset curve, weighted towards 120 BPM, with parabolic peak refinement. Phase: the beat
 * offset that collects the most onset strength.
 */
export function analyseSamples(samples) {
    const frames = Math.floor(samples.length / HOP);
    const energy = new Float32Array(frames);
    let prev = 0;
    for (let f = 0; f < frames; f++) {
        let e = 0;
        for (let i = f * HOP; i < (f + 1) * HOP; i++) {
            // First difference = cheap high-pass, so kicks and snares dominate over pads.
            const v = samples[i] - prev;
            prev = samples[i];
            e += v * v;
        }
        energy[f] = Math.log1p(1000 * (e / HOP));
    }
    const env = smooth(energy, 2);
    const onset = new Float32Array(frames);
    for (let f = 1; f < frames; f++) onset[f] = Math.max(0, env[f] - env[f - 1]);
    let mean = 0;
    for (const v of onset) mean += v;
    mean /= Math.max(1, frames);
    const centred = Float32Array.from(onset, (v) => v - mean);

    const minLag = Math.round(60 / 180 / HOP_SEC);
    const maxLag = Math.round(60 / 60 / HOP_SEC);
    const n = Math.min(frames, Math.round(90 / HOP_SEC)); // 90s is plenty for tempo
    const acf = new Float32Array(maxLag + 2);
    for (let lag = 0; lag <= maxLag + 1; lag++) {
        let s = 0;
        for (let i = 0; i + lag < n; i++) s += centred[i] * centred[i + lag];
        acf[lag] = s;
    }
    let best = minLag;
    let bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
        const bpm = 60 / (lag * HOP_SEC);
        const weight = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
        const score = acf[lag] * weight;
        if (score > bestScore) {
            bestScore = score;
            best = lag;
        }
    }
    const [a, b, c] = [acf[best - 1], acf[best], acf[best + 1]];
    const shift = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
    const period = (best + Math.max(-0.5, Math.min(0.5, shift))) * HOP_SEC;
    const clarity = acf[0] > 0 ? Math.max(0, acf[best] / acf[0]) : 0;

    // Beat phase over the first 60s.
    const periodFrames = period / HOP_SEC;
    let phase = 0;
    let phaseScore = -Infinity;
    for (let p = 0; p < periodFrames; p += 1) {
        let s = 0;
        for (let t = p; t < Math.min(frames, 60 / HOP_SEC); t += periodFrames) s += onset[Math.round(t)] || 0;
        if (s > phaseScore) {
            phaseScore = s;
            phase = p;
        }
    }
    const duration = frames * HOP_SEC;
    const beats = [];
    for (let t = phase * HOP_SEC; t < duration; t += period) beats.push(Math.round(t * 1000) / 1000);

    // Loudness per 0.5s (from the raw signal, not the high-passed one).
    const block = Math.round(0.5 * SAMPLE_RATE);
    const loud = [];
    for (let i = 0; i + block <= samples.length; i += block) {
        let e = 0;
        for (let j = i; j < i + block; j++) e += samples[j] * samples[j];
        loud.push(Math.sqrt(e / block));
    }
    // Onset density per 0.5s: how busy the rhythm is.
    const busy = [];
    const perBlock = Math.round(0.5 / HOP_SEC);
    for (let i = 0; i + perBlock <= frames; i += perBlock) {
        let s = 0;
        for (let j = i; j < i + perBlock; j++) s += onset[j];
        busy.push(s / perBlock);
    }
    return { version: ANALYSIS_VERSION, bpm: Math.round((60 / period) * 10) / 10, period, clarity, beats, loud, busy, duration };
}

async function analyseTrack(track) {
    const file = await getSongFile(track);
    const cacheFile = path.join(CACHE_DIR, `${track.id}.analysis.json`);
    try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (cached.version === ANALYSIS_VERSION) return { file, analysis: cached };
    } catch {
        /* not analysed yet */
    }
    const analysis = analyseSamples(await decode(file));
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(analysis));
    return { file, analysis };
}

const avg = (list, from, to) => {
    let s = 0;
    let n = 0;
    for (let i = Math.max(0, from); i < Math.min(list.length, to); i++) {
        s += list[i];
        n++;
    }
    return n ? s / n : 0;
};

/**
 * The best stretch of `length` seconds: loud and busy throughout, starting on a beat,
 * ideally right where the energy jumps (a drop or chorus).
 */
export function bestSegment(analysis, length) {
    const { loud, busy, beats, period } = analysis;
    const peakLoud = Math.max(...loud, 1e-6);
    const peakBusy = Math.max(...busy, 1e-6);
    const blocks = Math.ceil(length / 0.5);
    let best = { start: 0, score: -Infinity };
    // Start on every other beat (closer to bar lines), not in the last `length` seconds.
    for (let i = 0; i < beats.length; i += 2) {
        const start = beats[i];
        if (start + length > analysis.duration - 0.5) break;
        const b = Math.floor(start / 0.5);
        const level = avg(loud, b, b + blocks) / peakLoud;
        const drive = avg(busy, b, b + blocks) / peakBusy;
        const floor = Math.min(...loud.slice(b, b + blocks)) / peakLoud; // no quiet breakdowns inside
        const jump = (avg(loud, b, b + 4) - avg(loud, b - 4, b)) / peakLoud; // energy rise at the start
        const score = level * 1.2 + drive + floor * 0.6 + Math.max(0, jump) * 0.8 - (start < period * 4 ? 0.15 : 0);
        if (score > best.score) best = { start, score, level, drive };
    }
    return best;
}

function trackScore(analysis, segment, mood) {
    const [lo, hi] = MOODS[mood].bpm;
    const bpm = analysis.bpm;
    const inRange = [bpm, bpm * 2, bpm / 2].some((b) => b >= lo && b <= hi);
    return segment.score + (inRange ? 0.5 : 0) + Math.min(0.6, analysis.clarity * 2);
}

// ---------------------
// Picking and preparing
// ---------------------

function shuffle(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

async function candidates(mood, minSeconds, exclude) {
    const seen = new Set(exclude);
    const list = [];
    for (const tags of MOODS[mood].tags) {
        const tracks = await searchInstrumentals(tags).catch(() => []);
        for (const t of tracks) {
            if (seen.has(t.id) || t.duration < minSeconds || t.duration > 600 || SEASONAL.test(`${t.title} ${t.description}`)) continue;
            seen.add(t.id);
            list.push(t);
        }
        if (list.length >= 24) break;
    }
    // Prefer tracks whose tagged tempo suits the mood, then shuffle for variety.
    const [lo, hi] = MOODS[mood].bpm;
    const fits = (t) => t.bpm && [t.bpm, t.bpm * 2, t.bpm / 2].some((b) => b >= lo && b <= hi);
    return [...shuffle(list.filter(fits)), ...shuffle(list.filter((t) => !fits(t)))];
}

/** Cuts, normalises and fades the chosen stretch; returns it as an mp3 data URL. */
async function prepare(file, start, length) {
    const out = path.join(WORK_DIR, `music_${uuidv4()}.mp3`);
    const fadeOut = Math.min(1.4, length * 0.15);
    try {
        await run(FFMPEG, [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-ss', start.toFixed(3), '-i', file, '-t', (length + 0.2).toFixed(3),
            '-af', `loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.12,afade=t=out:st=${(length - fadeOut).toFixed(2)}:d=${fadeOut.toFixed(2)}`,
            '-ac', '2', '-ar', '44100', '-b:a', '192k', out,
        ]);
        const buffer = fs.readFileSync(out);
        if (buffer.length > MAX_BYTES) throw new Error('Soundtrack too large to embed');
        return `data:audio/mpeg;base64,${buffer.toString('base64')}`;
    } finally {
        fs.rm(out, { force: true }, () => {});
    }
}

/**
 * @param {object} opts
 * @param {string} opts.mood       MOODS id
 * @param {number} opts.length     seconds of music needed
 * @param {string} [opts.trackId]  a song the user picked (analysed the same way)
 * @returns {Promise<null | { dataUrl, title, trackId, credit, bpm, start, beats: number[], mood }>}
 *          beats are relative to the start of the soundtrack
 */
export async function chooseSoundtrack({ mood = 'upbeat', length, trackId = '' }) {
    const moodId = MOODS[mood] ? mood : 'upbeat';
    const needed = length + 4;
    const started = Date.now();
    let pick = null;

    if (trackId) {
        const track = await getSong(trackId).catch(() => null);
        if (track && track.duration >= length + 1) {
            const { file, analysis } = await analyseTrack(track);
            pick = { track, file, analysis, segment: bestSegment(analysis, length) };
        }
    }

    if (!pick) {
        const pool = await candidates(moodId, needed, []);
        const scored = [];
        // Analyse a handful, within a time budget (downloads are the slow part).
        for (const track of pool.slice(0, 8)) {
            if (scored.length >= 4 || Date.now() - started > 75000) break;
            try {
                const { file, analysis } = await analyseTrack(track);
                const segment = bestSegment(analysis, length);
                if (segment.score === -Infinity) continue;
                scored.push({ track, file, analysis, segment, score: trackScore(analysis, segment, moodId) });
            } catch (error) {
                console.warn('[Soundtrack] Skipped a track:', error.message);
            }
        }
        scored.sort((a, b) => b.score - a.score);
        // A little variety between renders: either of the two best.
        pick = scored.length > 1 && Math.random() < 0.35 ? scored[1] : scored[0];
    }
    if (!pick) return null;

    const { track, file, analysis, segment } = pick;
    const start = Math.max(0, segment.start === -Infinity ? 0 : segment.start);
    const beats = analysis.beats.filter((t) => t >= start && t <= start + length).map((t) => Math.round((t - start) * 1000) / 1000);
    return {
        dataUrl: await prepare(file, start, length),
        title: track.title,
        trackId: track.id,
        credit: track.credit,
        bpm: analysis.bpm,
        start,
        beats,
        mood: moodId,
    };
}

/**
 * Moves scene boundaries onto the beat: each cut snaps to the nearest beat (every other beat
 * when the tempo is fast) as long as no scene drops below 85% of its planned length.
 * @param {{duration:number}[]} scenes
 */
export function syncScenesToBeats(scenes, beats) {
    if (!beats?.length || scenes.length < 2) return scenes;
    const period = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 0.5;
    const grid = period < 0.42 ? beats.filter((_, i) => i % 2 === 0) : beats;
    const out = scenes.map((s) => ({ ...s }));
    let cursor = 0;
    for (let i = 0; i < out.length - 1; i++) {
        const planned = cursor + out[i].duration;
        const minEnd = cursor + out[i].duration * 0.85;
        const target = grid.filter((b) => b >= minEnd).reduce((bestB, b) => (Math.abs(b - planned) < Math.abs(bestB - planned) ? b : bestB), Infinity);
        if (Number.isFinite(target) && Math.abs(target - planned) <= Math.max(0.6, period)) {
            out[i].duration = Math.round((target - cursor) * 30) / 30;
        }
        cursor += out[i].duration;
    }
    // The last scene absorbs the difference so the video still ends with the music's fade-out.
    const total = scenes.reduce((sum, s) => sum + s.duration, 0);
    const last = out[out.length - 1];
    last.duration = Math.round(Math.max(Math.min(last.duration, 1.5), total - cursor) * 30) / 30;
    return out;
}
