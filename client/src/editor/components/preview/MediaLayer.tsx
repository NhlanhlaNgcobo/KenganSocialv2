/**
 * Video/audio elements kept in sync with the playback clock.
 * Pattern from OpenCut's VideoPlayer/AudioPlayer (MIT).
 */
import { useEffect, useRef, useState } from 'react';
import { previewFilter } from '../../lib/grade';
import { isNeutralColor } from '../../lib/color-pipeline.js';
import { useProjectStore } from '../../stores/project-store';
import { GradedCanvas, useLut, webgl2Available } from './GradedCanvas';
import { PLAYBACK_EVENTS, usePlaybackStore } from '../../stores/playback-store';
import type { MediaElement } from '../../types';

interface Props {
    kind: 'video' | 'audio';
    src: string;
    element: MediaElement;
    trackMuted: boolean;
    active: boolean;
    /** Seconds the clip keeps playing before its start / after its end (transitions). */
    extendHead?: number;
    extendTail?: number;
    /** Extra CSS filter (effects preview). */
    extraFilter?: string;
}

export function MediaLayer({ kind, src, element, trackMuted, active, extendHead = 0, extendTail = 0, extraFilter = '' }: Props) {
    const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
    const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
    const luts = useProjectStore((s) => s.luts);
    const graded = kind === 'video' && webgl2Available && !!element.color && !isNeutralColor(element.color);
    const lut = useLut(graded ? element.color : null, luts);
    const isPlaying = usePlaybackStore((s) => s.isPlaying);
    const volume = usePlaybackStore((s) => s.volume);
    const muted = usePlaybackStore((s) => s.muted);
    const globalSpeed = usePlaybackStore((s) => s.speed);
    const speed = (element.speed || 1) * globalSpeed;

    const toSourceTime = (timelineTime: number) => {
        // Transitions borrow footage beyond the trim (or freeze the edge frame when there is none).
        const speed = element.speed || 1;
        const local = (timelineTime - element.startTime) * speed + element.trimStart;
        const lo = Math.max(0, element.trimStart - extendHead * speed);
        const hi = Math.min(element.duration, element.duration - element.trimEnd + extendTail * speed);
        return Math.max(lo, Math.min(hi, local));
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
    }, [active, element.startTime, element.trimStart, element.trimEnd, element.duration, element.speed, extendHead, extendTail]);

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

    const filter = `${previewFilter(element.filter, element.grade)}${extraFilter}`.replace(/^none /, '');
    return (
        <>
            <video
                ref={(el) => {
                    (ref as React.MutableRefObject<HTMLVideoElement | null>).current = el;
                    if (el !== videoEl) setVideoEl(el);
                }}
                src={src}
                className="ke-preview__media"
                // A graded clip keeps decoding in this (invisible) element; the canvas shows it graded.
                style={{ visibility: active ? 'visible' : 'hidden', opacity: graded ? 0 : 1, filter }}
                playsInline
                preload="auto"
                disablePictureInPicture
                onContextMenu={(e) => e.preventDefault()}
            />
            {graded && lut ? <GradedCanvas source={videoEl} lut={lut} className="ke-preview__media" style={{ visibility: active ? 'visible' : 'hidden', filter }} /> : null}
        </>
    );
}
