/**
 * Clip enhancement jobs (stabilize / auto-frame). The server produces a new file,
 * which replaces the source on every clip that uses it. Undo restores the original.
 * Background removal replaces the source on one overlay clip only and keys out the colour.
 */
import { create } from 'zustand';
import { editorApi, pollJob, type CleanupOptions, type EnhanceSummary, type StabilizeSettings } from '../lib/editor-api';
import { useMediaStore } from './media-store';
import { useProjectStore } from './project-store';
import { useTimelineStore } from './timeline-store';
import type { MediaElement } from '../types';

export interface EnhanceOptions extends StabilizeSettings {
    stabilize: boolean;
    autoframe: boolean;
    cleanup: CleanupOptions;
}

export const NO_CLEANUP: CleanupOptions = {
    video: { denoise: 'off', sharpen: 0, deband: false, deflicker: false, autoLevels: false },
    audio: { noise: 'off', strength: 0.85, hum: 'off', declick: false, clarity: false, deess: false, loudness: 'off' },
};

/** One-click clean-up recipes. */
export const CLEANUP_PRESETS: Record<string, { label: string; hint: string; value: CleanupOptions }> = {
    podcast: {
        label: 'Podcast / interview',
        hint: 'Remove room noise and hum, clearer voices, podcast loudness',
        value: { video: { ...NO_CLEANUP.video, denoise: 'light', sharpen: 0.3 }, audio: { noise: 'voice-laughter', strength: 0.85, hum: '50', declick: true, clarity: true, deess: true, loudness: 'podcast' } },
    },
    phone: {
        label: 'Phone video',
        hint: 'Less grain and wind/traffic noise, crisper picture, social loudness',
        value: { video: { ...NO_CLEANUP.video, denoise: 'medium', sharpen: 0.4, autoLevels: true }, audio: { noise: 'voice', strength: 0.9, hum: 'off', declick: false, clarity: true, deess: false, loudness: 'social' } },
    },
    lowLight: {
        label: 'Low light',
        hint: 'Strong noise reduction, smoother gradients, balanced levels',
        value: { video: { denoise: 'strong', sharpen: 0.25, deband: true, deflicker: true, autoLevels: true }, audio: { ...NO_CLEANUP.audio } },
    },
    music: {
        label: 'Music & ambience',
        hint: 'Gentle hiss removal that keeps music intact',
        value: { video: { ...NO_CLEANUP.video }, audio: { noise: 'fft', strength: 0.5, hum: 'off', declick: true, clarity: false, deess: false, loudness: 'social' } },
    },
};

export const hasCleanup = (c: CleanupOptions) =>
    c.video.denoise !== 'off' || c.video.sharpen > 0 || c.video.deband || c.video.deflicker || c.video.autoLevels ||
    c.audio.noise !== 'off' || c.audio.hum !== 'off' || c.audio.declick || c.audio.clarity || c.audio.deess || c.audio.loudness !== 'off';

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
    /** AI background removal on one overlay clip: swaps in the processed file and turns the key on. */
    removeBackground: (trackId: string, elementId: string) => Promise<string>;
    /**
     * A video the browser cannot show (ProRes and other camera formats: it plays sound but no
     * picture) is converted to MP4 on the server and replaces the original everywhere.
     */
    convertForPreview: (mediaId: string) => Promise<string>;
    cancel: () => void;
}

function describe(summary: EnhanceSummary | null | undefined, clips: number) {
    const parts: string[] = [];
    if (summary?.cleanup?.video) parts.push('cleaned up');
    if (summary?.cleanup?.audio) parts.push('sound cleaned');
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
        stabilize: false,
        autoframe: false,
        cleanup: NO_CLEANUP,
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
        const cleanup = hasCleanup(options.cleanup);
        const isAudio = media.type === 'audio';
        if (!options.stabilize && !options.autoframe && !cleanup) throw new Error('Choose at least one enhancement.');
        if (isAudio && !cleanup) throw new Error('Choose a sound clean-up option.');

        get().controller?.abort();
        const controller = new AbortController();
        set({ runningMediaId: mediaId, stage: 'Uploading', progress: 0, error: null, controller });

        try {
            const uploads = await useMediaStore.getState().ensureUploaded([mediaId]);
            const jobId = await editorApi.startEnhance({
                sourceUploadId: uploads[mediaId],
                cleanup: { enabled: cleanup, ...options.cleanup },
                stabilize: {
                    enabled: options.stabilize && !isAudio,
                    mode: options.mode,
                    strength: options.strength,
                    zoomMode: options.zoomMode,
                    zoom: options.zoom,
                    edgeFill: options.edgeFill,
                    correctRotation: options.correctRotation,
                },
                autoframe: { enabled: options.autoframe && !isAudio, ratio },
            });
            const job = await pollJob(
                () => editorApi.getRenderStatus(jobId),
                (j) => {
                    // Server progress: stabilization fills 0–60 when both run, auto-frame the rest.
                    const p = j.progress || 0;
                    const heavy = (options.stabilize || options.autoframe) && !isAudio;
                    const stage = cleanup && (!heavy || p < 25) ? 'Cleaning up' : options.stabilize && (!options.autoframe || p < 60) ? 'Stabilizing' : 'Framing';
                    set({ stage, progress: p });
                },
                (j) => j.status === 'completed',
                controller.signal
            );

            set({ stage: 'Loading result', progress: 100 });
            const blob = await editorApi.downloadRender(job.downloadUrl!);
            const suffix = [cleanup && 'cleaned', options.stabilize && !isAudio && 'stabilized', options.autoframe && !isAudio && ratio.replace(':', 'x')].filter(Boolean).join(' ');
            const baseName = media.name.replace(/\.[^.]+$/, '');
            const item = await useMediaStore.getState().addProcessed(blob, `${baseName} (${suffix}).${isAudio ? 'm4a' : 'mp4'}`, projectKey, job.outputUploadId!);
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

    removeBackground: async (trackId, elementId) => {
        const { projectKey } = useProjectStore.getState();
        const found = useTimelineStore.getState().findElement(elementId);
        const el = found?.element as MediaElement | undefined;
        const media = el ? useMediaStore.getState().getItem(el.mediaId) : null;
        if (!el || !media || !projectKey) throw new Error('This clip’s media is no longer in the project.');
        if (media.type !== 'video') throw new Error('Background removal works on video clips.');
        const mediaId = media.id;

        get().controller?.abort();
        const controller = new AbortController();
        set({ runningMediaId: mediaId, stage: 'Uploading', progress: 0, error: null, controller });
        try {
            const uploads = await useMediaStore.getState().ensureUploaded([mediaId]);
            const jobId = await editorApi.startEnhance({ sourceUploadId: uploads[mediaId], removeBackground: { enabled: true } });
            const job = await pollJob(
                () => editorApi.getRenderStatus(jobId),
                (j) => set({ stage: 'Removing background', progress: j.progress || 0 }),
                (j) => j.status === 'completed',
                controller.signal
            );
            set({ stage: 'Loading result', progress: 100 });
            const blob = await editorApi.downloadRender(job.downloadUrl!);
            const baseName = media.name.replace(/\.[^.]+$/, '');
            const item = await useMediaStore.getState().addProcessed(blob, `${baseName} (no background).mp4`, projectKey, job.outputUploadId!);
            if (!item) throw new Error('Could not load the processed clip.');
            // Same length as the source, so the clip's trims stay valid. The key is tight: the
            // background is one flat colour, so nothing else in the picture is close to it.
            const keyColor = job.summary?.backgroundRemoved?.keyColor || '#00ff00';
            useTimelineStore.getState().updateElement(trackId, elementId, { mediaId: item.id, chromaKey: { color: keyColor, similarity: 0.1, blend: 0.06, spill: 0.5 } });
            set({ runningMediaId: null, stage: '', controller: null });
            return 'Background removed. Ctrl+Z to undo.';
        } catch (error) {
            const message = (error as Error).message;
            set({ runningMediaId: null, stage: '', controller: null, error: message === 'Cancelled' ? null : message });
            throw error;
        }
    },

    convertForPreview: async (mediaId) => {
        const { projectKey } = useProjectStore.getState();
        const media = useMediaStore.getState().getItem(mediaId);
        if (!media || !projectKey) throw new Error('This video is no longer in the project.');
        get().controller?.abort();
        const controller = new AbortController();
        set({ runningMediaId: mediaId, stage: 'Uploading for conversion', progress: 0, error: null, controller });
        try {
            const uploads = await useMediaStore.getState().ensureUploaded([mediaId], undefined, controller.signal);
            const jobId = await editorApi.startConvert(uploads[mediaId], controller.signal);
            const job = await pollJob(
                () => editorApi.getRenderStatus(jobId),
                (j) => set({ stage: 'Converting', progress: j.progress || 0 }),
                (j) => j.status === 'completed',
                controller.signal
            );
            set({ stage: 'Loading the converted video', progress: 100 });
            const blob = await editorApi.downloadRender(job.downloadUrl!);
            const baseName = media.name.replace(/\.[^.]+$/, '');
            const item = await useMediaStore.getState().addProcessed(blob, `${baseName}.mp4`, projectKey, job.outputUploadId!);
            if (!item) throw new Error('Could not load the converted video.');
            useTimelineStore.getState().replaceMedia(mediaId, item.id, item.duration, item.name);
            useMediaStore.getState().removeItem(mediaId, projectKey);
            set({ runningMediaId: null, stage: '', controller: null });
            return `${media.name} was converted to MP4 so it plays in the editor.`;
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
