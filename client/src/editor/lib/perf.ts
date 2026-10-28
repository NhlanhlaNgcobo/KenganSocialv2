/**
 * Editor performance diagnostics. Off unless switched on (`?perf=1` in the URL, or
 * localStorage `kengan-perf` = "1"), so normal users pay nothing for it.
 *
 * Measures what users feel, not just what the code does:
 *  - presented video frames per second (requestVideoFrameCallback), not rAF callbacks
 *  - dropped/corrupted frames (getVideoPlaybackQuality)
 *  - long main-thread tasks (> 50 ms) and their total time
 *  - seek-to-visible-frame latency (seek request → next presented frame)
 *  - React renders per component (perfRender)
 *  - JS heap (where the browser exposes it), media bytes downloaded, and backend calls made
 *    while editing (apiFetch / editorApi)
 *
 * Exposed as window.__kePerf for the benchmark script (scripts/bench-editor.mjs).
 */

type Counter = Record<string, number>;

interface PerfState {
    startedAt: number;
    renders: Counter;
    rafFrames: number;
    presentedFrames: number;
    longTasks: number;
    longTaskMs: number;
    seeks: number[];
    backendCalls: Counter;
    pendingSeek: number | null;
}

function flagOn(): boolean {
    try {
        if (typeof window === 'undefined') return false;
        if (new URLSearchParams(window.location.search).get('perf') === '1') {
            localStorage.setItem('kengan-perf', '1');
            return true;
        }
        return localStorage.getItem('kengan-perf') === '1';
    } catch {
        return false;
    }
}

export const perfEnabled = flagOn();

const state: PerfState = {
    startedAt: 0,
    renders: {},
    rafFrames: 0,
    presentedFrames: 0,
    longTasks: 0,
    longTaskMs: 0,
    seeks: [],
    backendCalls: {},
    pendingSeek: null,
};

/** Count a render of `name`. Call at the top of a component body. */
export function perfRender(name: string) {
    if (!perfEnabled) return;
    state.renders[name] = (state.renders[name] || 0) + 1;
}

/** Count a backend call made from the editor (path without query). */
export function perfBackendCall(path: string) {
    if (!perfEnabled) return;
    const key = String(path).split('?')[0].replace(/\/[a-f0-9-]{16,}/gi, '/:id');
    state.backendCalls[key] = (state.backendCalls[key] || 0) + 1;
}

/** A seek was requested: the next presented video frame closes the measurement. */
export function perfSeekStart() {
    if (!perfEnabled) return;
    state.pendingSeek = performance.now();
}

// Videos being watched for presented frames.
const watched = new WeakSet<HTMLVideoElement>();
type RvfcVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };

/** Watch a preview <video>: counts presented frames and closes pending seek measurements. */
export function perfWatchVideo(video: HTMLVideoElement | null) {
    if (!perfEnabled || !video || watched.has(video)) return;
    const v = video as RvfcVideo;
    if (!v.requestVideoFrameCallback) return;
    watched.add(video);
    const onFrame = () => {
        if (!video.isConnected) return;
        state.presentedFrames += 1;
        if (state.pendingSeek !== null) {
            state.seeks.push(performance.now() - state.pendingSeek);
            state.pendingSeek = null;
        }
        v.requestVideoFrameCallback!(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
}

function quality() {
    let dropped = 0;
    let total = 0;
    document.querySelectorAll('video').forEach((v) => {
        const q = (v as HTMLVideoElement).getVideoPlaybackQuality?.();
        if (q) {
            dropped += q.droppedVideoFrames;
            total += q.totalVideoFrames;
        }
    });
    return { dropped, total };
}

function mediaBytes() {
    let bytes = 0;
    for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
        if (/\.(mp4|mov|webm|m4v|m4a|mp3|wav)(\?|$)|private-media|\/uploads\//i.test(e.name)) bytes += e.transferSize || 0;
    }
    return bytes;
}

function heap() {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    return m ? { usedMB: +(m.usedJSHeapSize / 1048576).toFixed(1), limitMB: +(m.jsHeapSizeLimit / 1048576).toFixed(0) } : null;
}

const percentile = (values: number[], p: number) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return +sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))].toFixed(1);
};

/** Start (or restart) a measurement window. */
export function perfReset() {
    state.startedAt = performance.now();
    state.renders = {};
    state.rafFrames = 0;
    state.presentedFrames = 0;
    state.longTasks = 0;
    state.longTaskMs = 0;
    state.seeks = [];
    state.backendCalls = {};
    state.pendingSeek = null;
    baseQuality = quality();
}
let baseQuality = { dropped: 0, total: 0 };

/** Everything measured since the last reset. */
export function perfSnapshot() {
    const seconds = Math.max(0.001, (performance.now() - state.startedAt) / 1000);
    const q = quality();
    return {
        seconds: +seconds.toFixed(2),
        rafFps: +(state.rafFrames / seconds).toFixed(1),
        presentedFps: +(state.presentedFrames / seconds).toFixed(1),
        droppedFrames: q.dropped - baseQuality.dropped,
        decodedFrames: q.total - baseQuality.total,
        longTasks: state.longTasks,
        longTaskMs: Math.round(state.longTaskMs),
        seekMs: { count: state.seeks.length, p50: percentile(state.seeks, 50), p95: percentile(state.seeks, 95), max: percentile(state.seeks, 100) },
        rendersPerSecond: Object.fromEntries(Object.entries(state.renders).map(([k, v]) => [k, +(v / seconds).toFixed(1)])),
        renders: { ...state.renders },
        backendCalls: { ...state.backendCalls },
        heap: heap(),
        mediaBytesDownloaded: mediaBytes(),
        videoElements: document.querySelectorAll('video').length,
    };
}

if (perfEnabled && typeof window !== 'undefined') {
    // rAF counter (how often the browser gives us a frame), separate from presented video frames.
    const loop = () => {
        state.rafFrames += 1;
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    try {
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                state.longTasks += 1;
                state.longTaskMs += entry.duration;
            }
        }).observe({ type: 'longtask', buffered: false });
    } catch {
        /* longtask not supported */
    }
    perfReset();
    (window as unknown as { __kePerf: unknown }).__kePerf = { reset: perfReset, snapshot: perfSnapshot, seekStart: perfSeekStart };
}
