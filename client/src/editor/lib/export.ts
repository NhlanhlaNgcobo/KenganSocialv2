/**
 * Turns the timeline into the server renderer's v2 edit config and runs the job.
 */
import { EXPORT_FORMATS } from '../constants';
import { useMediaStore } from '../stores/media-store';
import { useProjectStore } from '../stores/project-store';
import { useTimelineStore } from '../stores/timeline-store';
import type { MediaElement, TextElement } from '../types';
import { editorApi, pollJob } from './editor-api';
import { getElementEnd } from './time';
import { getTransform, isIdentity, scaleRange } from './transform';

export interface ExportProgress {
    stage: 'uploading' | 'rendering' | 'downloading' | 'done';
    progress: number;
    message: string;
}

/** Transform in the renderer's shape: zoom at clip start/end plus static framing. */
function exportTransform(el: MediaElement, isMain: boolean) {
    const t = getTransform(el);
    if (!isMain) t.animation = 'none'; // zoom animation renders on the main track only
    if (isIdentity(t)) return null;
    const [scaleStart, scaleEnd] = scaleRange(t);
    return { scaleStart, scaleEnd, x: t.x, y: t.y, rotation: t.rotation, flipH: t.flipH, flipV: t.flipV };
}

function sourceWindow(el: MediaElement) {
    return { sourceStart: el.trimStart, sourceEnd: el.duration - el.trimEnd };
}

export function buildEditConfig(uploadIds: Record<string, string>) {
    const { tracks, getTotalDuration } = useTimelineStore.getState();
    const { ratio, fps, backgroundColor } = useProjectStore.getState();
    const getItem = useMediaStore.getState().getItem;

    const mediaEl = (el: MediaElement, trackMuted: boolean, isMain = false) => {
        const item = getItem(el.mediaId);
        return {
            source: uploadIds[el.mediaId],
            kind: item?.type ?? 'video',
            timelineStart: el.startTime,
            timelineEnd: getElementEnd(el),
            ...sourceWindow(el),
            speed: el.speed || 1,
            volume: el.muted || trackMuted ? 0 : el.volume ?? 1,
            filter: el.filter || 'none',
            transform: exportTransform(el, isMain),
        };
    };

    const visible = (el: { hidden?: boolean }) => !el.hidden;
    const mainTrack = tracks.find((t) => t.isMain);
    const main = (mainTrack?.elements.filter(visible) as MediaElement[] | undefined)
        ?.map((el) => mediaEl(el, !!mainTrack?.muted, true))
        .sort((a, b) => a.timelineStart - b.timelineStart) ?? [];

    // Overlay media tracks are listed bottom-up so higher tracks composite last (on top).
    const overlayTracks = tracks.filter((t) => t.type === 'media' && !t.isMain).reverse();
    const overlays = overlayTracks.flatMap((t) => (t.elements.filter(visible) as MediaElement[]).map((el) => mediaEl(el, !!t.muted)));

    const audio = tracks
        .filter((t) => t.type === 'audio')
        .flatMap((t) => (t.elements.filter(visible) as MediaElement[]).map((el) => mediaEl(el, !!t.muted)));

    const text = tracks
        .filter((t) => t.type === 'text')
        .reverse()
        .flatMap((t) =>
            (t.elements.filter(visible) as TextElement[]).map((el) => ({
                content: el.content,
                timelineStart: el.startTime,
                timelineEnd: getElementEnd(el),
                fontSize: el.fontSize,
                fontFamily: el.fontFamily,
                color: el.color,
                backgroundColor: el.backgroundColor,
                bold: el.fontWeight === 'bold',
                align: el.textAlign,
                x: el.x,
                y: el.y,
                opacity: el.opacity,
            }))
        );

    return {
        version: 2,
        exportFormat: EXPORT_FORMATS[ratio],
        fps,
        backgroundColor,
        duration: getTotalDuration(),
        main,
        overlays,
        audio,
        text,
    };
}

function collectMediaIds() {
    const ids: string[] = [];
    for (const track of useTimelineStore.getState().tracks) {
        for (const el of track.elements) if (el.type === 'media' && !el.hidden) ids.push(el.mediaId);
    }
    return ids;
}

export async function exportTimeline(onProgress: (p: ExportProgress) => void, signal?: AbortSignal): Promise<Blob> {
    const mediaIds = collectMediaIds();
    if (!mediaIds.length && !useTimelineStore.getState().tracks.some((t) => t.type === 'text' && t.elements.length)) {
        throw new Error('Add something to the timeline before exporting.');
    }

    const run = async () => {
        onProgress({ stage: 'uploading', progress: 0, message: 'Uploading media' });
        const uploadIds = await useMediaStore.getState().ensureUploaded(mediaIds, (done, total) =>
            onProgress({ stage: 'uploading', progress: Math.round((done / total) * 100), message: `Uploading media ${done}/${total}` })
        );
        return editorApi.startRender(buildEditConfig(uploadIds));
    };

    let jobId: string;
    try {
        jobId = await run();
    } catch (error) {
        // The render server keeps uploads in memory, so a restart loses them. Re-upload once.
        if (/source .*not found/i.test((error as Error).message)) {
            useMediaStore.getState().invalidateUploads();
            jobId = await run();
        } else {
            throw error;
        }
    }

    const job = await pollJob(
        () => editorApi.getRenderStatus(jobId),
        (j) => onProgress({ stage: 'rendering', progress: j.progress || 0, message: 'Rendering video' }),
        (j) => j.status === 'completed',
        signal
    );

    onProgress({ stage: 'downloading', progress: 100, message: 'Downloading' });
    const blob = await editorApi.downloadRender(job.downloadUrl!);
    onProgress({ stage: 'done', progress: 100, message: 'Export complete' });
    return blob;
}

export function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}
