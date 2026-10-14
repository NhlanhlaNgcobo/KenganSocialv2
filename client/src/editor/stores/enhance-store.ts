/**
 * Clip enhancement jobs (stabilize / auto-frame). The server produces a new file,
 * which replaces the source on every clip that uses it. Undo restores the original.
 */
import { create } from 'zustand';
import { editorApi, pollJob, type EnhanceSummary, type StabilizeSettings } from '../lib/editor-api';
import { useMediaStore } from './media-store';
import { useProjectStore } from './project-store';
import { useTimelineStore } from './timeline-store';

export interface EnhanceOptions extends StabilizeSettings {
    stabilize: boolean;
    autoframe: boolean;
}

export const STABILIZE_PRESETS: Record<string, Partial<EnhanceOptions>> = {
    gentle: { mode: 'smooth', strength: 30, zoomMode: 'auto', edgeFill: 'zoom', correctRotation: true },
    handheld: { mode: 'smooth', strength: 60, zoomMode: 'auto', edgeFill: 'zoom', correctRotation: true },
    tripod: { mode: 'tripod', strength: 80, zoomMode: 'auto', edgeFill: 'zoom', correctRotation: true },
    noZoom: { mode: 'smooth', strength: 60, zoomMode: 'manual', zoom: 1, edgeFill: 'blur', correctRotation: true },
};

interface EnhanceState {
    options: EnhanceOptions;
    /** mediaId currently being processed, if any. */
    runningMediaId: string | null;
    stage: string;
    progress: number;
    error: string | null;
    controller: AbortController | null;
    setOptions: (partial: Partial<EnhanceOptions>) => void;
    run: (mediaId: string) => Promise<string>;
    cancel: () => void;
}

function describe(summary: EnhanceSummary | null | undefined, clips: number) {
    const parts: string[] = [];
    if (summary?.stabilized) {
        const s = summary.stabilizer;
        if (s?.engine === 'vidstab-fallback') parts.push('stabilized (basic engine — the AI video service is offline)');
        else parts.push(`stabilized${s?.mode === 'tripod' ? ' in tripod mode' : ''}${s?.zoomApplied && s.zoomApplied > 1.001 ? ` with ${Math.round((s.zoomApplied - 1) * 100)}% zoom` : ''}`);
    }
    if (summary?.autoframe?.applied) {
        const faces = Math.round((summary.autoframe.faceCoverage ?? 0) * 100);
        parts.push(`auto-framed to ${summary.autoframe.ratio}${faces ? ` (faces tracked in ${faces}% of the clip)` : ' (following motion)'}`);
    } else if (summary?.autoframe && !summary.autoframe.applied) {
        parts.push(`not reframed: ${summary.autoframe.reason}`);
    }
    return `Clip ${parts.join(', ')}. Updated ${clips} timeline clip${clips === 1 ? '' : 's'} — Ctrl+Z to undo.`;
}

export const useEnhanceStore = create<EnhanceState>((set, get) => ({
    options: {
        stabilize: true,
        autoframe: false,
        mode: 'smooth',
        strength: 60,
        zoomMode: 'auto',
        zoom: 1.1,
        edgeFill: 'zoom',
        correctRotation: true,
    },
    runningMediaId: null,
    stage: '',
    progress: 0,
    error: null,
    controller: null,

    setOptions: (partial) => set((s) => ({ options: { ...s.options, ...partial } })),

    run: async (mediaId) => {
        const { options } = get();
        const { projectKey, ratio } = useProjectStore.getState();
        const media = useMediaStore.getState().getItem(mediaId);
        if (!media || !projectKey) throw new Error('This clip’s media is no longer in the project.');
        if (!options.stabilize && !options.autoframe) throw new Error('Choose stabilize, auto-frame, or both.');

        get().controller?.abort();
        const controller = new AbortController();
        set({ runningMediaId: mediaId, stage: 'Uploading', progress: 0, error: null, controller });

        try {
            const uploads = await useMediaStore.getState().ensureUploaded([mediaId]);
            const jobId = await editorApi.startEnhance({
                sourceUploadId: uploads[mediaId],
                stabilize: {
                    enabled: options.stabilize,
                    mode: options.mode,
                    strength: options.strength,
                    zoomMode: options.zoomMode,
                    zoom: options.zoom,
                    edgeFill: options.edgeFill,
                    correctRotation: options.correctRotation,
                },
                autoframe: { enabled: options.autoframe, ratio },
            });
            const job = await pollJob(
                () => editorApi.getRenderStatus(jobId),
                (j) => {
                    // Server progress: stabilization fills 0–60 when both run, auto-frame the rest.
                    const stabilizing = options.stabilize && (!options.autoframe || (j.progress || 0) < 60);
                    set({ stage: stabilizing ? 'Stabilizing' : 'Framing', progress: j.progress || 0 });
                },
                (j) => j.status === 'completed',
                controller.signal
            );

            set({ stage: 'Loading result', progress: 100 });
            const blob = await editorApi.downloadRender(job.downloadUrl!);
            const suffix = [options.stabilize && 'stabilized', options.autoframe && ratio.replace(':', 'x')].filter(Boolean).join(' ');
            const baseName = media.name.replace(/\.[^.]+$/, '');
            const item = await useMediaStore.getState().addProcessed(blob, `${baseName} (${suffix}).mp4`, projectKey, job.outputUploadId!);
            if (!item) throw new Error('Could not load the enhanced clip.');

            const count = useTimelineStore.getState().replaceMedia(mediaId, item.id, item.duration, item.name);
            set({ runningMediaId: null, stage: '', controller: null });
            return describe(job.summary, count);
        } catch (error) {
            const message = (error as Error).message;
            set({ runningMediaId: null, stage: '', controller: null, error: message === 'Cancelled' ? null : message });
            throw error;
        }
    },

    cancel: () => {
        get().controller?.abort();
        set({ runningMediaId: null, stage: '', progress: 0, controller: null });
    },
}));
