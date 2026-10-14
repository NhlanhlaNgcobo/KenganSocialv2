import { memo, useEffect, useRef, useState } from 'react';
import { EyeOff, Type, VolumeX } from 'lucide-react';
import { TIMELINE } from '../../constants';
import { getWaveformPeaks } from '../../lib/media-processing';
import { getElementEnd, getElementLength } from '../../lib/time';
import { useMediaStore } from '../../stores/media-store';
import { usePlaybackStore } from '../../stores/playback-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';
import type { MediaElement, TimelineElement as El, TimelineTrack } from '../../types';

const waveformCache = new Map<string, Promise<number[]>>();

function useWaveform(mediaId: string | null, file: Blob | undefined) {
    const [peaks, setPeaks] = useState<number[]>([]);
    useEffect(() => {
        if (!mediaId || !file) return;
        let alive = true;
        if (!waveformCache.has(mediaId)) waveformCache.set(mediaId, getWaveformPeaks(file, 400));
        waveformCache.get(mediaId)!.then((p) => alive && setPeaks(p));
        return () => {
            alive = false;
        };
    }, [mediaId, file]);
    return peaks;
}

interface Props {
    element: El;
    track: TimelineTrack;
    pixelsPerSecond: number;
    isSelected: boolean;
    onSnapLine: (time: number | null) => void;
}

type Gesture =
    | { kind: 'move'; startX: number; startY: number; origStart: number; moved: boolean }
    | { kind: 'trim-left' | 'trim-right'; startX: number; orig: El; minStart: number; maxEnd: number };

export const TimelineElement = memo(function TimelineElement({ element, track, pixelsPerSecond, isSelected, onSnapLine }: Props) {
    const media = useMediaStore((s) => (element.type === 'media' ? s.items.find((i) => i.id === element.mediaId) : undefined));
    const [preview, setPreviewState] = useState<{ start: number; dy: number; targetTrackId: string } | null>(null);
    const previewRef = useRef<typeof preview>(null);
    const setPreview = (next: typeof preview) => {
        previewRef.current = next;
        setPreviewState(next);
    };
    const gesture = useRef<Gesture | null>(null);
    const isAudio = media?.type === 'audio';
    const peaks = useWaveform(isAudio ? media!.id : null, isAudio ? media?.file : undefined);

    /** Text and still images have no source length, so trimming resizes them instead. */
    const extendable = element.type === 'text' || media?.type === 'image';

    const snap = (time: number, excludeId: string) => {
        const { snappingEnabled, getSnapPoints } = useTimelineStore.getState();
        if (!snappingEnabled) return { time, line: null as number | null };
        const threshold = TIMELINE.SNAP_THRESHOLD_PX / pixelsPerSecond;
        const points = [...getSnapPoints(excludeId), usePlaybackStore.getState().currentTime];
        let best: number | null = null;
        for (const p of points) if (Math.abs(p - time) <= threshold && (best === null || Math.abs(p - time) < Math.abs(best - time))) best = p;
        return best === null ? { time, line: null } : { time: best, line: best };
    };

    const neighbourBounds = () => {
        const others = track.elements.filter((e) => e.id !== element.id);
        const minStart = Math.max(0, ...others.map(getElementEnd).filter((end) => end <= element.startTime + 1e-3));
        const maxEnd = Math.min(Infinity, ...others.map((e) => e.startTime).filter((s) => s >= getElementEnd(element) - 1e-3));
        return { minStart, maxEnd };
    };

    const onPointerMove = (e: PointerEvent) => {
        const g = gesture.current;
        if (!g) return;
        const dx = (e.clientX - g.startX) / pixelsPerSecond;
        const store = useTimelineStore.getState();

        if (g.kind === 'move') {
            if (!g.moved && Math.abs(e.clientX - g.startX) < 3 && Math.abs(e.clientY - g.startY) < 3) return;
            g.moved = true;
            let start = Math.max(0, g.origStart + dx);
            const length = getElementLength(element);
            const byStart = snap(start, element.id);
            const byEnd = snap(start + length, element.id);
            if (byStart.line !== null) start = byStart.time;
            else if (byEnd.line !== null) start = byEnd.time - length;
            onSnapLine(byStart.line ?? byEnd.line);

            const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-track-id]');
            const hovered = under ? store.tracks.find((t) => t.id === under.dataset.trackId) : undefined;
            const targetTrackId = hovered && hovered.type === track.type ? hovered.id : track.id;
            setPreview({ start: Math.max(0, start), dy: e.clientY - g.startY, targetTrackId });
            return;
        }

        const o = g.orig;
        const speed = o.type === 'media' ? o.speed || 1 : 1;
        const min = TIMELINE.ELEMENT_MIN_DURATION;
        const origEnd = getElementEnd(o);

        if (g.kind === 'trim-left') {
            let newStart = snap(o.startTime + dx, element.id);
            onSnapLine(newStart.line);
            let start = Math.max(g.minStart, Math.min(newStart.time, origEnd - min));
            if (extendable) {
                store.updateElement(track.id, element.id, { startTime: start, duration: origEnd - start }, false);
            } else {
                let trimStart = o.trimStart + (start - o.startTime) * speed;
                trimStart = Math.max(0, Math.min(trimStart, o.duration - o.trimEnd - min * speed));
                start = o.startTime + (trimStart - o.trimStart) / speed;
                store.updateElementTrim(track.id, element.id, trimStart, o.trimEnd, start);
            }
        } else {
            const newEnd = snap(origEnd + dx, element.id);
            onSnapLine(newEnd.line);
            const end = Math.min(g.maxEnd, Math.max(newEnd.time, o.startTime + min));
            if (extendable) {
                store.updateElement(track.id, element.id, { duration: end - o.startTime }, false);
            } else {
                let trimEnd = o.trimEnd - (end - origEnd) * speed;
                trimEnd = Math.max(0, Math.min(trimEnd, o.duration - o.trimStart - min * speed));
                store.updateElementTrim(track.id, element.id, o.trimStart, trimEnd);
            }
        }
    };

    const onPointerUp = () => {
        const g = gesture.current;
        gesture.current = null;
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        onSnapLine(null);
        const p = previewRef.current;
        setPreview(null);
        if (g?.kind === 'move' && g.moved && p) {
            const ok = useTimelineStore.getState().moveElement(track.id, p.targetTrackId, element.id, p.start);
            if (!ok) useUiStore.getState().notify('There is no room there — clips on a track cannot overlap.', 'error');
        }
    };

    const begin = (e: React.PointerEvent, kind: Gesture['kind']) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const store = useTimelineStore.getState();
        const alreadySelected = store.selected.some((s) => s.elementId === element.id);
        if (e.shiftKey || e.metaKey || e.ctrlKey) store.selectElement(track.id, element.id, true);
        else if (!alreadySelected) store.selectElement(track.id, element.id);

        if (kind === 'move') {
            gesture.current = { kind, startX: e.clientX, startY: e.clientY, origStart: element.startTime, moved: false };
        } else {
            store.pushHistory();
            gesture.current = { kind, startX: e.clientX, orig: element, ...neighbourBounds() };
        }
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    };

    useEffect(
        () => () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    const start = preview ? preview.start : element.startTime;
    const width = Math.max(getElementLength(element) * pixelsPerSecond, 4);
    const speed = element.type === 'media' ? element.speed || 1 : 1;

    let body: React.ReactNode = null;
    if (element.type === 'text') {
        body = (
            <span className="ke-el__label">
                <Type size={11} /> {element.content || element.name}
            </span>
        );
    } else if (isAudio) {
        const from = element.trimStart / (element.duration || 1);
        const to = (element.duration - element.trimEnd) / (element.duration || 1);
        const slice = peaks.slice(Math.floor(from * peaks.length), Math.ceil(to * peaks.length));
        body = (
            <>
                <svg className="ke-el__wave" viewBox={`0 0 ${Math.max(slice.length, 1)} 100`} preserveAspectRatio="none">
                    {slice.map((p, i) => (
                        <rect key={i} x={i} y={50 - p * 45} width={0.7} height={Math.max(2, p * 90)} />
                    ))}
                </svg>
                <span className="ke-el__label">{element.name}</span>
            </>
        );
    } else {
        body = (
            <>
                {media?.thumbnailUrl ? (
                    <div className="ke-el__film" style={{ backgroundImage: `url(${media.thumbnailUrl})` }} />
                ) : null}
                <span className="ke-el__label">
                    {element.name}
                    {speed !== 1 ? <em className="ke-el__badge">{speed}x</em> : null}
                </span>
            </>
        );
    }

    const kindClass = element.type === 'text' ? 'is-text' : isAudio ? 'is-audio' : 'is-media';

    return (
        <div
            className={`ke-el ${kindClass} ${isSelected ? 'is-selected' : ''} ${element.hidden ? 'is-hidden' : ''} ${preview ? 'is-dragging' : ''}`}
            style={{
                left: start * pixelsPerSecond,
                width,
                transform: preview ? `translateY(${preview.dy}px)` : undefined,
            }}
            onPointerDown={(e) => begin(e, 'move')}
            onDoubleClick={(e) => {
                e.stopPropagation();
                usePlaybackStore.getState().seek(element.startTime);
            }}
            title={element.type === 'text' ? element.content : element.name}
        >
            {body}
            <div className="ke-el__flags">
                {element.hidden ? <EyeOff size={11} /> : null}
                {(element as MediaElement).muted ? <VolumeX size={11} /> : null}
            </div>
            <div className="ke-el__handle is-left" onPointerDown={(e) => begin(e, 'trim-left')} />
            <div className="ke-el__handle is-right" onPointerDown={(e) => begin(e, 'trim-right')} />
        </div>
    );
});
