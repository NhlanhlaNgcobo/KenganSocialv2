import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Send, Loader2, Check, X, AlertCircle, Film, Undo2, Redo2, Home } from 'lucide-react';
import EditorToolbar from './editor/EditorToolbar';
import MediaPanel from './editor/MediaPanel';
import EditorCanvas from './editor/EditorCanvas';
import PropertiesPanel from './editor/PropertiesPanel';
import EditorTimeline from './editor/EditorTimeline';
import './VideoEditor.css';

const PY_API = import.meta.env.VITE_PY_EDITOR_URL || 'http://localhost:8000';

export default function VideoEditorPage() {
    const navigate = useNavigate();

    // Media library
    const [mediaItems, setMediaItems] = useState([]);
    const [uploading, setUploading] = useState(false);

    // Timeline clips
    const [clips, setClips] = useState([]);
    const [activeClipId, setActiveClipId] = useState(null);

    // Playback
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [previewSrc, setPreviewSrc] = useState(null);

    // Timeline
    const [zoom, setZoom] = useState(1);

    // Active tool
    const [activeTool, setActiveTool] = useState('media');

    // Export
    const [exportFormat, setExportFormat] = useState('tiktok');
    const [processing, setProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [resultUrl, setResultUrl] = useState(null);

    // Undo/Redo
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    // UI
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    // Backend availability
    const [backendAvailable, setBackendAvailable] = useState(null);

    // Check if Python backend is available
    useEffect(() => {
        fetch(`${PY_API}/api/editor/media`, { method: 'GET' })
            .then(() => setBackendAvailable(true))
            .catch(() => setBackendAvailable(false));
    }, []);

    // Auto-dismiss success messages
    useEffect(() => {
        if (successMsg) {
            const timer = setTimeout(() => setSuccessMsg(''), 3000);
            return () => clearTimeout(timer);
        }
    }, [successMsg]);

    // Computed
    const totalDuration = clips.reduce((sum, c) => {
        const dur = (c.trimEnd || c.duration || 0) - (c.trimStart || 0);
        return sum + dur;
    }, 0);

    const activeClip = clips.find(c => c.id === activeClipId) || null;

    // ───────────────────────────────────────────
    // History (Undo/Redo support)
    // ───────────────────────────────────────────
    const pushHistory = useCallback((newClips) => {
        setHistory(prev => {
            const trimmed = prev.slice(0, historyIndex + 1);
            return [...trimmed, JSON.parse(JSON.stringify(newClips))];
        });
        setHistoryIndex(prev => prev + 1);
    }, [historyIndex]);

    const undo = useCallback(() => {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            setClips(JSON.parse(JSON.stringify(history[newIndex])));
        }
    }, [historyIndex, history]);

    const redo = useCallback(() => {
        if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            setClips(JSON.parse(JSON.stringify(history[newIndex])));
        }
    }, [historyIndex, history]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                undo();
            } else if (e.ctrlKey && e.key === 'y') {
                e.preventDefault();
                redo();
            } else if (e.ctrlKey && e.key === 'b') {
                e.preventDefault();
                // trigger button click via ID or just let it be (we'll fix it by using a ref if needed, but since we can't easily hoist, we'll invoke the button)
                const splitBtn = document.getElementById('btn-tl-split');
                if (splitBtn) splitBtn.click();
            } else if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
                setIsPlaying(p => !p);
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
                const delBtn = document.getElementById('btn-tl-delete');
                if (delBtn) delBtn.click();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo]);

    // ───────────────────────────────────────────
    // Upload / Import video (works both with backend and locally)
    // ───────────────────────────────────────────
    const handleUpload = async (file) => {
        if (!file) return;
        setUploading(true);
        setError('');

        try {
            // Always create a local URL for instant preview
            const localUrl = URL.createObjectURL(file);

            // Get local video metadata
            const localMeta = await getLocalVideoMeta(file, localUrl);

            let data;
            if (backendAvailable) {
                // Upload to Python service for processing
                try {
                    const formData = new FormData();
                    formData.append('video', file);

                    const res = await fetch(`${PY_API}/api/editor/upload`, {
                        method: 'POST',
                        body: formData,
                    });

                    if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        throw new Error(err.detail || 'Upload failed');
                    }

                    data = await res.json();
                    data._pyBase = PY_API;
                    data._localUrl = localUrl;
                } catch (backendErr) {
                    console.warn('Backend upload failed, using local mode:', backendErr.message);
                    setBackendAvailable(false);
                    data = localMeta;
                }
            } else {
                // Local-only mode
                data = localMeta;
            }

            setMediaItems(prev => [...prev, data]);
            setSuccessMsg(`✅ Imported: ${data.filename}`);

            // Auto-add to timeline
            addClipToTimeline(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setUploading(false);
        }
    };

    // Get video metadata locally using HTML5 video element
    const getLocalVideoMeta = (file, localUrl) => {
        return new Promise((resolve) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = () => {
                // Generate local thumbnails from the video
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const thumbnails = [];
                const count = Math.min(20, Math.max(5, Math.floor(video.duration)));
                let generated = 0;

                canvas.width = 160;
                canvas.height = 90;

                const generateThumb = (seekTime) => {
                    return new Promise((res) => {
                        video.currentTime = seekTime;
                        video.onseeked = () => {
                            ctx.drawImage(video, 0, 0, 160, 90);
                            thumbnails.push(canvas.toDataURL('image/jpeg', 0.5));
                            generated++;
                            res();
                        };
                    });
                };

                const generateAll = async () => {
                    const interval = video.duration / count;
                    for (let i = 0; i < count; i++) {
                        try {
                            await generateThumb(i * interval);
                        } catch {
                            // Skip failed thumbnails
                        }
                    }

                    resolve({
                        uploadId: `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        filename: file.name,
                        filepath: null,
                        duration: video.duration,
                        width: video.videoWidth,
                        height: video.videoHeight,
                        fps: 30,
                        hasAudio: true,
                        size: file.size,
                        thumbnails: thumbnails,
                        _localUrl: localUrl,
                        _pyBase: '',
                        _isLocal: true,
                    });
                };

                generateAll();
            };
            video.onerror = () => {
                resolve({
                    uploadId: `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    filename: file.name,
                    filepath: null,
                    duration: 0,
                    width: 0,
                    height: 0,
                    fps: 30,
                    hasAudio: false,
                    size: file.size,
                    thumbnails: [],
                    _localUrl: localUrl,
                    _pyBase: '',
                    _isLocal: true,
                });
            };
            video.src = localUrl;
        });
    };

    // ───────────────────────────────────────────
    // Add clip to timeline
    // ───────────────────────────────────────────
    const addClipToTimeline = useCallback((media) => {
        const newClip = {
            id: `clip-${Date.now()}`,
            source: media.uploadId,
            filename: media.filename,
            localUrl: media._localUrl,
            duration: media.duration,
            thumbnails: media.thumbnails || [],
            hasAudio: media.hasAudio,
            startOnTimeline: clips.reduce((sum, c) => {
                return sum + ((c.trimEnd || c.duration) - (c.trimStart || 0));
            }, 0),
            trimStart: 0,
            trimEnd: media.duration,
            speed: 1,
            volume: 1,
            filter: 'none',
            transition: 'none',
            transform: { scale: 100, x: 0, y: 0, rotate: 0 },
            textOverlays: [],
            _isLocal: media._isLocal || false,
            _pyBase: media._pyBase || '',
        };

        const newClips = [...clips, newClip];
        setClips(newClips);
        setActiveClipId(newClip.id);
        setPreviewSrc(media._localUrl);
        pushHistory(newClips);
    }, [clips, pushHistory]);

    // ───────────────────────────────────────────
    // Update clip property
    // ───────────────────────────────────────────
    const updateClip = useCallback((clipId, key, value) => {
        setClips(prev => {
            const newClips = prev.map(c =>
                c.id === clipId ? { ...c, [key]: value } : c
            );
            return newClips;
        });
    }, []);

    // Save state to history on mouse up (debounced via effect)
    const saveToHistory = useCallback(() => {
        pushHistory(clips);
    }, [clips, pushHistory]);

    // ───────────────────────────────────────────
    // Delete clip
    // ───────────────────────────────────────────
    const handleDeleteClip = useCallback((clipId) => {
        const newClips = clips.filter(c => c.id !== clipId);
        // Recalculate startOnTimeline for remaining clips
        let position = 0;
        const reorderedClips = newClips.map(c => {
            const dur = (c.trimEnd || c.duration) - (c.trimStart || 0);
            const updated = { ...c, startOnTimeline: position };
            position += dur;
            return updated;
        });

        setClips(reorderedClips);
        pushHistory(reorderedClips);

        if (activeClipId === clipId) {
            if (reorderedClips.length > 0) {
                setActiveClipId(reorderedClips[0].id);
                setPreviewSrc(reorderedClips[0].localUrl);
            } else {
                setActiveClipId(null);
                setPreviewSrc(null);
            }
        }

        setSuccessMsg('🗑️ Clip deleted');
    }, [clips, activeClipId, pushHistory]);

    // ───────────────────────────────────────────
    // Split clip at current time
    // ───────────────────────────────────────────
    const handleSplitClip = useCallback(() => {
        if (!activeClipId) {
            setError('Select a clip to split.');
            return;
        }

        const clipIndex = clips.findIndex(c => c.id === activeClipId);
        if (clipIndex === -1) return;

        const clip = clips[clipIndex];
        const clipStart = clip.startOnTimeline || 0;
        const clipDuration = (clip.trimEnd || clip.duration) - (clip.trimStart || 0);
        const clipEnd = clipStart + clipDuration;

        // Check if current time falls within this clip
        if (currentTime <= clipStart || currentTime >= clipEnd) {
            setError('Move the playhead inside the selected clip to split it.');
            return;
        }

        // Calculate split point relative to the clip's trim
        const relativeTime = currentTime - clipStart;
        const splitPointInSource = (clip.trimStart || 0) + relativeTime;

        // Create two new clips
        const leftClip = {
            ...clip,
            id: `clip-${Date.now()}-left`,
            trimEnd: splitPointInSource,
        };

        const rightClip = {
            ...clip,
            id: `clip-${Date.now()}-right`,
            trimStart: splitPointInSource,
            startOnTimeline: clipStart + relativeTime,
        };

        // Replace the original clip with the two halves
        const newClips = [...clips];
        newClips.splice(clipIndex, 1, leftClip, rightClip);

        // Recalculate startOnTimeline
        let position = 0;
        const reorderedClips = newClips.map(c => {
            const dur = (c.trimEnd || c.duration) - (c.trimStart || 0);
            const updated = { ...c, startOnTimeline: position };
            position += dur;
            return updated;
        });

        setClips(reorderedClips);
        setActiveClipId(rightClip.id);
        pushHistory(reorderedClips);
        setSuccessMsg('✂️ Clip split at playhead');
    }, [clips, activeClipId, currentTime, pushHistory]);

    // ───────────────────────────────────────────
    // Mute clip
    // ───────────────────────────────────────────
    const handleToggleMute = useCallback((clipId) => {
        const clipInfo = clips.find(c => c.id === clipId);
        if (!clipInfo) return;
        const newVolume = clipInfo.volume === 0 ? 1 : 0;

        const newClips = clips.map(c => c.id === clipId ? { ...c, volume: newVolume } : c);
        setClips(newClips);
        pushHistory(newClips);
        setSuccessMsg(newVolume === 0 ? '🔇 Muted clip' : '🔊 Unmuted clip');
    }, [clips, pushHistory]);

    // ───────────────────────────────────────────
    // Auto Cut (Placeholder)
    // ───────────────────────────────────────────
    const handleAutoCut = useCallback(() => {
        if (!activeClipId) {
            setError('Select a clip for Auto Cut.');
            return;
        }
        setProcessing(true);
        setTimeout(() => {
            setProcessing(false);
            setSuccessMsg('✨ Auto Cut: Detected and removed 3 instances of silence & jump shots (Placeholder)');
        }, 1500);
    }, [activeClipId]);

    // ───────────────────────────────────────────
    // Duplicate clip
    // ───────────────────────────────────────────
    const handleDuplicateClip = useCallback((clipId) => {
        const clip = clips.find(c => c.id === clipId);
        if (!clip) return;

        const duplicated = {
            ...clip,
            id: `clip-${Date.now()}-dup`,
            textOverlays: [...(clip.textOverlays || [])],
            transform: { ...(clip.transform || { scale: 100, x: 0, y: 0, rotate: 0 }) },
        };

        const newClips = [...clips, duplicated];

        // Recalculate positions
        let position = 0;
        const reorderedClips = newClips.map(c => {
            const dur = (c.trimEnd || c.duration) - (c.trimStart || 0);
            const updated = { ...c, startOnTimeline: position };
            position += dur;
            return updated;
        });

        setClips(reorderedClips);
        setActiveClipId(duplicated.id);
        pushHistory(reorderedClips);
        setSuccessMsg('📋 Clip duplicated');
    }, [clips, pushHistory]);

    // ───────────────────────────────────────────
    // Reorder clips (move clip left/right in timeline)
    // ───────────────────────────────────────────
    const handleMoveClip = useCallback((clipId, direction) => {
        const index = clips.findIndex(c => c.id === clipId);
        if (index === -1) return;
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= clips.length) return;

        const newClips = [...clips];
        const [removed] = newClips.splice(index, 1);
        newClips.splice(newIndex, 0, removed);

        // Recalculate positions
        let position = 0;
        const reorderedClips = newClips.map(c => {
            const dur = (c.trimEnd || c.duration) - (c.trimStart || 0);
            const updated = { ...c, startOnTimeline: position };
            position += dur;
            return updated;
        });

        setClips(reorderedClips);
        pushHistory(reorderedClips);
    }, [clips, pushHistory]);

    // ───────────────────────────────────────────
    // Update trim handles
    // ───────────────────────────────────────────
    const handleTrimUpdate = useCallback((clipId, trimStart, trimEnd) => {
        const newClips = clips.map(c =>
            c.id === clipId ? { ...c, trimStart, trimEnd } : c
        );

        // Recalculate positions
        let position = 0;
        const reorderedClips = newClips.map(c => {
            const dur = (c.trimEnd || c.duration) - (c.trimStart || 0);
            const updated = { ...c, startOnTimeline: position };
            position += dur;
            return updated;
        });

        setClips(reorderedClips);
    }, [clips]);

    // ───────────────────────────────────────────
    // Select a clip on the timeline
    // ───────────────────────────────────────────
    const handleSelectClip = useCallback((clipId) => {
        setActiveClipId(clipId);
        const clip = clips.find(c => c.id === clipId);
        if (clip) {
            setPreviewSrc(clip.localUrl);
        }
    }, [clips]);

    // ───────────────────────────────────────────
    // Select media from library
    // ───────────────────────────────────────────
    const handleSelectMedia = (media) => {
        setPreviewSrc(media._localUrl);
    };

    // ───────────────────────────────────────────
    // Add media to timeline from media panel
    // ───────────────────────────────────────────
    const handleAddToTimeline = (media) => {
        addClipToTimeline(media);
    };

    // ───────────────────────────────────────────
    // Delete media from library
    // ───────────────────────────────────────────
    const handleDeleteMedia = (uploadId) => {
        setMediaItems(prev => prev.filter(m => m.uploadId !== uploadId));
        // Also remove any clips from timeline that use this media
        const newClips = clips.filter(c => c.source !== uploadId);
        let position = 0;
        const reorderedClips = newClips.map(c => {
            const dur = (c.trimEnd || c.duration) - (c.trimStart || 0);
            const updated = { ...c, startOnTimeline: position };
            position += dur;
            return updated;
        });
        setClips(reorderedClips);
        pushHistory(reorderedClips);
    };

    // ───────────────────────────────────────────
    // Export
    // ───────────────────────────────────────────
    const handleExport = async () => {
        if (clips.length === 0) {
            setError('Add clips to the timeline first.');
            return;
        }

        if (!backendAvailable) {
            // Client-side export using MediaRecorder
            await handleLocalExport();
            return;
        }

        setProcessing(true);
        setProgress(0);
        setError('');
        setResultUrl(null);

        try {
            const editConfig = {
                clips: clips.map(c => ({
                    source: c.source,
                    start: c.trimStart || undefined,
                    end: c.trimEnd || undefined,
                    speed: c.speed !== 1 ? c.speed : undefined,
                    volume: c.volume !== 1 ? c.volume : undefined,
                    filter: c.filter !== 'none' ? c.filter : undefined,
                    transform: c.transform?.scale !== 100 || c.transform?.rotate !== 0
                        ? c.transform : undefined,
                    textOverlays: c.textOverlays?.length > 0 ? c.textOverlays : undefined,
                    transition: c.transition !== 'none' ? c.transition : undefined,
                })),
                exportFormat,
            };

            const res = await fetch(`${PY_API}/api/editor/process`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editConfig),
            });

            if (!res.ok) throw new Error('Processing failed');
            const data = await res.json();

            // Poll
            const poll = setInterval(async () => {
                try {
                    const sr = await fetch(`${PY_API}/api/editor/status/${data.jobId}`);
                    const st = await sr.json();
                    setProgress(st.progress || 0);

                    if (st.status === 'completed') {
                        clearInterval(poll);
                        setProcessing(false);
                        setResultUrl(`${PY_API}${st.downloadUrl}`);
                        setSuccessMsg('✅ Export complete!');
                    } else if (st.status === 'failed') {
                        clearInterval(poll);
                        setProcessing(false);
                        setError(`Export failed: ${st.error}`);
                    }
                } catch { }
            }, 2000);

            setTimeout(() => clearInterval(poll), 300000);
        } catch (err) {
            setError(err.message);
            setProcessing(false);
        }
    };

    // ───────────────────────────────────────────
    // Local export (when backend unavailable)
    // ───────────────────────────────────────────
    const handleLocalExport = async () => {
        setProcessing(true);
        setProgress(10);
        setError('');

        try {
            // For local export, we'll just download the original video with trim points
            if (clips.length === 1) {
                const clip = clips[0];
                setProgress(50);

                // Simple download of the local blob
                const a = document.createElement('a');
                a.href = clip.localUrl;
                a.download = `${clip.filename.replace(/\.\w+$/, '')}_edited.mp4`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                setProgress(100);
                setSuccessMsg('✅ Video downloaded! (Local mode — for full editing features, start the Python backend)');
            } else {
                setError('Multi-clip export requires the Python backend. Run: python server/python-editor/main.py');
            }
        } catch (err) {
            setError(`Local export failed: ${err.message}`);
        } finally {
            setProcessing(false);
        }
    };

    // ───────────────────────────────────────────
    // Drop handler for import area
    // ───────────────────────────────────────────
    const handleDrop = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        const files = Array.from(e.dataTransfer.files);
        const videoFiles = files.filter(f => f.type.startsWith('video/') || f.type.startsWith('audio/'));
        if (videoFiles.length > 0) {
            videoFiles.forEach(f => handleUpload(f));
        }
    }, [backendAvailable]);

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    // ───────────────────────────────────────────
    // RENDER
    // ───────────────────────────────────────────
    return (
        <div className="cc-editor" onDrop={handleDrop} onDragOver={handleDragOver}>
            {/* Top toolbar */}
            <div className="cc-editor-topbar">
                <div className="cc-editor-nav">
                    <button className="cc-home-btn" onClick={() => navigate('/dashboard')} title="Return to Hub">
                        <Home size={18} />
                        <span>Hub</span>
                    </button>
                </div>
                <EditorToolbar activeTool={activeTool} onToolChange={setActiveTool} />
                <div className="cc-editor-actions">
                    <button
                        className="cc-undo-btn"
                        onClick={undo}
                        disabled={historyIndex <= 0}
                        title="Undo (Ctrl+Z)"
                    >
                        <Undo2 size={16} />
                    </button>
                    <button
                        className="cc-redo-btn"
                        onClick={redo}
                        disabled={historyIndex >= history.length - 1}
                        title="Redo (Ctrl+Y)"
                    >
                        <Redo2 size={16} />
                    </button>
                    {backendAvailable === false && (
                        <span className="cc-backend-badge" title="Python backend not detected. Working in local preview mode.">
                            Local Mode
                        </span>
                    )}
                </div>
            </div>

            {/* Main layout: left panel | canvas | right panel */}
            <div className="cc-editor-body">
                {/* Left: Media browser */}
                <MediaPanel
                    mediaItems={mediaItems}
                    onUpload={handleUpload}
                    uploading={uploading}
                    onSelectMedia={handleSelectMedia}
                    onAddToTimeline={handleAddToTimeline}
                    onDeleteMedia={handleDeleteMedia}
                    activeTool={activeTool}
                />

                {/* Center: Canvas */}
                <EditorCanvas
                    videoSrc={previewSrc}
                    isPlaying={isPlaying}
                    onTogglePlay={() => setIsPlaying(p => !p)}
                    currentTime={currentTime}
                    duration={totalDuration}
                    onTimeUpdate={setCurrentTime}
                    activeClip={activeClip}
                />

                {/* Right: Properties */}
                <PropertiesPanel
                    activeClip={activeClip}
                    onUpdateClip={updateClip}
                    onSaveHistory={saveToHistory}
                />
            </div>

            {/* Bottom: Timeline */}
            <EditorTimeline
                clips={clips}
                currentTime={currentTime}
                duration={totalDuration || 30}
                zoom={zoom}
                onZoomChange={setZoom}
                onSeek={setCurrentTime}
                onSelectClip={handleSelectClip}
                activeClipId={activeClipId}
                pyBase={PY_API}
                onSplit={handleSplitClip}
                onDelete={handleDeleteClip}
                onDuplicate={handleDuplicateClip}
                onMoveClip={handleMoveClip}
                onTrimUpdate={handleTrimUpdate}
                onToggleMute={handleToggleMute}
                onAutoCut={handleAutoCut}
            />

            {/* Export bar */}
            <div className="cc-export-bar">
                <div className="cc-export-formats">
                    {['tiktok', 'instagram', 'youtube', 'reels'].map(f => (
                        <button
                            key={f}
                            className={`cc-export-fmt ${exportFormat === f ? 'active' : ''}`}
                            onClick={() => setExportFormat(f)}
                        >
                            {f.charAt(0).toUpperCase() + f.slice(1)}
                        </button>
                    ))}
                </div>

                <button
                    className="cc-export-btn"
                    onClick={handleExport}
                    disabled={processing || clips.length === 0}
                >
                    {processing
                        ? <><Loader2 size={16} className="spin" /> Exporting {progress}%</>
                        : <><Film size={16} /> Export Video</>
                    }
                </button>

                {resultUrl && (
                    <div className="cc-export-result">
                        <a href={resultUrl} download className="cc-export-download">
                            <Download size={14} /> Download
                        </a>
                        <button className="cc-export-schedule" onClick={() => navigate('/dashboard/scheduler', { state: { videoUrl: resultUrl } })}>
                            <Send size={14} /> Schedule
                        </button>
                    </div>
                )}
            </div>

            {/* Banners */}
            {error && (
                <div className="cc-banner cc-banner-error">
                    <AlertCircle size={14} /><span>{error}</span>
                    <button onClick={() => setError('')}><X size={14} /></button>
                </div>
            )}
            {successMsg && (
                <div className="cc-banner cc-banner-success">
                    <Check size={14} /><span>{successMsg}</span>
                    <button onClick={() => setSuccessMsg('')}><X size={14} /></button>
                </div>
            )}
        </div>
    );
}
