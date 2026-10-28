/**
 * Playback clock. A requestAnimationFrame loop advances the timeline time and
 * broadcasts `editor-playback-*` window events that media players sync to.
 * Adapted from OpenCut's playback-store (MIT).
 */
import { create } from 'zustand';
import { DEFAULT_FPS } from '../constants';
import { useTimelineStore } from './timeline-store';
import { perfSeekStart } from '../lib/perf';

export const PLAYBACK_EVENTS = {
    seek: 'editor-playback-seek',
    update: 'editor-playback-update',
} as const;

interface PlaybackState {
    isPlaying: boolean;
    currentTime: number;
    volume: number;
    muted: boolean;
    speed: number;
    loop: boolean;
    play: () => void;
    pause: () => void;
    toggle: () => void;
    seek: (time: number) => void;
    setVolume: (volume: number) => void;
    toggleMute: () => void;
    setSpeed: (speed: number) => void;
    toggleLoop: () => void;
}

let frame: number | null = null;
let lastTick = 0;

/**
 * Media that is seeking or buffering. The clock waits for it, so the picture and the playhead stay
 * together: otherwise a slow seek (e.g. phone footage with keyframes seconds apart) falls behind,
 * the drift correction seeks again, and the frame never updates. Capped so a broken file can't
 * hold the playhead forever.
 */
const stalled = new Set<object>();
let stalledSince = 0;
const MAX_STALL_MS = 4000;

export function setMediaStalled(media: object, isStalled: boolean) {
    if (isStalled) {
        if (!stalled.size) stalledSince = performance.now();
        stalled.add(media);
    } else {
        stalled.delete(media);
    }
}

const emit = (name: string, time: number) => window.dispatchEvent(new CustomEvent(name, { detail: { time } }));

const contentDuration = () => useTimelineStore.getState().getTotalDuration();

export const usePlaybackStore = create<PlaybackState>((set, get) => {
    const tick = () => {
        const state = get();
        if (!state.isPlaying) return;
        const now = performance.now();
        const delta = (now - lastTick) / 1000;
        lastTick = now;
        if (stalled.size && now - stalledSince < MAX_STALL_MS) {
            frame = requestAnimationFrame(tick);
            return;
        }

        const end = contentDuration();
        let next = state.currentTime + delta * state.speed;

        if (end <= 0 || next >= end) {
            if (state.loop && end > 0) {
                next = 0;
                set({ currentTime: next });
                emit(PLAYBACK_EVENTS.seek, next);
            } else {
                const stopAt = Math.max(0, end - 1 / DEFAULT_FPS);
                set({ isPlaying: false, currentTime: stopAt });
                emit(PLAYBACK_EVENTS.seek, stopAt);
                frame = null;
                return;
            }
        } else {
            set({ currentTime: next });
            emit(PLAYBACK_EVENTS.update, next);
        }
        frame = requestAnimationFrame(tick);
    };

    return {
        isPlaying: false,
        currentTime: 0,
        volume: 1,
        muted: false,
        speed: 1,
        loop: false,

        play: () => {
            const end = contentDuration();
            if (end <= 0) return;
            if (get().currentTime >= end - 1 / DEFAULT_FPS) get().seek(0);
            set({ isPlaying: true });
            lastTick = performance.now();
            if (frame) cancelAnimationFrame(frame);
            frame = requestAnimationFrame(tick);
        },
        pause: () => {
            set({ isPlaying: false });
            if (frame) cancelAnimationFrame(frame);
            frame = null;
        },
        toggle: () => (get().isPlaying ? get().pause() : get().play()),
        seek: (time) => {
            perfSeekStart();
            const end = Math.max(contentDuration(), 0);
            const clamped = Math.max(0, Math.min(end || time, time));
            set({ currentTime: clamped });
            emit(PLAYBACK_EVENTS.seek, clamped);
        },
        setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)), muted: volume === 0 }),
        toggleMute: () => set((s) => ({ muted: !s.muted })),
        setSpeed: (speed) => set({ speed: Math.max(0.25, Math.min(2, speed)) }),
        toggleLoop: () => set((s) => ({ loop: !s.loop })),
    };
});
