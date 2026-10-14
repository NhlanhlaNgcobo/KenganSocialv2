import { create } from 'zustand';
import { applyKeepSegments, DEFAULT_AUTO_EDIT, mapWordsToTimeline, runAnalysis, type AnalysisMode, type AutoEditOptions } from '../lib/ai';
import { CAPTION_STYLES } from '../constants';
import { useTimelineStore } from './timeline-store';

export interface ViralClip {
    startSec: number;
    endSec: number;
    score: number;
    reason: string;
}

interface AiState {
    status: 'idle' | 'running' | 'error';
    stage: string;
    progress: number;
    error: string | null;
    mode: AnalysisMode | null;
    sourceMediaId: string | null;
    viralClips: ViralClip[];
    captionStyle: keyof typeof CAPTION_STYLES;
    options: AutoEditOptions;
    controller: AbortController | null;
    setSource: (id: string | null) => void;
    setCaptionStyle: (style: keyof typeof CAPTION_STYLES) => void;
    setOptions: (partial: Partial<AutoEditOptions>) => void;
    setViralClips: (clips: ViralClip[], mediaId?: string | null) => void;
    run: (mode: AnalysisMode) => Promise<string>;
    cancel: () => void;
}

export const useAiStore = create<AiState>((set, get) => ({
    status: 'idle',
    stage: '',
    progress: 0,
    error: null,
    mode: null,
    sourceMediaId: null,
    viralClips: [],
    captionStyle: 'bold',
    options: DEFAULT_AUTO_EDIT,
    controller: null,

    setSource: (sourceMediaId) => set({ sourceMediaId }),
    setCaptionStyle: (captionStyle) => set({ captionStyle }),
    setOptions: (partial) => set((s) => ({ options: { ...s.options, ...partial } })),
    setViralClips: (viralClips, mediaId) => set((s) => ({ viralClips, sourceMediaId: mediaId ?? s.sourceMediaId })),

    run: async (mode) => {
        const { sourceMediaId, options, captionStyle } = get();
        if (!sourceMediaId) throw new Error('Choose a video first.');
        get().controller?.abort();
        const controller = new AbortController();
        set({ status: 'running', mode, stage: 'starting', progress: 0, error: null, controller });
        try {
            const job = await runAnalysis(sourceMediaId, mode, options, (stage, progress) => set({ stage, progress }), controller.signal);
            let summary = 'Analysis complete.';

            if (mode === 'subtitles') {
                const words = mapWordsToTimeline(sourceMediaId, job.transcription?.words || []);
                const count = useTimelineStore.getState().addCaptions(words, captionStyle);
                summary = count ? `Added ${count} captions.` : 'No speech was detected in this clip.';
            }
            if (job.viralClips?.length) set({ viralClips: job.viralClips });
            if (mode === 'viral') {
                summary = job.viralClips?.length ? `Found ${job.viralClips.length} moments.` : 'No standout moments found.';
            }
            if (mode === 'auto-edit') {
                const segments = job.keepSegments?.length ? job.keepSegments : job.viralClips || [];
                if (segments.length) {
                    applyKeepSegments(sourceMediaId, segments);
                    summary = `Auto-edit kept ${segments.length} segments on the main track.`;
                } else {
                    summary = 'Auto-edit found nothing to cut.';
                }
            }
            set({ status: 'idle', stage: 'done', progress: 100, controller: null });
            return summary;
        } catch (error) {
            const message = (error as Error).message;
            set({ status: message === 'Cancelled' ? 'idle' : 'error', error: message === 'Cancelled' ? null : message, controller: null });
            throw error;
        }
    },

    cancel: () => {
        get().controller?.abort();
        set({ status: 'idle', controller: null, stage: '', progress: 0 });
    },
}));
