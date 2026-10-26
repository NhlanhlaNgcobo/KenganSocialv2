/**
 * Video/audio elements kept in sync with the playback clock.
 * Pattern from OpenCut's VideoPlayer/AudioPlayer (MIT).
 */
import { useEffect, useRef, useState } from 'react';
import { previewFilter } from '../../lib/grade';
import { isNeutralColor } from '../../lib/color-pipeline.js';
import { useProjectStore } from '../../stores/project-store';
import { GradedCanvas, useLut, webgl2Available } from './GradedCanvas';
import { PLAYBACK_EVENTS, setMediaStalled, usePlaybackStore } from '../../stores/playback-store';
import type { ChromaKey, MediaElement } from '../../types';

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
    /** Green/blue screen key (overlay tracks only, as in the export). */
    chromaKey?: ChromaKey | null;
}

export function MediaLayer({ kind, src, element, trackMuted, active, extendHead = 0, extendTail = 0, extraFilter = '', chromaKey = null }: Props) {
    const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
    const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
    const luts = useProjectStore((s) => s.luts);
    const graded = kind === 'video' && webgl2Available && !!element.color && !isNeutralColor(element.color);
    const lut = useLut(graded ? element.color : null, luts);
    const keyed = kind === 'video' && webgl2Available && !!chromaKey;
    const onCanvas = (graded && !!lut) || keyed;
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
            // Let a pending seek land: seeking again would cancel it and freeze the picture.
            if (!active || media.seeking) return;
            const target = toSourceTime((e as CustomEvent).detail.time);
            const drift = target - media.currentTime; // > 0: the media is behind the playhead
            if (Math.abs(drift) > 1) {
                media.playbackRate = speed;
                media.currentTime = target;
                return;
            }
            // Small drift: nudge the rate instead of seeking. A seek restarts decoding from the previous
            // keyframe, which on phone footage (keyframes seconds apart) takes longer than the drift it
            // fixes, so the next update seeks again and the picture never moves.
            media.playbackRate = Math.abs(drift) > 0.05 ? speed * (1 + Math.max(-0.25, Math.min(0.25, drift))) : speed;
        };
        window.addEventListener(PLAYBACK_EVENTS.seek, onSeek);
        window.addEventListener(PLAYBACK_EVENTS.update, onUpdate);
        return () => {
            window.removeEventListener(PLAYBACK_EVENTS.seek, onSeek);
            window.removeEventListener(PLAYBACK_EVENTS.update, onUpdate);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, speed, element.startTime, element.trimStart, element.trimEnd, element.duration, element.speed, extendHead, extendTail]);

    // While the visible clip seeks or buffers, hold the playback clock (see setMediaStalled).
    useEffect(() => {
        const media = ref.current;
        if (!media || !active) return undefined;
        const stall = () => setMediaStalled(media, true);
        const resume = () => setMediaStalled(media, false);
        const events: [string, () => void][] = [
            ['seeking', stall],
            ['waiting', stall],
            ['seeked', resume],
            ['playing', resume],
            ['canplay', resume],
            ['error', resume],
        ];
        events.forEach(([name, fn]) => media.addEventListener(name, fn));
        if (media.seeking) stall();
        return () => {
            events.forEach(([name, fn]) => media.removeEventListener(name, fn));
            resume();
        };
    }, [active]);

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
        else {
            media.pause();
            media.playbackRate = speed; // drop any drift nudge
        }
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
                // A graded or keyed clip keeps decoding in this (invisible) element; the canvas shows it.
                style={{ visibility: active ? 'visible' : 'hidden', opacity: onCanvas ? 0 : 1, filter }}
                playsInline
                preload="auto"
                disablePictureInPicture
                onContextMenu={(e) => e.preventDefault()}
            />
            {onCanvas ? <GradedCanvas source={videoEl} lut={graded ? lut : null} chromaKey={keyed ? chromaKey : null} className="ke-preview__media" style={{ visibility: active ? 'visible' : 'hidden', filter }} /> : null}
        </>
    );
}
