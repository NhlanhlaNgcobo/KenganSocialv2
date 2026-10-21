/**
 * Beat sync in the editor: decodes a clip's sound, finds its beats (lib/beats.js, in a worker),
 * and uses them for cuts, transitions and keyframes. Beats are stored on the clip in source
 * seconds, so trimming, splitting and moving the music keeps them on the sound.
 */
import { ANALYSIS_RATE, analyseBeats, beatKeyframes, mixDown, planBeatCuts, toTimelineBeats } from './beats.js';
import { getElementLength } from './time';
import { getTransform } from './transform';
import { useMediaStore } from '../stores/media-store';
import { useTimelineStore } from '../stores/timeline-store';
import type { BeatInfo, Keyframes, MediaElement, MediaItem, TextElement, TimelineTrack, TransitionType } from '../types';

type Analysis = ReturnType<typeof analyseBeats>;

const MAX_SECONDS = 600;
const cache = new Map<string, Promise<Analysis>>();

/** Mono samples at ANALYSIS_RATE (decodeAudioData resamples to the context's rate). */
async function decodeMono(blob: Blob): Promise<Float32Array> {
    const data = await blob.arrayBuffer();
    const Offline = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!Offline) throw new Error('This browser cannot decode audio.');
    let rate = ANALYSIS_RATE;
    let context: OfflineAudioContext;
    try {
        context = new Offline(1, 1, rate);
    } catch {
        // Some browsers refuse low rates: decode at twice the rate and average pairs.
        rate = ANALYSIS_RATE * 2;
        context = new Offline(1, 1, rate);
    }
    const buffer = await context.decodeAudioData(data);
    const length = Math.min(buffer.length, MAX_SECONDS * rate);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).subarray(0, length));
    const mono = mixDown(channels) as Float32Array;
    if (rate === ANALYSIS_RATE) return Float32Array.from(mono);
    const out = new Float32Array(Math.floor(mono.length / 2));
    for (let i = 0; i < out.length; i += 1) out[i] = (mono[2 * i] + mono[2 * i + 1]) / 2;
    return out;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (a: Analysis) => void; reject: (e: Error) => void }>();

function runAnalysis(samples: Float32Array): Promise<Analysis> {
    if (typeof Worker === 'undefined') return Promise.resolve(analyseBeats(samples));
    if (!worker) {
        try {
            worker = new Worker(new URL('../workers/beats.worker.js', import.meta.url), { type: 'module' });
            worker.onmessage = (event: MessageEvent<{ id: number; result?: Analysis; error?: string }>) => {
                const job = pending.get(event.data.id);
                if (!job) return;
                pending.delete(event.data.id);
                if (event.data.result) job.resolve(event.data.result);
                else job.reject(new Error(event.data.error || 'Beat analysis failed.'));
            };
        } catch {
            return Promise.resolve(analyseBeats(samples));
        }
    }
    const id = (nextId += 1);
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker!.postMessage({ id, samples }, [samples.buffer]);
    });
}

/** Beat analysis of a media file (cached per file). */
export function analyseMedia(item: MediaItem): Promise<Analysis> {
    let job = cache.get(item.id);
    if (!job) {
        job = decodeMono(item.file).then(runAnalysis);
        cache.set(item.id, job);
        job.catch(() => cache.delete(item.id));
    }
    return job;
}

/**
 * Finds the beats of a clip's sound and stores them on every clip that uses the same file (split
 * pieces included). Hand-placed markers are kept. Returns the analysis.
 */
export async function detectBeats(elementId: string): Promise<Analysis> {
    const found = useTimelineStore.getState().findElement(elementId);
    if (!found || found.element.type !== 'media') throw new Error('Select a music or video clip.');
    const item = useMediaStore.getState().getItem(found.element.mediaId);
    if (!item || item.type === 'image') throw new Error('This clip has no sound.');
    let analysis: Analysis;
    try {
        analysis = await analyseMedia(item);
    } catch {
        throw new Error(`Couldn't read the sound in ${item.name}.`);
    }
    if (!analysis.beats.length) throw new Error(`No steady beat found in ${item.name}.`);
    const store = useTimelineStore.getState();
    store.pushHistory();
    for (const track of store.tracks)
        for (const el of track.elements)
            if (el.type === 'media' && el.mediaId === item.id) {
                const beats: BeatInfo = { bpm: analysis.bpm, confidence: analysis.confidence, beats: analysis.beats, downbeats: analysis.downbeats, markers: el.beats?.markers || [] };
                store.updateElement(track.id, el.id, { beats }, false);
            }
    return analysis;
}

const uniqueSorted = (list: number[]) => {
    const sorted = [...list].sort((a, b) => a - b);
    return sorted.filter((t, i) => i === 0 || t - sorted[i - 1] > 0.02);
};

/**
 * Timeline times of beats and markers of every clip with beats. `excludeMain`: leave out the main
 * track (its clips are what gets re-cut).
 */
export function timelineBeats(tracks: TimelineTrack[], { excludeMain = false, downbeatsOnly = false } = {}) {
    const beats: number[] = [];
    const downbeats: number[] = [];
    const markers: number[] = [];
    for (const track of tracks) {
        if (excludeMain && track.isMain) continue;
        for (const el of track.elements) {
            if (el.type !== 'media' || !el.beats || el.hidden) continue;
            beats.push(...toTimelineBeats(el, 'beats'));
            downbeats.push(...toTimelineBeats(el, 'downbeats'));
            markers.push(...toTimelineBeats(el, 'markers'));
        }
    }
    return {
        beats: uniqueSorted(downbeatsOnly ? downbeats : beats),
        downbeats: uniqueSorted(downbeats),
        markers: uniqueSorted(markers),
        /** Beats and markers together: what cuts and keyframes snap to. */
        all: uniqueSorted([...(downbeatsOnly ? downbeats : beats), ...markers]),
    };
}

/** Adds or removes (if one is within half a frame) a hand-placed marker on a clip at timeline time `time`. */
export function toggleMarker(trackId: string, el: MediaElement, time: number, fps = 30) {
    const source = el.trimStart + (time - el.startTime) * (el.speed || 1);
    const markers = el.beats?.markers || [];
    const tol = (0.5 / fps) * (el.speed || 1);
    const near = markers.find((m) => Math.abs(m - source) <= tol);
    const next = near !== undefined ? markers.filter((m) => m !== near) : [...markers, Math.round(source * 1000) / 1000].sort((a, b) => a - b);
    const beats: BeatInfo = el.beats ? { ...el.beats, markers: next } : { bpm: 0, confidence: 0, beats: [], downbeats: [], markers: next };
    useTimelineStore.getState().updateElement(trackId, el.id, { beats });
    return near === undefined;
}

export type BeatCutMode = 'nearest' | 'every';

/**
 * Re-times the main-track clips so every cut lands on a beat of the music (beats on other tracks
 * plus markers). Videos trim into or out of their source; images change length. Optionally puts a
 * transition (centred on the cut, so on the beat) on every cut. One undo step.
 */
export function cutToBeats({ mode, every, transition = null, transitionSeconds = 0.4, downbeatsOnly = false }: { mode: BeatCutMode; every: number; transition?: TransitionType | null; transitionSeconds?: number; downbeatsOnly?: boolean }) {
    const store = useTimelineStore.getState();
    const main = store.tracks.find((t) => t.isMain);
    const clips = (main?.elements || []).filter((el): el is MediaElement => el.type === 'media').sort((a, b) => a.startTime - b.startTime);
    if (!main || !clips.length) return { synced: 0, total: 0, error: 'Put clips on the main track first.' };
    const { all } = timelineBeats(store.tracks, { excludeMain: true, downbeatsOnly });
    if (all.length < 2) return { synced: 0, total: clips.length - 1, error: 'Find the beats of a music clip first (select it, then Detect beats).' };
    const media = useMediaStore.getState();
    const plan = planBeatCuts(
        clips.map((el) => ({
            length: getElementLength(el),
            maxLength: media.getItem(el.mediaId)?.type === 'image' ? Infinity : (el.duration - el.trimStart) / (el.speed || 1),
        })),
        all,
        { mode, every, minLength: 0.25, start: 0 }
    );
    store.pushHistory();
    clips.forEach((el, i) => {
        const length = plan[i].length;
        const transitionIn = i > 0 && transition ? { transitionIn: { type: transition, duration: Math.min(transitionSeconds, length * 0.8) } } : {};
        if (Math.abs(length - getElementLength(el)) < 1e-4) {
            if (transition && i > 0) store.updateElement(main.id, el.id, transitionIn, false);
            return;
        }
        if (media.getItem(el.mediaId)?.type === 'image') store.updateElement(main.id, el.id, { duration: el.trimStart + length + el.trimEnd, ...transitionIn }, false);
        else store.updateElement(main.id, el.id, { trimEnd: Math.max(0, el.duration - el.trimStart - length * (el.speed || 1)), ...transitionIn }, false);
    });
    return { synced: plan.synced, total: clips.length - 1, error: null as string | null };
}

export type BeatAnimation = 'pulse' | 'shake' | 'flash';

/** Keyframes for a clip or text that hit on the music's beats inside it (times from its start). */
export function beatAnimation(el: MediaElement | TextElement, kind: BeatAnimation): Keyframes {
    const { all } = timelineBeats(useTimelineStore.getState().tracks);
    const length = getElementLength(el);
    const local = all.map((t) => t - el.startTime);
    const base = el.type === 'media' ? { scale: getTransform(el).scale, rotation: getTransform(el).rotation } : { scale: 1, rotation: el.rotation };
    return beatKeyframes(kind, local, length, base) as Keyframes;
}
