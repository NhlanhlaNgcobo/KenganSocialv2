import { useRef, useEffect, useState, useCallback } from 'react';
import { Play, Pause, Maximize, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';

export default function EditorCanvas({
    videoSrc,
    isPlaying,
    onTogglePlay,
    currentTime,
    duration,
    onTimeUpdate,
    activeClip,
}) {
    const videoRef = useRef(null);
    const [ratio, setRatio] = useState('fit');
    const [muted, setMuted] = useState(false);
    const [videoReady, setVideoReady] = useState(false);

    // Play / Pause syncing
    useEffect(() => {
        const v = videoRef.current;
        if (!v || !videoReady) return;
        if (isPlaying) {
            v.play().catch(() => { });
        } else {
            v.pause();
        }
    }, [isPlaying, videoReady]);

    // Seek when currentTime changes from external (timeline ruler click)
    useEffect(() => {
        const v = videoRef.current;
        if (!v || !videoReady) return;

        // Only seek when NOT playing (avoid jitter during playback)
        if (!isPlaying) {
            // Calculate the seek time relative to the active clip's trim start
            let seekTime = currentTime;
            if (activeClip) {
                const clipStart = activeClip.startOnTimeline || 0;
                const trimStart = activeClip.trimStart || 0;
                seekTime = trimStart + (currentTime - clipStart);
                seekTime = Math.max(trimStart, Math.min(seekTime, activeClip.trimEnd || activeClip.duration || 0));
            }

            if (Math.abs(v.currentTime - seekTime) > 0.1) {
                v.currentTime = seekTime;
            }
        }
    }, [currentTime, isPlaying, videoReady, activeClip]);

    // Handle src change
    useEffect(() => {
        setVideoReady(false);
    }, [videoSrc]);

    const handleLoadedMetadata = () => {
        setVideoReady(true);
    };

    const handleTimeUpdate = () => {
        const v = videoRef.current;
        if (v && onTimeUpdate && isPlaying) {
            // Map video time back to timeline time
            if (activeClip) {
                const trimStart = activeClip.trimStart || 0;
                const clipStart = activeClip.startOnTimeline || 0;
                const timelineTime = clipStart + (v.currentTime - trimStart);
                onTimeUpdate(timelineTime);
            } else {
                onTimeUpdate(v.currentTime);
            }
        }
    };

    const handleEnded = () => {
        // Could auto-advance to next clip here
    };

    // Skip forward / backward
    const skip = (seconds) => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = Math.max(0, Math.min(v.currentTime + seconds, v.duration || 0));
        if (onTimeUpdate) {
            if (activeClip) {
                const trimStart = activeClip.trimStart || 0;
                const clipStart = activeClip.startOnTimeline || 0;
                onTimeUpdate(clipStart + (v.currentTime - trimStart));
            } else {
                onTimeUpdate(v.currentTime);
            }
        }
    };

    // Mute toggle
    useEffect(() => {
        const v = videoRef.current;
        if (v) v.muted = muted;
    }, [muted]);

    // Apply CSS filters for visual preview (non-destructive)
    const getVideoStyle = () => {
        if (!activeClip) return {};
        const filter = activeClip.filter;
        const transform = activeClip.transform || {};

        const cssFilters = {
            vivid: 'saturate(1.5) contrast(1.1) brightness(1.05)',
            fade: 'saturate(0.6) brightness(1.1) contrast(0.9)',
            noir: 'grayscale(1) contrast(1.3) brightness(0.95)',
            warm: 'sepia(0.3) saturate(1.2)',
            cool: 'hue-rotate(20deg) saturate(1.1)',
            drama: 'contrast(1.4) brightness(0.92) saturate(1.2)',
            neon: 'saturate(2.0) contrast(1.3) brightness(1.1)',
            retro: 'sepia(0.4) saturate(0.8) contrast(1.1)',
            cinema: 'contrast(1.2) saturate(1.1)',
        };

        const style = {};
        if (filter && filter !== 'none' && cssFilters[filter]) {
            style.filter = cssFilters[filter];
        }

        const transforms = [];
        if (transform.scale && transform.scale !== 100) {
            transforms.push(`scale(${transform.scale / 100})`);
        }
        if (transform.rotate && transform.rotate !== 0) {
            transforms.push(`rotate(${transform.rotate}deg)`);
        }
        if (transform.x || transform.y) {
            transforms.push(`translate(${transform.x || 0}px, ${transform.y || 0}px)`);
        }
        if (transforms.length > 0) {
            style.transform = transforms.join(' ');
        }

        return style;
    };

    return (
        <div className="cc-canvas">
            {/* Player label */}
            <div className="cc-canvas-header">
                <span>Player</span>
                {activeClip && <span className="cc-canvas-clip-name">{activeClip.filename}</span>}
            </div>

            {/* Video area */}
            <div className="cc-canvas-viewport">
                {videoSrc ? (
                    <video
                        ref={videoRef}
                        src={videoSrc}
                        className={`cc-canvas-video ${ratio}`}
                        style={getVideoStyle()}
                        onTimeUpdate={handleTimeUpdate}
                        onLoadedMetadata={handleLoadedMetadata}
                        onEnded={handleEnded}
                        onClick={onTogglePlay}
                        playsInline
                    />
                ) : (
                    <div className="cc-canvas-placeholder">
                        <Play size={48} />
                        <p>Import media and add to timeline</p>
                        <span className="cc-canvas-hint">Drag & drop video files or click Import</span>
                    </div>
                )}
            </div>

            {/* Playback controls */}
            <div className="cc-canvas-controls">
                <span className="cc-timecode">{formatTimecode(currentTime)}</span>
                <span className="cc-timecode-separator">/</span>
                <span className="cc-timecode">{formatTimecode(duration)}</span>
                <div className="cc-canvas-controls-center">
                    <button className="cc-canvas-icon-btn" onClick={() => skip(-5)} title="Back 5s">
                        <SkipBack size={16} />
                    </button>
                    <button className="cc-play-btn" onClick={onTogglePlay}>
                        {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                    </button>
                    <button className="cc-canvas-icon-btn" onClick={() => skip(5)} title="Forward 5s">
                        <SkipForward size={16} />
                    </button>
                </div>
                <div className="cc-canvas-controls-right">
                    <button
                        className="cc-canvas-icon-btn"
                        onClick={() => setMuted(m => !m)}
                        title={muted ? 'Unmute' : 'Mute'}
                    >
                        {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    </button>
                    <button
                        className="cc-canvas-icon-btn"
                        onClick={() => setRatio(r => r === 'fit' ? 'fill' : 'fit')}
                        title="Toggle fit/fill"
                    >
                        <Maximize size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}

function formatTimecode(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00:00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * 30);
    return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

function pad(n) { return n.toString().padStart(2, '0'); }
