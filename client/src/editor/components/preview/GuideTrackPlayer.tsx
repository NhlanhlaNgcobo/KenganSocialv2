import { useEffect, useRef } from 'react';
import { audiomackApi } from '../../../lib/audiomack-api';
import { PLAYBACK_EVENTS, usePlaybackStore } from '../../stores/playback-store';
import { useGuideTrackStore } from '../../stores/guide-track-store';

const DRIFT_TOLERANCE = 0.3;
const MAX_REFRESHES = 3;

/**
 * Plays the Audiomack guide track in step with the editor clock. Renders
 * nothing; the audio element lives outside the timeline and export.
 */
export function GuideTrackPlayer() {
    const url = useGuideTrackStore((s) => s.url);
    const volume = useGuideTrackStore((s) => s.volume);
    const offset = useGuideTrackStore((s) => s.offset);
    const isPlaying = usePlaybackStore((s) => s.isPlaying);
    const masterVolume = usePlaybackStore((s) => s.volume);
    const muted = usePlaybackStore((s) => s.muted);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const offsetRef = useRef(offset);
    offsetRef.current = offset;

    // One element per stream URL. Audiomack URLs expire fast, so on error fetch
    // a fresh one and carry on from the same spot.
    useEffect(() => {
        if (!url) return undefined;
        const audio = new Audio(url);
        audio.preload = 'auto';
        audioRef.current = audio;
        let refreshes = 0;

        const onMetadata = () => {
            if (Number.isFinite(audio.duration)) useGuideTrackStore.getState().setDuration(audio.duration);
        };
        const onError = async () => {
            if (refreshes >= MAX_REFRESHES) {
                useGuideTrackStore.getState().setError('The Audiomack stream stopped. Pick the track again.');
                return;
            }
            refreshes += 1;
            const resumeAt = audio.currentTime;
            try {
                // Swap the source in place rather than via the store's `url`, which would rebuild this element.
                const { track } = useGuideTrackStore.getState();
                if (!track) return;
                audio.src = await audiomackApi.playUrl(track.id);
                audio.currentTime = resumeAt;
                if (usePlaybackStore.getState().isPlaying) await audio.play();
            } catch (error) {
                useGuideTrackStore.getState().setError((error as Error).message);
            }
        };

        audio.addEventListener('loadedmetadata', onMetadata);
        audio.addEventListener('error', onError);
        return () => {
            audio.pause();
            audio.removeEventListener('loadedmetadata', onMetadata);
            audio.removeEventListener('error', onError);
            audioRef.current = null;
        };
    }, [url]);

    useEffect(() => {
        if (audioRef.current) audioRef.current.volume = muted ? 0 : volume * masterVolume;
    }, [volume, masterVolume, muted, url]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        if (isPlaying) {
            audio.currentTime = offsetRef.current + usePlaybackStore.getState().currentTime;
            void audio.play().catch(() => undefined);
        } else {
            audio.pause();
        }
    }, [isPlaying, url]);

    // Follow seeks, and correct drift while playing.
    useEffect(() => {
        const onSeek = (e: Event) => {
            const audio = audioRef.current;
            if (audio) audio.currentTime = offsetRef.current + (e as CustomEvent<{ time: number }>).detail.time;
        };
        const onUpdate = (e: Event) => {
            const audio = audioRef.current;
            if (!audio || audio.paused) return;
            const expected = offsetRef.current + (e as CustomEvent<{ time: number }>).detail.time;
            if (Math.abs(audio.currentTime - expected) > DRIFT_TOLERANCE) audio.currentTime = expected;
        };
        window.addEventListener(PLAYBACK_EVENTS.seek, onSeek);
        window.addEventListener(PLAYBACK_EVENTS.update, onUpdate);
        return () => {
            window.removeEventListener(PLAYBACK_EVENTS.seek, onSeek);
            window.removeEventListener(PLAYBACK_EVENTS.update, onUpdate);
        };
    }, []);

    // Changing the offset while paused moves the song's playhead too.
    useEffect(() => {
        const audio = audioRef.current;
        if (audio && audio.paused) audio.currentTime = offset + usePlaybackStore.getState().currentTime;
    }, [offset]);

    return null;
}
