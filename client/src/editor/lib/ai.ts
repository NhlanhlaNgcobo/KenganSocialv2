/**
 * Kengan AI tools (transcription, viral moments, auto-edit) wired into the timeline.
 */
import { useMediaStore } from '../stores/media-store';
import { useTimelineStore } from '../stores/timeline-store';
import type { MediaElement } from '../types';
import { editorApi, pollJob, type AnalysisJob } from './editor-api';
import { getElementEnd } from './time';

export type AnalysisMode = 'subtitles' | 'viral' | 'auto-edit';

export interface AutoEditOptions {
    goal: 'high-retention' | 'story-first' | 'sales-focused';
    aggressiveness: 'light' | 'balanced' | 'aggressive';
    removeBlackFrames: boolean;
    removeSilence: boolean;
    preserveHookSeconds: number;
    minClipLength: number;
    maxClipLength: number;
    hookBoost: number;
    speechDensityWeight: number;
    sceneChangeWeight: number;
}

export const DEFAULT_AUTO_EDIT: AutoEditOptions = {
    goal: 'high-retention',
    aggressiveness: 'balanced',
    removeBlackFrames: true,
    removeSilence: true,
    preserveHookSeconds: 3,
    minClipLength: 6,
    maxClipLength: 18,
    hookBoost: 0.25,
    speechDensityWeight: 0.35,
    sceneChangeWeight: 0.3,
};

export async function runAnalysis(
    mediaId: string,
    mode: AnalysisMode,
    options: AutoEditOptions,
    onProgress: (status: string, progress: number) => void,
    signal?: AbortSignal
): Promise<AnalysisJob> {
    onProgress('uploading', 5);
    const uploads = await useMediaStore.getState().ensureUploaded([mediaId]);
    const jobId = await editorApi.startAnalysis({
        sourceUploadId: uploads[mediaId],
        analysisPreferences: { ...options, mode },
    });
    return pollJob(
        () => editorApi.getAnalysisJob(jobId),
        (job) => onProgress(job.status, job.progress || 0),
        (job) => job.status === 'ready',
        signal,
        2000
    );
}

/** Words arrive in source milliseconds; place them where that media sits on the timeline. */
export function mapWordsToTimeline(mediaId: string, words: { text: string; start: number; end: number }[]) {
    const placements = useTimelineStore
        .getState()
        .tracks.flatMap((t) => t.elements)
        .filter((e): e is MediaElement => e.type === 'media' && e.mediaId === mediaId);

    if (!placements.length) {
        return words.map((w) => ({ text: w.text, start: w.start / 1000, end: w.end / 1000 }));
    }

    const mapped: { text: string; start: number; end: number }[] = [];
    for (const word of words) {
        const srcStart = word.start / 1000;
        const srcEnd = word.end / 1000;
        for (const el of placements) {
            const windowStart = el.trimStart;
            const windowEnd = el.duration - el.trimEnd;
            if (srcStart >= windowStart && srcStart < windowEnd) {
                const speed = el.speed || 1;
                const start = el.startTime + (srcStart - windowStart) / speed;
                const end = Math.min(getElementEnd(el), el.startTime + (Math.min(srcEnd, windowEnd) - windowStart) / speed);
                mapped.push({ text: word.text, start, end });
            }
        }
    }
    return mapped.sort((a, b) => a.start - b.start);
}

export function applyKeepSegments(mediaId: string, segments: { startSec: number; endSec: number; reason?: string }[]) {
    const item = useMediaStore.getState().getItem(mediaId);
    if (!item) return;
    useTimelineStore.getState().replaceMainTrackSegments(
        mediaId,
        segments.map((s) => ({ start: s.startSec, end: s.endSec, label: s.reason })),
        item.duration
    );
}
