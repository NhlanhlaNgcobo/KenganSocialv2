/**
 * Lyric analysis + visualizer state. Lyrics are timed in *song* seconds; the
 * source decides how song time maps onto the timeline:
 *  - an audio clip on the timeline: song = (t - startTime) * speed + trimStart
 *  - the Audiomack guide track:     song = t + guide offset
 */
import { create } from 'zustand';
import { apiClient } from '../../lib/api';
import { analyzeAudioBlob, type AudioFeatures } from '../lib/audio-features';
import { getElementEnd } from '../lib/time';
import { isLyricAnalysis, shiftAnalysis, type LyricAnalysis, type LyricStyle } from '../lib/lyrics';
import { useGuideTrackStore } from './guide-track-store';
import { useMediaStore } from './media-store';
import { useTimelineStore } from './timeline-store';
import type { MediaElement } from '../types';

export type LyricSource = { kind: 'element'; elementId: string } | { kind: 'guide' };

interface LyricsState {
    source: LyricSource | null;
    lyricsText: string;
    analysis: LyricAnalysis | null;
    features: AudioFeatures | null;
    style: LyricStyle;
    visible: boolean;
    analyzing: boolean;
    error: string | null;
    setSource: (source: LyricSource | null) => void;
    setLyricsText: (text: string) => void;
    setStyle: (style: LyricStyle) => void;
    setVisible: (visible: boolean) => void;
    analyze: () => Promise<LyricAnalysis>;
    nudge: (deltaSec: number) => void;
    clear: () => void;
}

// Decoding a song takes a moment; reuse features per media item.
const featureCache = new Map<string, AudioFeatures>();

function findSourceElement(elementId: string): MediaElement | null {
    const found = useTimelineStore.getState().findElement(elementId);
    return found && found.element.type === 'media' ? (found.element as MediaElement) : null;
}

/** Song time playing at timeline time `t`, or null when the source isn't sounding. */
export function songTimeAt(source: LyricSource | null, t: number): number | null {
    if (!source) return null;
    if (source.kind === 'guide') {
        const { track, offset } = useGuideTrackStore.getState();
        return track ? t + offset : null;
    }
    const el = findSourceElement(source.elementId);
    if (!el || el.hidden || t < el.startTime || t >= getElementEnd(el)) return null;
    return (t - el.startTime) * (el.speed || 1) + el.trimStart;
}

/** Timeline time at which song time `song` plays, or null if it's outside the clip. */
export function timelineTimeOf(source: LyricSource | null, song: number): number | null {
    if (!source) return null;
    if (source.kind === 'guide') {
        const { offset } = useGuideTrackStore.getState();
        return song - offset >= 0 ? song - offset : null;
    }
    const el = findSourceElement(source.elementId);
    if (!el) return null;
    const t = (song - el.trimStart) / (el.speed || 1) + el.startTime;
    return t >= el.startTime && t < getElementEnd(el) ? t : null;
}

export const useLyricsStore = create<LyricsState>((set, get) => ({
    source: null,
    lyricsText: '',
    analysis: null,
    features: null,
    style: 'karaoke',
    visible: true,
    analyzing: false,
    error: null,

    setSource: (source) => set({ source, analysis: null, features: null, error: null }),
    setLyricsText: (lyricsText) => set({ lyricsText }),
    setStyle: (style) => set({ style }),
    setVisible: (visible) => set({ visible }),

    analyze: async () => {
        const { source, lyricsText } = get();
        if (!source) throw new Error('Pick the song to analyze first.');

        set({ analyzing: true, error: null });
        try {
            const form = new FormData();
            let duration = 0;
            let features: AudioFeatures | null = null;

            if (source.kind === 'guide') {
                // Audiomack audio is stream-only, so it can't be uploaded for transcription.
                if (!lyricsText.trim()) throw new Error('Paste the lyrics for Audiomack tracks. They are streamed, not downloaded, so they can’t be transcribed.');
                const guide = useGuideTrackStore.getState();
                duration = guide.duration || guide.track?.durationSec || 0;
                if (!duration) throw new Error('Play the Audiomack track once so its length is known, then try again.');
            } else {
                const el = findSourceElement(source.elementId);
                const media = el ? useMediaStore.getState().getItem(el.mediaId) : undefined;
                if (!el || !media) throw new Error('That clip is no longer on the timeline.');
                features = featureCache.get(media.id) ?? null;
                if (!features) {
                    features = await analyzeAudioBlob(media.file).catch(() => null);
                    if (features) featureCache.set(media.id, features);
                }
                duration = features?.duration || media.duration;
                form.append('file', media.file, media.name.includes('.') ? media.name : `${media.name}.mp3`);
                if (features) form.append('energy', String(features.averageEnergy));
            }

            form.append('lyrics', lyricsText);
            form.append('duration', String(duration));

            const payload = await apiClient('/lyrics/analyze', { method: 'POST', body: form });
            if (!isLyricAnalysis(payload)) throw new Error('The lyric analyzer returned an unexpected response.');

            set({ analysis: payload, features, style: payload.suggestedStyle, visible: true, analyzing: false });
            return payload;
        } catch (error) {
            set({ analyzing: false, error: (error as Error).message });
            throw error;
        }
    },

    nudge: (deltaSec) => set((s) => ({ analysis: s.analysis ? shiftAnalysis(s.analysis, deltaSec) : null })),
    clear: () => set({ analysis: null, features: null, error: null }),
}));
