/**
 * Video/audio elements kept in sync with the playback clock.
 * Pattern from OpenCut's VideoPlayer/AudioPlayer (MIT).
 */
import { useEffect, useRef } from 'react';
import { FILTER_PREVIEW_CSS } from '../../constants';
import { PLAYBACK_EVENTS, usePlaybackStore } from '../../stores/playback-store';
import type { MediaElement } from '../../types';

interface Props {
    kind: 'video' | 'audio';
    src: string;
    element: MediaElement;
    trackMuted: boolean;
    active: boolean;
}

export function MediaLayer({ kind, src, element, trackMuted, active }: Props) {
    const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
    const isPlaying = usePlaybackStore((s) => s.isPlaying);
    const volume = usePlaybackStore((s) => s.volume);
    const muted = usePlaybackStore((s) => s.muted);
    const globalSpeed = usePlaybackStore((s) => s.speed);
    const speed = (element.speed || 1) * globalSpeed;

    const toSourceTime = (timelineTime: number) => {
        const local = (timelineTime - element.startTime) * (element.speed || 1) + element.trimStart;
        return Math.max(element.trimStart, Math.min(element.duration - element.trimEnd, local));
    };

    // Seek on scrubs; correct drift during playback.
    useEffect(() => {
        const media = ref.current;
        if (!media) return undefined;
        const onSeek = (e: Event) => {
            media.currentTime = toSourceTime((e as CustomEvent).detail.time);
        };
        const onUpdate = (e: Event) => {
            if (!active) return;
            const target = toSourceTime((e as CustomEvent).detail.time);
            if (Math.abs(media.currentTime - target) > 0.3) media.currentTime = target;
        };
        window.addEventListener(PLAYBACK_EVENTS.seek, onSeek);
        window.addEventListener(PLAYBACK_EVENTS.update, onUpdate);
        return () => {
            window.removeEventListener(PLAYBACK_EVENTS.seek, onSeek);
            window.removeEventListener(PLAYBACK_EVENTS.update, onUpdate);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, element.startTime, element.trimStart, element.trimEnd, element.duration, element.speed]);

    // Position the media when it first becomes active or when trims change.
    useEffect(() => {
        const media = ref.current;
        if (media && active) media.currentTime = toSourceTime(usePlaybackStore.getState().currentTime);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, element.trimStart, element.startTime]);

    useEffect(() => {
        const media = ref.current;
        if (!media) return;
        if (isPlaying && active) media.play().catch(() => {});
        else media.pause();
    }, [isPlaying, active]);

    useEffect(() => {
        const media = ref.current;
        if (!media) return;
        media.volume = Math.max(0, Math.min(1, volume * (element.volume ?? 1)));
        media.muted = muted || trackMuted || !!element.muted;
        media.playbackRate = speed;
    }, [volume, muted, trackMuted, element.muted, element.volume, speed]);

    if (kind === 'audio') {
        return <audio ref={ref} src={src} preload="auto" />;
    }

    return (
        <video
            ref={ref}
            src={src}
            className="ke-preview__media"
            style={{ visibility: active ? 'visible' : 'hidden', filter: FILTER_PREVIEW_CSS[element.filter || 'none'] }}
            playsInline
            preload="auto"
            disablePictureInPicture
            onContextMenu={(e) => e.preventDefault()}
        />
    );
}
