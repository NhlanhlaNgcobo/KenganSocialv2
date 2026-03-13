import { useState, useRef, useEffect, useCallback } from 'react';
import {
    Scissors, Trash2, ZoomIn, ZoomOut, Eye, Lock,
    Volume2, VolumeX, Copy, ChevronLeft, ChevronRight, Zap
} from 'lucide-react';

export default function EditorTimeline({
    clips,
    currentTime,
    duration,
    zoom,
    onZoomChange,
    onSeek,
    onSelectClip,
    activeClipId,
    pyBase,
    onSplit,
    onDelete,
    onDuplicate,
    onMoveClip,
    onTrimUpdate,
    onToggleMute,
    onAutoCut,
}) {
    const rulerRef = useRef(null);
    const timelineRef = useRef(null);
    const [dragging, setDragging] = useState(false);
    const [trimming, setTrimming] = useState(null); // { clipId, side: 'left'|'right', startX, initialTrimStart, initialTrimEnd }

    // Pixels per second
    const pxPerSec = 80 * zoom;

    // Total timeline width
    const totalWidth = Math.max(duration * pxPerSec, 800);

    // ── Ruler seek ──
    const handleRulerMouse = useCallback((e) => {
        const rect = rulerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const scrollLeft = timelineRef.current?.scrollLeft || 0;
        const x = e.clientX - rect.left + scrollLeft;
        const time = Math.max(0, Math.min(x / pxPerSec, duration));
        onSeek(time);
    }, [pxPerSec, duration, onSeek]);

    const onMouseDown = (e) => {
        if (e.target.closest('.cc-trim-handle')) return; // Don't seek when trimming
        setDragging(true);
        handleRulerMouse(e);
    };

    useEffect(() => {
        const onMove = (e) => {
            if (dragging) handleRulerMouse(e);
        };
        const onUp = () => setDragging(false);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [dragging, handleRulerMouse]);

    // ── Trim handle dragging ──
    const handleTrimStart = (e, clipId, side) => {
        e.stopPropagation();
        e.preventDefault();

        const clip = clips.find(c => c.id === clipId);
        if (!clip) return;

        setTrimming({
            clipId,
            side,
            startX: e.clientX,
            initialTrimStart: clip.trimStart || 0,
            initialTrimEnd: clip.trimEnd || clip.duration,
            clipDuration: clip.duration,
        });
    };

    useEffect(() => {
        if (!trimming) return;

        const handleTrimMove = (e) => {
            const deltaX = e.clientX - trimming.startX;
            const deltaSec = deltaX / pxPerSec;

            if (trimming.side === 'left') {
                const newTrimStart = Math.max(0, Math.min(
                    trimming.initialTrimStart + deltaSec,
                    trimming.initialTrimEnd - 0.5 // Minimum 0.5s clip
                ));
                onTrimUpdate(trimming.clipId, newTrimStart, trimming.initialTrimEnd);
            } else {
                const newTrimEnd = Math.max(
                    (trimming.initialTrimStart || 0) + 0.5, // Minimum 0.5s clip
                    Math.min(trimming.initialTrimEnd + deltaSec, trimming.clipDuration)
                );
                onTrimUpdate(trimming.clipId, trimming.initialTrimStart, newTrimEnd);
            }
        };

        const handleTrimEnd = () => {
            setTrimming(null);
        };

        window.addEventListener('mousemove', handleTrimMove);
        window.addEventListener('mouseup', handleTrimEnd);
        return () => {
            window.removeEventListener('mousemove', handleTrimMove);
            window.removeEventListener('mouseup', handleTrimEnd);
        };
    }, [trimming, pxPerSec, onTrimUpdate]);

    // Generate ruler marks
    const rulerMarks = [];
    const interval = zoom > 2 ? 1 : zoom > 1 ? 2 : 5;
    for (let t = 0; t <= duration; t += interval) {
        rulerMarks.push(t);
    }

    // Auto-scroll to keep playhead visible
    useEffect(() => {
        const container = timelineRef.current;
        if (!container) return;

        const playheadPx = currentTime * pxPerSec;
        const containerWidth = container.clientWidth;
        const scrollLeft = container.scrollLeft;

        if (playheadPx < scrollLeft || playheadPx > scrollLeft + containerWidth - 50) {
            container.scrollLeft = playheadPx - containerWidth / 2;
        }
    }, [currentTime, pxPerSec]);

    return (
        <div className="cc-timeline">
            {/* Toolbar */}
            <div className="cc-timeline-toolbar">
                <div className="cc-tl-tools-left">
                    <button
                        id="btn-tl-split"
                        className="cc-tl-btn"
                        title="Split at playhead (Ctrl+B)"
                        onClick={onSplit}
                        disabled={!activeClipId}
                    >
                        <Scissors size={14} />
                    </button>
                    <button
                        id="btn-tl-delete"
                        className="cc-tl-btn"
                        title="Delete / Cut clip (Del)"
                        onClick={() => activeClipId && onDelete(activeClipId)}
                        disabled={!activeClipId}
                    >
                        <Trash2 size={14} />
                    </button>
                    <button
                        className="cc-tl-btn"
                        title="Mute / Unmute Clip"
                        onClick={() => activeClipId && onToggleMute && onToggleMute(activeClipId)}
                        disabled={!activeClipId}
                    >
                        <VolumeX size={14} />
                    </button>
                    <button
                        className="cc-tl-btn"
                        title="Auto Cut (Detect and Remove Silences)"
                        onClick={() => activeClipId && onAutoCut && onAutoCut(activeClipId)}
                        disabled={!activeClipId}
                    >
                        <Zap size={14} />
                    </button>
                    <button
                        className="cc-tl-btn"
                        title="Duplicate clip"
                        onClick={() => activeClipId && onDuplicate(activeClipId)}
                        disabled={!activeClipId}
                    >
                        <Copy size={14} />
                    </button>
                    <div className="cc-tl-divider" />
                    <button
                        className="cc-tl-btn"
                        title="Move clip left"
                        onClick={() => activeClipId && onMoveClip(activeClipId, -1)}
                        disabled={!activeClipId}
                    >
                        <ChevronLeft size={14} />
                    </button>
                    <button
                        className="cc-tl-btn"
                        title="Move clip right"
                        onClick={() => activeClipId && onMoveClip(activeClipId, 1)}
                        disabled={!activeClipId}
                    >
                        <ChevronRight size={14} />
                    </button>
                </div>
                <div className="cc-tl-tools-right">
                    <span className="cc-tl-clip-count">{clips.length} clip{clips.length !== 1 ? 's' : ''}</span>
                    <div className="cc-tl-divider" />
                    <button
                        className="cc-tl-btn"
                        onClick={() => onZoomChange(Math.max(0.25, zoom - 0.25))}
                        title="Zoom out"
                    >
                        <ZoomOut size={14} />
                    </button>
                    <span className="cc-tl-zoom-label">{Math.round(zoom * 100)}%</span>
                    <button
                        className="cc-tl-btn"
                        onClick={() => onZoomChange(Math.min(5, zoom + 0.25))}
                        title="Zoom in"
                    >
                        <ZoomIn size={14} />
                    </button>
                </div>
            </div>

            {/* Timeline area */}
            <div className="cc-timeline-scroll" ref={timelineRef}>
                {/* Ruler */}
                <div
                    className="cc-timeline-ruler"
                    ref={rulerRef}
                    style={{ width: totalWidth }}
                    onMouseDown={onMouseDown}
                >
                    {rulerMarks.map(t => (
                        <div
                            key={t}
                            className="cc-ruler-mark"
                            style={{ left: t * pxPerSec }}
                        >
                            <span>{formatTime(t)}</span>
                        </div>
                    ))}

                    {/* Playhead */}
                    <div
                        className="cc-playhead"
                        style={{ left: currentTime * pxPerSec }}
                    >
                        <div className="cc-playhead-head" />
                        <div className="cc-playhead-line" />
                    </div>
                </div>

                {/* Tracks */}
                <div className="cc-timeline-tracks" style={{ width: totalWidth }}>
                    {/* Video track */}
                    <div className="cc-track">
                        <div className="cc-track-header">
                            <Eye size={12} />
                            <Lock size={12} />
                            <Volume2 size={12} />
                        </div>
                        <div className="cc-track-content">
                            {clips.length === 0 && (
                                <div className="cc-track-empty">
                                    <span>Drag media here or click Import</span>
                                </div>
                            )}

                            {clips.map((clip) => {
                                const startPx = (clip.startOnTimeline || 0) * pxPerSec;
                                const durSec = (clip.trimEnd || clip.duration || 0) - (clip.trimStart || 0);
                                const widthPx = Math.max(durSec * pxPerSec, 40);

                                return (
                                    <div
                                        key={clip.id}
                                        className={`cc-clip ${activeClipId === clip.id ? 'active' : ''}`}
                                        style={{ left: startPx, width: widthPx }}
                                        onClick={() => onSelectClip(clip.id)}
                                    >
                                        {/* Thumbnail strip */}
                                        <div className="cc-clip-thumbs">
                                            {clip.thumbnails?.map((thumb, i) => (
                                                <img
                                                    key={i}
                                                    src={clip._isLocal
                                                        ? thumb
                                                        : `${clip._pyBase || pyBase}${thumb}`
                                                    }
                                                    alt=""
                                                    className="cc-clip-thumb-img"
                                                    loading="lazy"
                                                />
                                            ))}
                                        </div>

                                        {/* Clip label */}
                                        <div className="cc-clip-label">
                                            {clip.filename} {formatTime(durSec)}
                                        </div>

                                        {/* Filter indicator */}
                                        {clip.filter && clip.filter !== 'none' && (
                                            <div className="cc-clip-badge cc-clip-filter-badge">
                                                {clip.filter}
                                            </div>
                                        )}

                                        {/* Speed indicator */}
                                        {clip.speed && clip.speed !== 1 && (
                                            <div className="cc-clip-badge cc-clip-speed-badge">
                                                {clip.speed}x
                                            </div>
                                        )}

                                        {/* Trim handles */}
                                        <div
                                            className="cc-trim-handle cc-trim-left"
                                            onMouseDown={(e) => handleTrimStart(e, clip.id, 'left')}
                                        />
                                        <div
                                            className="cc-trim-handle cc-trim-right"
                                            onMouseDown={(e) => handleTrimStart(e, clip.id, 'right')}
                                        />
                                    </div>
                                );
                            })}

                            {/* Playhead line on track */}
                            <div
                                className="cc-playhead-track-line"
                                style={{ left: currentTime * pxPerSec }}
                            />
                        </div>
                    </div>

                    {/* Audio track */}
                    <div className="cc-track cc-track-audio">
                        <div className="cc-track-header">
                            <Volume2 size={12} />
                        </div>
                        <div className="cc-track-content">
                            {clips.map((clip) => {
                                if (!clip.hasAudio) return null;
                                const startPx = (clip.startOnTimeline || 0) * pxPerSec;
                                const durSec = (clip.trimEnd || clip.duration || 0) - (clip.trimStart || 0);
                                const widthPx = Math.max(durSec * pxPerSec, 40);

                                return (
                                    <div
                                        key={`audio-${clip.id}`}
                                        className={`cc-clip cc-clip-audio ${activeClipId === clip.id ? 'active' : ''}`}
                                        style={{ left: startPx, width: widthPx }}
                                        onClick={() => onSelectClip(clip.id)}
                                    >
                                        <div className="cc-clip-label">
                                            🔊 Audio {clip.volume !== 1 ? `${Math.round(clip.volume * 100)}%` : ''}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
