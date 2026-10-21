/**
 * Beat detection and beat-synced editing, as pure functions (browser and Node).
 *
 * analyseBeats() works on mono samples at ANALYSIS_RATE: onset strength from a high-passed energy
 * envelope, tempo from its autocorrelation (weighted towards 120 BPM), beat phase from the onset
 * sum, then each grid beat is pulled onto the nearest strong onset so live-played music stays in
 * time. Downbeats are the beat phase (of 4) that carries the most onset strength.
 *
 * Beat times are seconds in the SOURCE file; toTimelineBeats() maps them through an element's trim,
 * speed and position, so trimming, splitting and moving the music keeps the markers on the audio.
 */

export const ANALYSIS_RATE = 11025;
const HOP = 128; // ≈ 11.6 ms
const HOP_SEC = HOP / ANALYSIS_RATE;
export const BEAT_ANALYSIS_VERSION = 1;
const MAX_SECONDS = 600;

const FFT_SIZE = 512; // 46 ms window, 21.5 Hz bins
// Bands (in bins): kick, low-mid/snare body, mid, highs. Each counts equally, so off-beat hi-hats
// (many high bins) can't outvote the kick and snare.
const BANDS = [
    [1, 7],
    [7, 19],
    [19, 70],
    [70, 256],
];

function fftTables(n) {
    const rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i += 1) {
        let r = 0;
        for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b);
        rev[i] = r;
    }
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i += 1) {
        cos[i] = Math.cos((2 * Math.PI * i) / n);
        sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    const hann = new Float64Array(n);
    for (let i = 0; i < n; i += 1) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    return { rev, cos, sin, hann };
}

/** In-place radix-2 FFT. */
function fft(re, im, { rev, cos, sin }) {
    const n = re.length;
    for (let i = 0; i < n; i += 1) {
        const j = rev[i];
        if (j > i) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const step = n / size;
        for (let start = 0; start < n; start += size) {
            for (let k = 0; k < half; k += 1) {
                const wr = cos[k * step];
                const wi = sin[k * step];
                const a = start + k;
                const b = a + half;
                const tr = re[b] * wr - im[b] * wi;
                const ti = re[b] * wi + im[b] * wr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
    }
}

/**
 * Onset strength per hop: log-magnitude spectral flux (positive changes only), averaged within each
 * band, bands normalised to the same mean and summed. `low` is the kick band alone (downbeats).
 */
function onsetCurve(samples) {
    const frames = Math.max(0, Math.floor((samples.length - FFT_SIZE) / HOP) + 1);
    const tables = fftTables(FFT_SIZE);
    const re = new Float64Array(FFT_SIZE);
    const im = new Float64Array(FFT_SIZE);
    const half = FFT_SIZE / 2;
    let prev = new Float64Array(half);
    let mag = new Float64Array(half);
    let prevLin = new Float64Array(BANDS[0][1]);
    let lin = new Float64Array(BANDS[0][1]);
    const bands = BANDS.map(() => new Float32Array(frames));
    // Kick band on a linear scale: how hard each kick hits (log flux hides loudness differences).
    const kick = new Float32Array(frames);
    for (let f = 0; f < frames; f += 1) {
        const offset = f * HOP;
        for (let i = 0; i < FFT_SIZE; i += 1) {
            re[i] = samples[offset + i] * tables.hann[i];
            im[i] = 0;
        }
        fft(re, im, tables);
        for (let k = 0; k < half; k += 1) {
            const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
            mag[k] = Math.log1p(100 * m);
            if (k < lin.length) lin[k] = m;
        }
        if (f > 0) {
            let kickRise = 0;
            for (let k = BANDS[0][0]; k < BANDS[0][1]; k += 1) kickRise += Math.max(0, lin[k] - prevLin[k]);
            kick[f] = kickRise;
            BANDS.forEach(([a, b], bi) => {
                let s = 0;
                for (let k = a; k < b; k += 1) s += Math.max(0, mag[k] - prev[k]);
                bands[bi][f] = s / (b - a);
            });
        }
        [prev, mag] = [mag, prev];
        [prevLin, lin] = [lin, prevLin];
    }
    // Equal weight per band; the window centre is half a window after the frame start.
    const onset = new Float32Array(frames);
    for (const band of bands) {
        let mean = 0;
        for (const v of band) mean += v;
        mean /= Math.max(1, frames);
        if (mean <= 1e-12) continue;
        for (let f = 0; f < frames; f += 1) onset[f] += band[f] / mean;
    }
    // Flux peaks about one hop after the window centre reaches the transient (measured on clicks).
    return { onset, low: kick, latency: FFT_SIZE / 2 / ANALYSIS_RATE + HOP_SEC };
}

/** Local maxima of the onset curve above an adaptive threshold, at least `gap` seconds apart. */
function pickOnsets(onset, latency, gap = 0.09) {
    const n = onset.length;
    const win = Math.round(0.75 / HOP_SEC);
    const minGap = Math.round(gap / HOP_SEC);
    // Running mean and deviation over ±0.75 s.
    const prefix = new Float64Array(n + 1);
    const prefix2 = new Float64Array(n + 1);
    for (let i = 0; i < n; i += 1) {
        prefix[i + 1] = prefix[i] + onset[i];
        prefix2[i + 1] = prefix2[i] + onset[i] * onset[i];
    }
    let peak = 0;
    for (const v of onset) peak = Math.max(peak, v);
    const out = [];
    let lastFrame = -Infinity;
    for (let i = 1; i < n - 1; i += 1) {
        const v = onset[i];
        if (v < onset[i - 1] || v < onset[i + 1]) continue;
        const a = Math.max(0, i - win);
        const b = Math.min(n, i + win + 1);
        const m = (prefix[b] - prefix[a]) / (b - a);
        const sd = Math.sqrt(Math.max(0, (prefix2[b] - prefix2[a]) / (b - a) - m * m));
        if (v < m + 1.2 * sd || v < 0.08 * peak) continue;
        if (i - lastFrame < minGap) {
            // Keep the stronger of two close peaks.
            if (out.length && v > out[out.length - 1].s) {
                out[out.length - 1] = { f: i, s: v };
                lastFrame = i;
            }
            continue;
        }
        out.push({ f: i, s: v });
        lastFrame = i;
    }
    return out.map((o) => ({ t: Math.round((o.f * HOP_SEC + latency) * 1000) / 1000, s: peak > 0 ? Math.round((o.s / peak) * 1000) / 1000 : 0 }));
}

/**
 * Tempo, beats, downbeats and onsets of mono samples at ANALYSIS_RATE.
 * @returns {{ version:number, bpm:number, period:number, confidence:number, duration:number,
 *   beats:number[], downbeats:number[], onsets:{t:number,s:number}[] }}
 */
export function analyseBeats(input) {
    const samples = input.length > MAX_SECONDS * ANALYSIS_RATE ? input.subarray(0, MAX_SECONDS * ANALYSIS_RATE) : input;
    const { onset, low, latency } = onsetCurve(samples);
    const frames = onset.length;
    const duration = Math.round((samples.length / ANALYSIS_RATE) * 1000) / 1000;
    const empty = { version: BEAT_ANALYSIS_VERSION, bpm: 0, period: 0, confidence: 0, duration, beats: [], downbeats: [], onsets: [] };
    if (frames < Math.round(2 / HOP_SEC)) return empty;

    let mean = 0;
    for (const v of onset) mean += v;
    mean /= frames;
    if (mean <= 1e-9) return empty;
    const centred = Float32Array.from(onset, (v) => v - mean);

    // Tempo: autocorrelation over 60–180 BPM, weighted towards 120 BPM, parabolic refinement.
    const minLag = Math.round(60 / 180 / HOP_SEC);
    const maxLag = Math.round(60 / 60 / HOP_SEC);
    const n = Math.min(frames, Math.round(90 / HOP_SEC));
    const acf = new Float32Array(maxLag + 2);
    for (let lag = 0; lag <= maxLag + 1; lag += 1) {
        let s = 0;
        for (let i = 0; i + lag < n; i += 1) s += centred[i] * centred[i + lag];
        acf[lag] = s;
    }
    let best = minLag;
    let bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
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
    const periodFrames = best + Math.max(-0.5, Math.min(0.5, shift));
    const period = periodFrames * HOP_SEC;
    const confidence = acf[0] > 0 ? Math.max(0, Math.min(1, acf[best] / acf[0])) : 0;

    // Phase: the offset whose grid collects the most onset strength (sub-hop resolution).
    let phase = 0;
    let phaseScore = -Infinity;
    // Over the first 20 s, where the autocorrelation period has not drifted yet.
    const phaseFrames = Math.min(frames, Math.round(20 / HOP_SEC));
    for (let p = 0; p < periodFrames; p += 0.25) {
        let s = 0;
        for (let t = p; t < phaseFrames; t += periodFrames) {
            const i = Math.floor(t);
            const f = t - i;
            s += (onset[i] || 0) * (1 - f) + (onset[i + 1] || 0) * f;
        }
        if (s > phaseScore) {
            phaseScore = s;
            phase = p;
        }
    }

    // Tracking: each beat is expected one (locally adapted) period after the previous one and is
    // pulled onto a strong onset near there, so small tempo errors and live timing don't drift.
    const onsets = pickOnsets(onset, latency);
    const beats = [];
    const window = Math.min(0.06, 0.12 * period);
    let local = period;
    let oi = 0;
    for (let t = phase * HOP_SEC + latency; t < duration; ) {
        while (oi < onsets.length && onsets[oi].t < t - window) oi += 1;
        let snapped = null;
        let strength = 0.15;
        for (let j = oi; j < onsets.length && onsets[j].t <= t + window; j += 1) {
            if (onsets[j].s > strength) {
                strength = onsets[j].s;
                snapped = onsets[j].t;
            }
        }
        const beat = snapped ?? t;
        if (snapped !== null && beats.length) local = Math.min(period * 1.05, Math.max(period * 0.95, 0.8 * local + 0.2 * (beat - beats[beats.length - 1])));
        beats.push(Math.round(beat * 1000) / 1000);
        t = beat + local;
    }
    // Tempo from the tracked beats (least-squares slope), more precise than the autocorrelation lag.
    let fitted = period;
    if (beats.length > 8) {
        const m = beats.length;
        const xm = (m - 1) / 2;
        const ym = beats.reduce((sum, v) => sum + v, 0) / m;
        let num = 0;
        let den = 0;
        beats.forEach((v, i) => {
            num += (i - xm) * (v - ym);
            den += (i - xm) * (i - xm);
        });
        if (den > 0 && Math.abs(num / den - period) < period * 0.05) fitted = num / den;
    }

    // Downbeats: the beat phase (of 4) with the strongest kick-band onsets.
    const accent = [0, 0, 0, 0];
    const counts = [0, 0, 0, 0];
    beats.forEach((t, i) => {
        const f = Math.round((t - latency) / HOP_SEC);
        accent[i % 4] += Math.max(low[f - 2] || 0, low[f - 1] || 0, low[f] || 0, low[f + 1] || 0, low[f + 2] || 0);
        counts[i % 4] += 1;
    });
    for (let i = 0; i < 4; i += 1) accent[i] /= Math.max(1, counts[i]);
    const bar = accent.indexOf(Math.max(...accent));
    const downbeats = beats.filter((_, i) => i % 4 === bar);

    return { version: BEAT_ANALYSIS_VERSION, bpm: Math.round((60 / fitted) * 10) / 10, period: Math.round(fitted * 10000) / 10000, confidence: Math.round(confidence * 1000) / 1000, duration, beats, downbeats, onsets };
}

/** Mono mix of channel arrays (Web Audio channel data or Float32Arrays). */
export function mixDown(channels) {
    if (channels.length === 1) return channels[0];
    const out = new Float32Array(channels[0].length);
    for (const ch of channels) for (let i = 0; i < out.length; i += 1) out[i] += ch[i] / channels.length;
    return out;
}

/**
 * Timeline times of an element's beats: source times inside the element's trimmed range, mapped
 * through its speed and position. `kind`: 'beats' | 'downbeats' | 'markers'.
 */
export function toTimelineBeats(el, kind = 'beats') {
    const list = el?.beats?.[kind];
    if (!list?.length) return [];
    const speed = el.speed || 1;
    const from = el.trimStart;
    const to = el.duration - el.trimEnd;
    const out = [];
    for (const t of list) if (t >= from - 1e-6 && t <= to + 1e-6) out.push(Math.round((el.startTime + (t - from) / speed) * 1000) / 1000);
    return out;
}

/** The beat closest to `t` within `maxDistance` seconds, or null. `beats` must be sorted. */
export function nearestBeat(beats, t, maxDistance = Infinity) {
    let lo = 0;
    let hi = beats.length - 1;
    if (hi < 0) return null;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (beats[mid] < t) lo = mid + 1;
        else hi = mid;
    }
    let best = beats[lo];
    if (lo > 0 && Math.abs(beats[lo - 1] - t) <= Math.abs(best - t)) best = beats[lo - 1];
    return Math.abs(best - t) <= maxDistance ? best : null;
}

/**
 * New lengths for main-track clips so every cut lands on a beat.
 * clips: [{ length, maxLength }] in order (maxLength: longest the clip can become from its source;
 * Infinity for images). beats: sorted timeline beat times. Options:
 *  - mode 'every': each clip lasts `every` beats (a montage); 'nearest': each cut moves to the
 *    nearest beat on the `every` grid, keeping clip lengths close to what they were.
 *  - minLength: shortest clip allowed (seconds).
 * Returns [{ length }] (unchanged where no beat fits), plus `synced` = number of cuts on a beat.
 */
export function planBeatCuts(clips, beats, { mode = 'nearest', every = 1, minLength = 0.25, start = 0 } = {}) {
    const step = Math.max(1, Math.round(every));
    // Grid: every `step`-th beat from the first beat at or after the first clip's start.
    const first = beats.findIndex((b) => b >= start - 1e-3);
    const grid = first < 0 ? [] : beats.slice(first).filter((_, i) => i % step === 0);
    // A montage clip spans its beats: at least ¾ of a grid step (no sliver before the first beat).
    if (mode === 'every' && grid.length > 1) {
        const gaps = grid.slice(1).map((b, i) => b - grid[i]).sort((a, b) => a - b);
        minLength = Math.max(minLength, 0.75 * gaps[gaps.length >> 1]);
    }
    const out = [];
    let cursor = start;
    let synced = 0;
    let gi = 0;
    for (let i = 0; i < clips.length; i += 1) {
        const clip = clips[i];
        const isLast = i === clips.length - 1;
        let target = null;
        if (!isLast || mode === 'every') {
            while (gi < grid.length && grid[gi] < cursor + minLength - 1e-6) gi += 1;
            if (mode === 'every') {
                // Exactly one grid step from the clip's start beat.
                const end = grid[gi];
                if (end !== undefined) target = end;
            } else {
                const planned = cursor + clip.length;
                let best = null;
                for (let j = gi; j < grid.length && grid[j] <= planned + 2 * (grid[1] - grid[0] || 1); j += 1) {
                    if (best === null || Math.abs(grid[j] - planned) < Math.abs(best - planned)) best = grid[j];
                }
                target = best;
            }
        }
        let length = clip.length;
        if (target !== null) {
            const wanted = target - cursor;
            if (wanted >= minLength - 1e-6 && wanted <= clip.maxLength + 1e-6) {
                length = Math.round(wanted * 1000) / 1000;
                synced += isLast ? 0 : 1;
                gi = grid.indexOf(target) + 1;
            }
        }
        out.push({ length });
        cursor += length;
    }
    return Object.assign(out, { synced });
}

/**
 * Keyframes that hit on each beat inside an element (times relative to the element's start):
 * 'pulse' scales up and settles, 'shake' kicks rotation, 'flash' dips opacity. At most 64 keys.
 */
export function beatKeyframes(kind, beatTimes, length, base = { scale: 1, rotation: 0 }) {
    const inside = beatTimes.filter((t) => t >= 0 && t < length - 0.05);
    const keys = [];
    const push = (t, v, ease) => {
        if (t >= 0 && t <= length && (!keys.length || t - keys[keys.length - 1].t > 1e-3)) keys.push({ t: Math.round(t * 1000) / 1000, v: Math.round(v * 10000) / 10000, ease });
    };
    inside.forEach((b, i) => {
        if (kind === 'pulse') {
            push(b, base.scale * 1.08, 'expo-out');
            push(b + 0.22, base.scale, 'linear');
        } else if (kind === 'shake') {
            push(b, base.rotation + (i % 2 ? -3 : 3), 'ease-out');
            push(b + 0.18, base.rotation, 'linear');
        } else {
            push(b, 0.55, 'ease-out');
            push(b + 0.15, 1, 'linear');
        }
    });
    const prop = kind === 'pulse' ? 'scale' : kind === 'shake' ? 'rotation' : 'opacity';
    if (!keys.length) return {};
    // Hold the resting value before the first hit.
    const rest = prop === 'scale' ? base.scale : prop === 'rotation' ? base.rotation : 1;
    if (keys[0].t > 0.001) keys.unshift({ t: 0, v: rest, ease: 'hold' });
    return { [prop]: keys.slice(0, 64) };
}
