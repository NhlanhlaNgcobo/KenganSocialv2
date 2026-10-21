import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Film, Music, Trash2, Type, Volume2, VolumeX } from 'lucide-react';
import { TIMELINE, TRACK_HEIGHTS } from '../../constants';
import { timelineBeats } from '../../lib/beat-sync';
import { canTransition, TRANSITIONS } from '../../lib/fx';
import { usePlaybackStore } from '../../stores/playback-store';
import { useMediaStore } from '../../stores/media-store';
import { useProjectStore } from '../../stores/project-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';
import { DRAG_MIME, type DragData, type MediaElement, type MediaItem, type TimelineTrack } from '../../types';
import { TimelineElement } from './TimelineElement';
import { TimelineRuler } from './TimelineRuler';
import { TimelineToolbar } from './TimelineToolbar';

const LABEL_W = TIMELINE.TRACK_LABEL_WIDTH;
const RULER_H = 28;

const TRACK_ICONS = { media: Film, text: Type, audio: Music };

export function Timeline() {
    const tracks = useTimelineStore((s) => s.tracks);
    const selected = useTimelineStore((s) => s.selected);
    const totalDuration = useTimelineStore((s) => s.getTotalDuration());
    const currentTime = usePlaybackStore((s) => s.currentTime);
    const isPlaying = usePlaybackStore((s) => s.isPlaying);
    const zoom = useUiStore((s) => s.zoom);
    const setZoom = useUiStore((s) => s.setZoom);
    const notify = useUiStore((s) => s.notify);

    const scrollRef = useRef<HTMLDivElement>(null);
    const [viewportWidth, setViewportWidth] = useState(800);
    const [snapLine, setSnapLine] = useState<number | null>(null);
    const [dropTarget, setDropTarget] = useState<string | null>(null);

    const pps = TIMELINE.PIXELS_PER_SECOND * zoom;
    const beatMarks = useMemo(() => timelineBeats(tracks), [tracks]);
    // Beat ticks thin out when zoomed far out (at least 4 px apart; downbeats and markers always show).
    const downSet = useMemo(() => new Set(beatMarks.downbeats), [beatMarks]);
    const showAllBeats = beatMarks.beats.length < 2 || (beatMarks.beats[1] - beatMarks.beats[0]) * pps >= 4;
    const visibleSeconds = Math.max(totalDuration + 10, TIMELINE.MIN_VISIBLE_SECONDS, (viewportWidth - LABEL_W) / pps);
    const contentWidth = visibleSeconds * pps;

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return undefined;
        const observer = new ResizeObserver(() => setViewportWidth(el.clientWidth));
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Keep the playhead in view while playing.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el || !isPlaying) return;
        const x = currentTime * pps;
        const visibleStart = el.scrollLeft;
        const visibleEnd = el.scrollLeft + el.clientWidth - LABEL_W;
        if (x > visibleEnd - 40 || x < visibleStart) el.scrollLeft = Math.max(0, x - 80);
    }, [currentTime, isPlaying, pps]);

    // Ctrl/Cmd + wheel zooms around the pointer, like OpenCut.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return undefined;
        const onWheel = (e: WheelEvent) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            const { zoom: z } = useUiStore.getState();
            const next = Math.min(TIMELINE.MAX_ZOOM, Math.max(TIMELINE.MIN_ZOOM, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
            const rect = el.getBoundingClientRect();
            const pointerX = e.clientX - rect.left - LABEL_W + el.scrollLeft;
            const time = pointerX / (TIMELINE.PIXELS_PER_SECOND * z);
            setZoom(next);
            requestAnimationFrame(() => {
                el.scrollLeft = Math.max(0, time * TIMELINE.PIXELS_PER_SECOND * next - (e.clientX - rect.left - LABEL_W));
            });
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [setZoom]);

    const timeFromClientX = useCallback(
        (clientX: number) => {
            const el = scrollRef.current;
            if (!el) return 0;
            const rect = el.getBoundingClientRect();
            return Math.max(0, (clientX - rect.left - LABEL_W + el.scrollLeft) / pps);
        },
        [pps]
    );

    const startScrub = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        const seek = usePlaybackStore.getState().seek;
        seek(timeFromClientX(e.clientX));
        const move = (ev: PointerEvent) => seek(timeFromClientX(ev.clientX));
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };

    const readDrag = (e: React.DragEvent): DragData | null => {
        try {
            const raw = e.dataTransfer.getData(DRAG_MIME);
            return raw ? (JSON.parse(raw) as DragData) : null;
        } catch {
            return null;
        }
    };

    const addItemAt = (item: MediaItem, time: number, trackId?: string, forceNewTrack = false) => {
        const store = useTimelineStore.getState();
        const target = forceNewTrack ? store.addTrack(item.type === 'audio' ? 'audio' : 'media') : trackId;
        if (!store.addMediaAtTime(item, time, target)) notify(`Could not place ${item.name}.`, 'error');
    };

    /** Dropping on a lane targets that track; dropping below the tracks creates a new one. */
    const handleDrop = async (e: React.DragEvent, track?: TimelineTrack) => {
        e.preventDefault();
        setDropTarget(null);
        const forceNewTrack = !track;
        const time = timeFromClientX(e.clientX);
        const data = readDrag(e);

        if (data?.kind === 'text') {
            const store = useTimelineStore.getState();
            const textTrackId = forceNewTrack ? store.insertTrackAt('text', 0) : track?.type === 'text' ? track.id : undefined;
            store.addTextAtTime(time, { name: data.content, ...data.style, content: data.content }, textTrackId);
            return;
        }
        if (data?.kind === 'media') {
            const item = useMediaStore.getState().getItem(data.mediaId);
            if (item) addItemAt(item, time, track?.id, forceNewTrack);
            return;
        }
        // Files dragged straight from the desktop.
        const files = Array.from(e.dataTransfer.files || []);
        const projectKey = useProjectStore.getState().projectKey;
        if (files.length && projectKey) {
            const added = await useMediaStore.getState().addFiles(files, projectKey);
            let cursor = time;
            for (const item of added) {
                addItemAt(item, cursor, track?.id, forceNewTrack && cursor === time);
                cursor += item.type === 'image' ? TIMELINE.DEFAULT_IMAGE_DURATION : item.duration;
            }
        }
    };

    const dragOver = (e: React.DragEvent, id: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (dropTarget !== id) setDropTarget(id);
    };

    const selectedIds = new Set(selected.map((s) => s.elementId));
    const pickedCuts = useUiStore((s) => s.transitionCuts);
    const activeTab = useUiStore((s) => s.activeTab);

    /** Markers on the main track's cuts: click to pick that cut for a transition (Ctrl/Shift adds). */
    const cutMarkers = (track: TimelineTrack) => {
        if (!track.isMain) return null;
        const clips = (track.elements.filter((e) => e.type === 'media') as MediaElement[]).sort((a, b) => a.startTime - b.startTime);
        return clips.slice(1).map((clip, i) => {
            if (!canTransition(clips[i], clip)) return null;
            const tr = clip.transitionIn;
            const label = tr ? TRANSITIONS.find((t) => t.type === tr.type)?.label || 'Transition' : 'No transition';
            const on = activeTab === 'transitions' && pickedCuts.includes(clip.id);
            return (
                <button
                    key={`cut-${clip.id}`}
                    className={`ke-cutmark ${tr ? 'has-tr' : ''} ${on ? 'is-on' : ''}`}
                    style={{ left: clip.startTime * pps }}
                    title={`${label}. Click to choose this cut's transition (Ctrl-click to pick several).`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                        e.stopPropagation();
                        const ui = useUiStore.getState();
                        const add = e.ctrlKey || e.metaKey || e.shiftKey;
                        const current = ui.activeTab === 'transitions' ? ui.transitionCuts : [];
                        useTimelineStore.getState().clearSelection();
                        ui.setTransitionCuts(add ? (current.includes(clip.id) ? current.filter((x) => x !== clip.id) : [...current, clip.id]) : [clip.id]);
                        ui.setActiveTab('transitions');
                        usePlaybackStore.getState().seek(clip.startTime);
                    }}
                >
                    {tr ? '◆' : '+'}
                </button>
            );
        });
    };

    return (
        <div className="ke-panel ke-timeline">
            <TimelineToolbar />
            <div className="ke-timeline__scroll" ref={scrollRef}>
                <div className="ke-timeline__inner" style={{ width: LABEL_W + contentWidth }}>
                    <div className="ke-timeline__ruler-row" style={{ height: RULER_H }}>
                        <div className="ke-timeline__corner" style={{ width: LABEL_W }} />
                        <div className="ke-timeline__ruler" onPointerDown={startScrub}>
                            <TimelineRuler pixelsPerSecond={pps} visibleSeconds={visibleSeconds} />
                            {beatMarks.beats.length || beatMarks.markers.length ? (
                                <div className="ke-beats" aria-hidden>
                                    {(showAllBeats ? beatMarks.beats : beatMarks.downbeats).map((t) => (
                                        <i key={`b${t}`} className={`ke-beats__tick ${downSet.has(t) ? 'is-down' : ''}`} style={{ left: t * pps }} />
                                    ))}
                                    {beatMarks.markers.map((t) => (
                                        <i key={`m${t}`} className="ke-beats__marker" style={{ left: t * pps }} title="Beat marker" />
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    {tracks.map((track) => {
                        const Icon = TRACK_ICONS[track.type];
                        return (
                            <div
                                key={track.id}
                                className={`ke-track is-${track.type} ${track.isMain ? 'is-main' : ''}`}
                                style={{ height: TRACK_HEIGHTS[track.type] }}
                                data-track-id={track.id}
                            >
                                <div className="ke-track__label" style={{ width: LABEL_W }}>
                                    <Icon size={13} />
                                    <span>{track.name}</span>
                                    <div className="ke-track__actions">
                                        {track.type !== 'text' ? (
                                            <button
                                                className="ke-icon-btn ke-icon-btn--xs"
                                                title={track.muted ? 'Unmute track' : 'Mute track'}
                                                onClick={() => useTimelineStore.getState().toggleTrackMute(track.id)}
                                            >
                                                {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                                            </button>
                                        ) : null}
                                        {!track.isMain ? (
                                            <button
                                                className="ke-icon-btn ke-icon-btn--xs"
                                                title="Delete track"
                                                onClick={() => useTimelineStore.getState().removeTrack(track.id)}
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                                <div
                                    className={`ke-track__lane ${dropTarget === track.id ? 'is-drop' : ''}`}
                                    style={{ width: contentWidth }}
                                    onPointerDown={(e) => {
                                        useTimelineStore.getState().clearSelection();
                                        startScrub(e);
                                    }}
                                    onDragOver={(e) => dragOver(e, track.id)}
                                    onDragLeave={() => setDropTarget(null)}
                                    onDrop={(e) => handleDrop(e, track)}
                                >
                                    {track.isMain && track.elements.length === 0 ? (
                                        <div className="ke-track__hint">Drag media here to start your edit</div>
                                    ) : null}
                                    {cutMarkers(track)}
                                    {track.elements.map((el) => (
                                        <TimelineElement
                                            key={el.id}
                                            element={el}
                                            track={track}
                                            pixelsPerSecond={pps}
                                            isSelected={selectedIds.has(el.id)}
                                            onSnapLine={setSnapLine}
                                        />
                                    ))}
                                </div>
                            </div>
                        );
                    })}

                    <div
                        className={`ke-timeline__newtrack ${dropTarget === 'new' ? 'is-drop' : ''}`}
                        style={{ marginLeft: LABEL_W, width: contentWidth }}
                        onDragOver={(e) => dragOver(e, 'new')}
                        onDragLeave={() => setDropTarget(null)}
                        onDrop={(e) => handleDrop(e)}
                        onPointerDown={() => useTimelineStore.getState().clearSelection()}
                    >
                        Drop here to add on a new track
                    </div>

                    <div className="ke-playhead" style={{ left: LABEL_W + currentTime * pps }}>
                        <div className="ke-playhead__head" onPointerDown={startScrub} />
                    </div>
                    {snapLine !== null ? <div className="ke-snapline" style={{ left: LABEL_W + snapLine * pps }} /> : null}
                </div>
            </div>
        </div>
    );
}
