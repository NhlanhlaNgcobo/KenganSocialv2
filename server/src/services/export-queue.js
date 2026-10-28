/**
 * Editor exports: how many render at once, a deadline per job, and cancelling.
 *
 *  EXPORT_CONCURRENCY  exports rendering at the same time in this API process (unset = no cap, as
 *                      before; the pilot sets 1). Others wait with status "queued".
 *  EXPORT_TIMEOUT_S    hard limit per export; default 4 × the video's length + 2 minutes, max 3 h.
 *
 * The queue lives in this process. Jobs record a `deadlineAt`, so a job left "processing" by a
 * restart is reported as failed once its deadline passes (see manual-edit.controller.js).
 */
import { withProcessLimits } from './ffmpeg-runner.js';

const cap = () => {
    const n = Number(process.env.EXPORT_CONCURRENCY);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : Infinity;
};

export function exportTimeoutMs(durationSeconds) {
    const fixed = Number(process.env.EXPORT_TIMEOUT_S);
    if (Number.isFinite(fixed) && fixed > 0) return fixed * 1000;
    return Math.min(3 * 3600, 4 * (Number(durationSeconds) || 60) + 120) * 1000;
}

let running = 0;
const waiting = []; // { jobId, start }
const controllers = new Map(); // jobId -> AbortController

export const exportQueueState = () => ({ running, waiting: waiting.length, cap: cap() === Infinity ? null : cap() });
export const queuePosition = (jobId) => waiting.findIndex((w) => w.jobId === jobId) + 1; // 0 = not waiting

function pump() {
    while (running < cap() && waiting.length) {
        const next = waiting.shift();
        running += 1;
        next.start();
    }
}

/**
 * Runs `work(signal)` when a slot is free, inside FFmpeg limits (deadline + cancel).
 * `onStart` fires when it leaves the queue. Resolves/rejects with the work's result.
 */
export function runExport(jobId, { timeoutMs, onStart }, work) {
    const controller = new AbortController();
    controllers.set(jobId, controller);
    return new Promise((resolve, reject) => {
        const start = () => {
            if (controller.signal.aborted) {
                running -= 1;
                controllers.delete(jobId);
                pump();
                return reject(Object.assign(new Error('The export was cancelled.'), { code: 'CANCELLED' }));
            }
            Promise.resolve(onStart?.())
                .catch(() => {})
                .then(() => withProcessLimits({ signal: controller.signal, deadline: Date.now() + timeoutMs }, () => work(controller.signal)))
                .then(resolve, reject)
                .finally(() => {
                    running -= 1;
                    controllers.delete(jobId);
                    pump();
                });
        };
        waiting.push({ jobId, start });
        pump();
    });
}

/** Cancels a queued or running export. Returns 'queued' | 'running' | null (not in this process). */
export function cancelExport(jobId) {
    const controller = controllers.get(jobId);
    if (!controller) return null;
    const i = waiting.findIndex((w) => w.jobId === jobId);
    controller.abort();
    if (i >= 0) {
        const [entry] = waiting.splice(i, 1);
        running += 1; // start() releases the slot it never used
        entry.start();
        return 'queued';
    }
    return 'running';
}
