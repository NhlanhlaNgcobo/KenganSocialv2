/**
 * Audiomack guide track: a song streamed alongside the preview so you can cut
 * to it. It is never placed on the timeline, uploaded, or exported (Audiomack
 * streams are playback-only), so add the licensed sound on the platform when posting.
 */
import { create } from 'zustand';
import { audiomackApi, type AudiomackTrack } from '../../lib/audiomack-api';

interface GuideTrackState {
    track: AudiomackTrack | null;
    /** Short-lived stream URL; refreshed by the player when it expires. */
    url: string | null;
    /** Seconds into the song that line up with timeline 0. */
    offset: number;
    volume: number;
    /** From the <audio> element once metadata loads. */
    duration: number;
    loading: boolean;
    error: string | null;
    load: (track: AudiomackTrack) => Promise<void>;
    refreshUrl: () => Promise<string | null>;
    clear: () => void;
    setOffset: (offset: number) => void;
    setVolume: (volume: number) => void;
    setDuration: (duration: number) => void;
    setError: (error: string | null) => void;
}

export const useGuideTrackStore = create<GuideTrackState>((set, get) => ({
    track: null,
    url: null,
    offset: 0,
    volume: 0.8,
    duration: 0,
    loading: false,
    error: null,

    load: async (track) => {
        set({ loading: true, error: null });
        try {
            const url = await audiomackApi.playUrl(track.id);
            set({ track, url, offset: 0, duration: track.durationSec ?? 0, loading: false });
        } catch (error) {
            set({ loading: false, error: (error as Error).message });
            throw error;
        }
    },

    refreshUrl: async () => {
        const { track } = get();
        if (!track) return null;
        const url = await audiomackApi.playUrl(track.id);
        set({ url });
        return url;
    },

    clear: () => set({ track: null, url: null, offset: 0, duration: 0, error: null }),
    setOffset: (offset) => set({ offset: Math.max(0, offset) }),
    setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
    setDuration: (duration) => set({ duration }),
    setError: (error) => set({ error }),
}));
