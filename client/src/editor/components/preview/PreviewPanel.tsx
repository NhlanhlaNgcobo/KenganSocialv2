import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Expand, Minimize, Pause, Play, Repeat, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { FILTER_PREVIEW_CSS } from '../../constants';
import { formatTimecode, getElementEnd, getElementLength } from '../../lib/time';
import { cssTransform, getTransform } from '../../lib/transform';
import { useMediaStore } from '../../stores/media-store';
import { usePlaybackStore } from '../../stores/playback-store';
import { getCanvasSize, useProjectStore } from '../../stores/project-store';
import { useTimelineStore } from '../../stores/timeline-store';
import type { AspectRatio, MediaElement, TextElement } from '../../types';
import { GuideTrackPlayer } from './GuideTrackPlayer';
import { LyricOverlay } from './LyricOverlay';
import { MediaLayer } from './MediaLayer';

/** Elements this far ahead of the playhead are mounted early so cuts don't stall. */
const PRELOAD_SECONDS = 2.5;

export function PreviewPanel() {
    const tracks = useTimelineStore((s) => s.tracks);
    const selected = useTimelineStore((s) => s.selected);
    const selectElement = useTimelineStore((s) => s.selectElement);
    const updateElement = useTimelineStore((s) => s.updateElement);
    const pushHistory = useTimelineStore((s) => s.pushHistory);
    const totalDuration = useTimelineStore((s) => s.getTotalDuration());
    const items = useMediaStore((s) => s.items);
    const { currentTime, isPlaying, toggle, seek, muted, toggleMute, loop, toggleLoop } = usePlaybackStore();
    const { ratio, setRatio, backgroundColor, fps } = useProjectStore();
    const canvas = getCanvasSize(ratio);

    const containerRef = useRef<HTMLDivElement>(null);
    const [box, setBox] = useState({ width: 0, height: 0 });
    const [fullscreen, setFullscreen] = useState(false);
    type TextDrag = { trackId: string; id: string; startX: number; startY: number; x: number; y: number; dx: number; dy: number };
    const [drag, setDragState] = useState<TextDrag | null>(null);
    const dragRef = useRef<TextDrag | null>(null);
    const setDrag = (next: TextDrag | null) => {
        dragRef.current = next;
        setDragState(next);
    };

    // Fit the canvas into the stage's content box while keeping its aspect ratio.
    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return undefined;
        const measure = () => {
            const style = getComputedStyle(el);
            const width = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            const height = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
            const scale = Math.max(0, Math.min(width / canvas.width, height / canvas.height));
            setBox({ width: Math.floor(canvas.width * scale), height: Math.floor(canvas.height * scale) });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [canvas.width, canvas.height, fullscreen]);

    const scale = box.width / canvas.width || 0;

    // Bottom track first so higher tracks paint on top.
    const layers = useMemo(() => {
        const ordered = [...tracks].reverse();
        return ordered.flatMap((track, trackIndex) =>
            track.elements
                .filter((el) => !el.hidden)
                .filter((el) => currentTime >= el.startTime - PRELOAD_SECONDS && currentTime < getElementEnd(el) + 0.25)
                .map((el) => ({
                    track,
                    element: el,
                    z: trackIndex,
                    active: currentTime >= el.startTime && currentTime < getElementEnd(el),
                }))
        );
    }, [tracks, currentTime]);

    const dragging = drag !== null;
    useEffect(() => {
        if (!dragging) return undefined;
        const onMove = (e: PointerEvent) => {
            const d = dragRef.current;
            if (d) setDrag({ ...d, dx: (e.clientX - d.startX) / scale, dy: (e.clientY - d.startY) / scale });
        };
        const onUp = () => {
            const d = dragRef.current;
            setDrag(null);
            if (d && (Math.abs(d.dx) > 1 || Math.abs(d.dy) > 1)) {
                pushHistory();
                updateElement(d.trackId, d.id, { x: Math.round(d.x + d.dx), y: Math.round(d.y + d.dy) }, false);
            }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
    }, [dragging, scale, pushHistory, updateElement]);

    const renderText = (trackId: string, el: TextElement, z: number) => {
        const isDragging = drag?.id === el.id;
        const x = el.x + (isDragging ? drag!.dx : 0);
        const y = el.y + (isDragging ? drag!.dy : 0);
        const isSelected = selected.some((s) => s.elementId === el.id);
        return (
            <div
                key={el.id}
                className={`ke-preview__text ${isSelected ? 'is-selected' : ''}`}
                style={{
                    left: `${50 + (x / canvas.width) * 100}%`,
                    top: `${50 + (y / canvas.height) * 100}%`,
                    transform: `translate(-50%, -50%) rotate(${el.rotation}deg)`,
                    opacity: el.opacity,
                    zIndex: 100 + z,
                }}
                onPointerDown={(e) => {
                    e.stopPropagation();
                    selectElement(trackId, el.id);
                    setDrag({ trackId, id: el.id, startX: e.clientX, startY: e.clientY, x: el.x, y: el.y, dx: 0, dy: 0 });
                }}
            >
                <div
                    style={{
                        fontSize: el.fontSize * scale,
                        fontFamily: el.fontFamily,
                        color: el.color,
                        backgroundColor: el.backgroundColor,
                        textAlign: el.textAlign,
                        fontWeight: el.fontWeight,
                        fontStyle: el.fontStyle,
                        padding: `${6 * scale}px ${12 * scale}px`,
                        borderRadius: 6 * scale,
                        whiteSpace: 'pre',
                        lineHeight: 1.15,
                        textShadow: el.backgroundColor === 'transparent' ? `0 ${2 * scale}px ${6 * scale}px rgba(0,0,0,0.6)` : undefined,
                    }}
                >
                    {el.content}
                </div>
            </div>
        );
    };

    const empty = !tracks.some((t) => t.elements.length);

    return (
        <div className={`ke-panel ke-preview ${fullscreen ? 'is-fullscreen' : ''}`}>
            <div className="ke-preview__stage" ref={containerRef}>
                <div
                    className="ke-preview__canvas"
                    style={{ width: box.width, height: box.height, background: backgroundColor }}
                    onPointerDown={() => useTimelineStore.getState().clearSelection()}
                >
                    {empty ? (
                        <div className="ke-preview__empty">
                            <p>Drop media on the timeline to start</p>
                        </div>
                    ) : null}
                    {layers.map(({ track, element, z, active }) => {
                        if (element.type === 'text') {
                            return active ? renderText(track.id, element, z) : null;
                        }
                        const media = items.find((i) => i.id === (element as MediaElement).mediaId);
                        if (!media) return null;
                        const progress = (currentTime - element.startTime) / Math.max(getElementLength(element), 0.001);
                        const clipTransform = getTransform(element as MediaElement);
                        // Zoom animation renders on the main track only; keep preview and export identical.
                        if (!track.isMain) clipTransform.animation = 'none';
                        const transform = cssTransform(clipTransform, progress, scale);
                        if (media.type === 'image') {
                            return active ? (
                                <img
                                    key={element.id}
                                    src={media.url}
                                    alt=""
                                    className="ke-preview__media"
                                    style={{ zIndex: z, filter: FILTER_PREVIEW_CSS[(element as MediaElement).filter || 'none'], transform }}
                                    draggable={false}
                                />
                            ) : null;
                        }
                        return (
                            <div key={element.id} className="ke-preview__layer" style={{ zIndex: z, transform }}>
                                <MediaLayer
                                    kind={media.type === 'audio' ? 'audio' : 'video'}
                                    src={media.url}
                                    element={element as MediaElement}
                                    trackMuted={!!track.muted}
                                    active={active}
                                />
                            </div>
                        );
                    })}
                    <LyricOverlay scale={scale} />
                </div>
                <GuideTrackPlayer />
            </div>

            <div className="ke-preview__toolbar">
                <div className="ke-preview__time">
                    <span className="ke-mono">{formatTimecode(currentTime, fps)}</span>
                    <span className="ke-muted"> / </span>
                    <span className="ke-mono ke-muted">{formatTimecode(totalDuration, fps)}</span>
                </div>
                <div className="ke-preview__transport">
                    <button className="ke-icon-btn" title="Back 1 frame (←)" onClick={() => seek(currentTime - 1 / fps)}>
                        <SkipBack size={16} />
                    </button>
                    <button className="ke-play-btn" title="Play/Pause (Space)" onClick={toggle} disabled={empty}>
                        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                    </button>
                    <button className="ke-icon-btn" title="Forward 1 frame (→)" onClick={() => seek(currentTime + 1 / fps)}>
                        <SkipForward size={16} />
                    </button>
                </div>
                <div className="ke-preview__right">
                    <button className={`ke-icon-btn ${loop ? 'is-active' : ''}`} title="Loop" onClick={toggleLoop}>
                        <Repeat size={15} />
                    </button>
                    <button className="ke-icon-btn" title={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>
                        {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                    </button>
                    <select className="ke-select ke-select--sm" value={ratio} onChange={(e) => setRatio(e.target.value as AspectRatio)} title="Canvas size">
                        <option value="9:16">9:16</option>
                        <option value="1:1">1:1</option>
                        <option value="16:9">16:9</option>
                    </select>
                    <button className="ke-icon-btn" title={fullscreen ? 'Exit full view' : 'Full view'} onClick={() => setFullscreen((f) => !f)}>
                        {fullscreen ? <Minimize size={15} /> : <Expand size={15} />}
                    </button>
                </div>
            </div>
        </div>
    );
}
