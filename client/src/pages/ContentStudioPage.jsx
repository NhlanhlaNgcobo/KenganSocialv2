import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    Upload, Video, Type, Sparkles, Save, Send, Calendar, X,
    Smartphone, Instagram, Facebook, Linkedin, Twitter, Youtube,
    Loader2, Check, AlertCircle, FileText, Download, Play, Pause,
    Palette, Monitor, Scissors, Zap, Eye, Layers, Music, Volume2, Target, ArrowRight
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { apiClient } from '../lib/api';
import { useEditorStore } from '../stores/editorStore';
import './ContentStudio.css';

const PLATFORMS = [
    { id: 'instagram', icon: Instagram, color: '#E4405F' },
    { id: 'tiktok', icon: Smartphone, color: '#000000' },
    { id: 'facebook', icon: Facebook, color: '#1877F2' },
    { id: 'linkedin', icon: Linkedin, color: '#0A66C2' },
    { id: 'youtube', icon: Youtube, color: '#FF0000' },
    { id: 'twitter', icon: Twitter, color: '#000000' },
];

const CAPTION_STYLES = [
    { id: 'tiktok', name: 'TikTok Viral', fontFamily: "'Inter', sans-serif", fontSize: 28, fontWeight: 900, color: '#FFFFFF', highlightColor: '#8b5cf6', strokeColor: '#000000', strokeWidth: 3, position: 'bottom', bgColor: 'transparent', preview: 'Bold white, purple highlights' },
    { id: 'youtube', name: 'YouTube Cinematic', fontFamily: "'Outfit', sans-serif", fontSize: 22, fontWeight: 700, color: '#FBBF24', highlightColor: '#FBBF24', strokeColor: '#000000', strokeWidth: 4, position: 'bottom', bgColor: 'rgba(0,0,0,0.6)', preview: 'Yellow on black bar' },
    { id: 'minimal', name: 'Clean Minimal', fontFamily: "'Inter', sans-serif", fontSize: 20, fontWeight: 500, color: '#FFFFFF', highlightColor: '#FFFFFF', strokeColor: 'transparent', strokeWidth: 0, position: 'bottom', bgColor: 'rgba(0,0,0,0.5)', preview: 'Soft white, subtle bg' },
    { id: 'neon', name: 'Neon Glow', fontFamily: "'Inter', sans-serif", fontSize: 26, fontWeight: 800, color: '#00FF88', highlightColor: '#FF00FF', strokeColor: '#000000', strokeWidth: 2, position: 'center', bgColor: 'transparent', preview: 'Green + magenta glow' },
    { id: 'karaoke', name: 'Karaoke Style', fontFamily: "'Inter', sans-serif", fontSize: 24, fontWeight: 700, color: '#FFFFFF', highlightColor: '#EF4444', strokeColor: '#000000', strokeWidth: 3, position: 'center', bgColor: 'transparent', preview: 'Word-by-word red highlight' },
    { id: 'podcast', name: 'Podcast Wave', fontFamily: "'Inter', sans-serif", fontSize: 18, fontWeight: 600, color: '#E0E7FF', highlightColor: '#6366F1', strokeColor: 'transparent', strokeWidth: 0, position: 'bottom', bgColor: 'rgba(30,27,75,0.85)', preview: 'Indigo box, clean type' },
    { id: 'gaming', name: 'Gamer HUD', fontFamily: "'Roboto', sans-serif", fontSize: 24, fontWeight: 900, color: '#FFD700', highlightColor: '#FF4500', strokeColor: '#000000', strokeWidth: 4, position: 'bottom', bgColor: 'transparent', preview: 'Yellow & Orange punchy bold' },
    { id: 'diary', name: 'Vlog Diary', fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 400, color: '#333333', highlightColor: '#000000', strokeColor: '#FFFFFF', strokeWidth: 2, position: 'bottom', bgColor: 'rgba(255,255,255,0.7)', preview: 'White semi-transparent box, dark text' },
    { id: 'luxury', name: 'Luxury Auto', fontFamily: "'Outfit', sans-serif", fontSize: 22, fontWeight: 300, color: '#DDDDDD', highlightColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 1, position: 'center', bgColor: 'transparent', preview: 'Thin, elegant, center-aligned' },
    { id: 'bold_drop', name: 'Drop Shadow', fontFamily: "'Inter', sans-serif", fontSize: 32, fontWeight: 900, color: '#FFFFFF', highlightColor: '#00BFFF', strokeColor: '#222222', strokeWidth: 5, position: 'center', bgColor: 'transparent', preview: 'Extremely bold, thick dark stroke' },
];

export default function ContentStudioPage() {
    const { currentWorkspace } = useWorkspace();
    const navigate = useNavigate();
    const location = useLocation();
    const setVideo = useEditorStore(state => state.setVideo);
    const videoRef = useRef(null);
    const previewVideoRef = useRef(null);
    const fileInputRef = useRef(null);
    const mediaBlobUrl = useRef(null);

    // Media state
    const [media, setMedia] = useState(null);
    const [mediaType, setMediaType] = useState(null);
    const [mediaUrl, setMediaUrl] = useState(null);

    // Pipeline state
    const [analysisJobId, setAnalysisJobId] = useState(null);
    const [analysis, setAnalysis] = useState(null);
    const [videoInfo, setVideoInfo] = useState(null);

    // Content state
    // AI Tools can hand over generated text via router state ("Send to Studio").
    const [caption, setCaption] = useState(() => location.state?.caption || '');
    const [selectedPlatforms, setSelectedPlatforms] = useState([]);
    const [subtitles, setSubtitles] = useState([]);
    const [selectedStyle, setSelectedStyle] = useState(CAPTION_STYLES[0]);
    const [showCaptions, setShowCaptions] = useState(true);
    const [currentSubtitleIndex, setCurrentSubtitleIndex] = useState(0);

    // Preview state
    const [previewMode, setPreviewMode] = useState('mobile');
    const [previewPlaying, setPreviewPlaying] = useState(false);
    const [renderedVideoUrl, setRenderedVideoUrl] = useState(null);
    const [renderQuality, setRenderQuality] = useState('standard');

    // AI Video Reference (Style)
    const [referenceUrl, setReferenceUrl] = useState('');

    // Trimming state
    const [startTime, setStartTime] = useState(0); // Ms
    const [endTime, setEndTime] = useState(30000); // Ms (default 30s or video duration)
    const [duration, setDuration] = useState(0);

    // Music state
    const [selectedMusic, setSelectedMusic] = useState(null); // {id, name}
    const [musicVolume, setMusicVolume] = useState(0.2);

    // UI state
    const [uploading, setUploading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [rendering, setRendering] = useState(false);
    const [renderProgress, setRenderProgress] = useState(0);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [activeTab, setActiveTab] = useState('editor');
    const [connections, setConnections] = useState([]);
    const [videoPlaying, setVideoPlaying] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [showEditChoice, setShowEditChoice] = useState(false);
    const [pendingVideoFile, setPendingVideoFile] = useState(null);

    useEffect(() => {
        if (currentWorkspace?.id) fetchConnections();
    }, [currentWorkspace?.id]);

    // Subtitle cycling for preview
    useEffect(() => {
        if (subtitles.length === 0) return;
        if (previewVideoRef.current && previewPlaying) {
            const v = previewVideoRef.current;
            const onTime = () => {
                const ms = v.currentTime * 1000;
                const idx = subtitles.findIndex(s => ms >= (s.startMs || 0) && ms < (s.endMs || (s.startMs || 0) + 3000));
                if (idx !== -1) setCurrentSubtitleIndex(idx);
            };
            v.addEventListener('timeupdate', onTime);
            return () => v.removeEventListener('timeupdate', onTime);
        }
        // Auto-cycle when not playing
        const interval = setInterval(() => setCurrentSubtitleIndex(p => (p + 1) % subtitles.length), 2500);
        return () => clearInterval(interval);
    }, [subtitles, previewPlaying]);

    async function fetchConnections() {
        try {
            const data = await apiClient(`/workspaces/${currentWorkspace.id}/connections`);
            const active = (data.connections || []).filter(c => c.status === 'active').map(c => c.id);
            setConnections(data.connections || []);
            setSelectedPlatforms(active);
        } catch { }
    }

    // ======================================================
    // 1. UPLOAD VIDEO — show edit mode choice
    // ======================================================
    const handleMediaUpload = async (file) => {
        if (!file) return;
        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');
        if (!isVideo && !isImage) { setError('Upload a video or image file.'); return; }

        // Create a stable blob URL for this file
        if (mediaBlobUrl.current) URL.revokeObjectURL(mediaBlobUrl.current);
        mediaBlobUrl.current = URL.createObjectURL(file);

        setMedia(file);
        setMediaType(isVideo ? 'video' : 'image');
        setPreviewPlaying(false);
        setAnalysisJobId(null);
        setSubtitles([]);
        setRenderedVideoUrl(null);

        if (isVideo) {
            // Show edit mode choice instead of auto-analyzing
            setPendingVideoFile(file);
            setShowEditChoice(true);
            setSuccessMsg('Video ready — choose how you want to edit it.');
        } else {
            setSuccessMsg('Image uploaded successfully.');
        }
    };

    // Navigate to manual video editor
    const handleManualEdit = () => {
        if (pendingVideoFile) {
            setVideo(pendingVideoFile, URL.createObjectURL(pendingVideoFile));
        }
        setShowEditChoice(false);
        navigate('/editor');
    };

    // Start AI auto-edit pipeline (existing flow)
    const startAutoEdit = async () => {
        const file = pendingVideoFile;
        if (!file) return;
        setShowEditChoice(false);
        setPendingVideoFile(null);
        setUploading(true);
        setUploadProgress(0);

        try {
            setAnalyzing(true);
            setSuccessMsg('Uploading video for analysis…');

            const { auth } = await import('../lib/firebase');
            const token = await auth.currentUser?.getIdToken();
            const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

            const formData = new FormData();
            formData.append('video', file);
            formData.append('context', caption || '');
            if (referenceUrl) {
                formData.append('referenceUrl', referenceUrl);
            }

            const progressInterval = setInterval(() => setUploadProgress(p => Math.min(p + 5, 85)), 500);

            const res = await fetch(`${API_URL}/ai/video/analyze`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });

            clearInterval(progressInterval);
            setUploadProgress(100);

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Analysis failed');
            }

            const data = await res.json();
            setAnalysisJobId(data.jobId);
            setAnalysis(data.analysis);
            setVideoInfo(data.videoInfo);

            if (data.analysis.transcription?.length > 0) {
                setSubtitles(data.analysis.transcription);
                setShowCaptions(true);
            }

            if (data.analysis.suggestedCaption && !caption) {
                setCaption(data.analysis.suggestedCaption);
            }

            if (data.videoInfo?.durationMs) {
                setDuration(data.videoInfo.durationMs);
                setEndTime(data.videoInfo.durationMs);
            }

            const SOURCES = {
                whisper: 'OpenAI Whisper',
                'local-whisper': 'local Whisper (offline)',
                gemini: 'Gemini',
            };
            if (data.analysis._source === 'fallback') {
                setSuccessMsg('Video uploaded, but no transcription service was available, so no captions were added. You can still crop and render, or add captions manually.');
            } else {
                setSuccessMsg(`Analysed with ${SOURCES[data.analysis._source] || 'AI'} — ${data.analysis.transcription?.length || 0} subtitles, ${data.analysis.keyMoments?.length || 0} key moments.`);
            }
            setActiveTab('captions');
        } catch (err) {
            console.error('Upload/analyze error:', err);
            setError(err.message || 'Upload failed');
        } finally {
            setUploading(false);
            setAnalyzing(false);
            setTimeout(() => setUploadProgress(0), 1000);
        }
    };

    // ======================================================
    // 2. RENDER EDITED VIDEO (crop + captions via FFmpeg)
    // ======================================================
    const handleRenderVideo = async (mode = 'full') => {
        if (!analysisJobId) {
            setError('Upload and analyze a video first.');
            return;
        }

        setRendering(true);
        setRenderProgress(0);
        setError('');
        setSuccessMsg('Rendering video…');

        try {
            const { auth } = await import('../lib/firebase');
            const token = await auth.currentUser?.getIdToken();
            const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

            const res = await fetch(`${API_URL}/ai/video/edit`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    jobId: analysisJobId,
                    subtitles,
                    style: selectedStyle,
                    options: {
                        mode,
                        startMs: startTime,
                        endMs: endTime,
                        musicId: selectedMusic?.id,
                        musicVolume,
                        quality: renderQuality,
                    },
                }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Render failed');
            }

            const data = await res.json();
            const renderId = data.renderId;

            // Poll for completion
            const pollInterval = setInterval(async () => {
                try {
                    const statusRes = await fetch(`${API_URL}/ai/video/status/${renderId}`, {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    const status = await statusRes.json();

                    setRenderProgress(status.progress || 0);

                    if (status.status === 'completed') {
                        clearInterval(pollInterval);
                        setRendering(false);
                        // Fix the URL: ensure no double /api
                        const base = API_URL.endsWith('/api') ? API_URL.replace('/api', '') : API_URL;
                        setRenderedVideoUrl(`${base}${status.downloadUrl}`);
                        setSuccessMsg('Video rendered. Preview it in the phone view.');
                        setPreviewPlaying(false); // Reset preview to allow playing new output
                    } else if (status.status === 'failed') {
                        clearInterval(pollInterval);
                        setRendering(false);
                        setError(`Render failed: ${status.error}`);
                        setSuccessMsg('');
                    }
                } catch { }
            }, 2000);

            // Timeout after 5 minutes
            setTimeout(() => { clearInterval(pollInterval); }, 300000);
        } catch (err) {
            setError(err.message || 'Render failed');
            setRendering(false);
            setSuccessMsg('');
        }
    };

    // ======================================================
    // 3. AI Caption (text for post)
    // ======================================================
    const handleAiCaption = async () => {
        if (!currentWorkspace?.id) { setError('Sign in to use AI features.'); return; }
        setAiGenerating(true); setError('');
        try {
            const data = await apiClient('/ai/generate', {
                method: 'POST',
                body: JSON.stringify({ workspaceId: currentWorkspace.id, prompt: caption || 'Write an engaging social media caption', type: 'caption', tone: 'Professional' }),
            });
            setCaption(data.result);
        } catch (err) { setError(err.message); } finally { setAiGenerating(false); }
    };

    // SRT export
    const handleExportSrt = async () => {
        if (subtitles.length === 0) return;
        try {
            const data = await apiClient('/ai/captions/export', { method: 'POST', body: JSON.stringify({ captions: subtitles }) });
            const blob = new Blob([data.srt], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'captions.srt'; a.click();
            URL.revokeObjectURL(url);
        } catch { setError('Export failed'); }
    };

    // SRT upload
    const handleSrtUpload = async (file) => {
        if (!file?.name.endsWith('.srt')) { setError('Upload a .srt file.'); return; }
        try {
            const text = await file.text();
            const data = await apiClient('/ai/captions/parse', { method: 'POST', body: JSON.stringify({ srtContent: text }) });
            setSubtitles(data.captions || []); setShowCaptions(true);
        } catch (err) { setError(err.message); }
    };

    // Save / Publish
    const handleSaveDraft = async () => {
        if (!caption) return;
        if (!currentWorkspace?.id) { setError('Sign in first.'); return; }
        setSaving(true);
        try {
            await apiClient(`/workspaces/${currentWorkspace.id}/content`, { method: 'POST', body: JSON.stringify({ type: mediaType || 'text', mediaUrl: renderedVideoUrl || mediaUrl, caption, platforms: selectedPlatforms, status: 'draft' }) });
            setSaved(true); setTimeout(() => setSaved(false), 3000);
        } catch (err) { setError(err.message); } finally { setSaving(false); }
    };

    const handlePublish = async () => {
        if (!caption) return;
        if (!currentWorkspace?.id) { setError('Sign in first.'); return; }
        setPublishing(true);
        try {
            const data = await apiClient(`/workspaces/${currentWorkspace.id}/content`, {
                method: 'POST',
                body: JSON.stringify({
                    type: mediaType || 'text',
                    mediaUrl: renderedVideoUrl || mediaUrl,
                    caption,
                    platforms: selectedPlatforms,
                    status: 'draft'
                })
            });
            navigate('/dashboard/scheduler', { state: { scheduleDraftId: data.content?.id } });
        } catch (err) { setError(err.message); } finally { setPublishing(false); }
    };

    const removeMedia = () => {
        if (mediaBlobUrl.current) { URL.revokeObjectURL(mediaBlobUrl.current); mediaBlobUrl.current = null; }
        setMedia(null); setMediaUrl(null); setMediaType(null);
        setSubtitles([]); setAnalysis(null); setAnalysisJobId(null);
        setRenderedVideoUrl(null); setVideoPlaying(false); setPreviewPlaying(false);
    };

    const togglePlatform = (id) => setSelectedPlatforms(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

    const handleSelectCut = (cut) => {
        setStartTime(cut.startMs);
        setEndTime(cut.endMs);
        if (previewVideoRef.current) {
            previewVideoRef.current.currentTime = cut.startMs / 1000;
            previewVideoRef.current.play();
        }
        setSuccessMsg(`Clip selected: ${formatMs(cut.startMs)} — ${formatMs(cut.endMs)}`);
    };

    const togglePreviewPlay = (e) => {
        if (e) e.stopPropagation();
        const vid = previewVideoRef.current;
        if (!vid) return;
        if (vid.paused || vid.ended) {
            vid.play().then(() => setPreviewPlaying(true)).catch(() => { });
        } else {
            vid.pause();
            setPreviewPlaying(false);
        }
    };

    const currentSub = subtitles[currentSubtitleIndex] || null;

    // ======================================================
    // RENDER
    // ======================================================
    return (
        <div className="content-studio animate-fade-in">
            <div className="page-header">
                <div>
                    <h1>New post</h1>
                    <p className="page-subtitle">Upload one video, caption it and publish it to your connected accounts. For long videos, use Clips.</p>
                </div>
                <div className="flex gap-md header-actions">
                    <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={saving || !caption}>
                        {saved ? <><Check size={18} /> Saved!</> : saving ? <><Loader2 size={18} className="spin" /></> : <><Save size={18} /> Save</>}
                    </button>
                    <button className="btn btn-primary" onClick={handlePublish} disabled={publishing || !caption}>
                        {publishing ? <Loader2 size={18} className="spin" /> : <><Send size={18} /> Publish</>}
                    </button>
                </div>
            </div>

            {error && (
                <div className="error-banner animate-fade-in">
                    <AlertCircle size={16} /><span>{error}</span>
                    <button className="btn-icon btn-ghost" onClick={() => setError('')}><X size={14} /></button>
                </div>
            )}
            {successMsg && (
                <div className="success-banner animate-fade-in">
                    <Check size={16} /><span>{successMsg}</span>
                    <button className="btn-icon btn-ghost" onClick={() => setSuccessMsg('')}><X size={14} /></button>
                </div>
            )}

            {/* Pipeline Status */}
            {(analyzing || rendering) && (
                <div className="pipeline-status">
                    <div className="pipeline-steps">
                        <div className={`pipeline-step ${media ? 'done' : ''}`}><Upload size={16} /> Upload</div>
                        <div className="pipeline-arrow">→</div>
                        <div className={`pipeline-step ${analyzing ? 'active' : analysis ? 'done' : ''}`}><Zap size={16} /> AI Analyze</div>
                        <div className="pipeline-arrow">→</div>
                        <div className={`pipeline-step ${rendering ? 'active' : renderedVideoUrl ? 'done' : ''}`}><Scissors size={16} /> Render</div>
                        <div className="pipeline-arrow">→</div>
                        <div className={`pipeline-step ${renderedVideoUrl ? 'done' : ''}`}><Eye size={16} /> Preview</div>
                    </div>
                    {rendering && (
                        <div className="render-progress-bar">
                            <div className="render-progress-fill" style={{ width: `${renderProgress}%` }} />
                            <span>{renderProgress}% rendering...</span>
                        </div>
                    )}
                    {analyzing && <span className="pipeline-label"><Loader2 size={14} className="spin" /> Gemini is analyzing your video...</span>}
                </div>
            )}

            {/* Tabs */}
            <div className="studio-tabs">
                <button className={`studio-tab ${activeTab === 'editor' ? 'active' : ''}`} onClick={() => setActiveTab('editor')}><Layers size={18} /> Edit</button>
                <button className={`studio-tab ${activeTab === 'captions' ? 'active' : ''}`} onClick={() => setActiveTab('captions')}><Type size={18} /> Subtitles {subtitles.length > 0 && <span className="tab-badge">{subtitles.length}</span>}</button>
                <button className={`studio-tab ${activeTab === 'music' ? 'active' : ''}`} onClick={() => setActiveTab('music')}><Music size={18} /> Music</button>
                <button className={`studio-tab ${activeTab === 'styles' ? 'active' : ''}`} onClick={() => setActiveTab('styles')}><Palette size={18} /> Styles</button>
            </div>

            <div className="studio-container">
                {/* ====== LEFT PANEL ====== */}
                <div className="studio-editor card animate-slide-in">
                    {activeTab === 'editor' && (
                        <>
                            {/* Upload */}
                            <section className="editor-section">
                                <div className="section-title"><Upload size={18} /><h3>Video</h3></div>
                                <div className="media-dropzone glass" onDrop={(e) => { e.preventDefault(); if (e.dataTransfer?.files?.[0]) handleMediaUpload(e.dataTransfer.files[0]); }} onDragOver={(e) => e.preventDefault()}>
                                    {media ? (
                                        <div className="media-preview">
                                            <button className="remove-media" onClick={(e) => { e.stopPropagation(); removeMedia(); }}><X size={16} /></button>
                                            {mediaType === 'video' ? (
                                                <video ref={videoRef} src={URL.createObjectURL(media)} className="video-preview" controls />
                                            ) : (
                                                <img src={URL.createObjectURL(media)} alt="Preview" />
                                            )}
                                            {(uploading || analyzing) && (
                                                <div className="upload-overlay">
                                                    <Loader2 size={28} className="spin" />
                                                    <span>{analyzing ? 'Analyzing with Gemini...' : `Uploading ${uploadProgress}%`}</span>
                                                    <div className="upload-progress-bar"><div className="upload-progress-fill" style={{ width: `${uploadProgress}%` }} /></div>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="dropzone-label" onClick={() => fileInputRef.current?.click()}>
                                            <input ref={fileInputRef} type="file" accept="video/*,image/*"
                                                onChange={(e) => { if (e.target.files?.[0]) handleMediaUpload(e.target.files[0]); }} hidden />
                                            <div className="dropzone-icon"><Video size={36} /></div>
                                            <p>Drop your video here or <span>browse</span></p>
                                            <span className="dropzone-hint">MP4 or MOV up to 100 MB</span>
                                        </div>
                                    )}
                                </div>
                            </section>

                            {/* Video Edit Mode Choice */}
                            {showEditChoice && media && mediaType === 'video' && (
                                <section className="editor-section animate-slide-in">
                                    <div className="section-title"><Scissors size={18} /><h3>How do you want to edit it?</h3></div>
                                    <div className="edit-mode-container" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '16px' }}>
                                        <button
                                            className="edit-mode-card glass btn-reset"
                                            onClick={handleManualEdit}
                                            style={{
                                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
                                                padding: '24px', cursor: 'pointer', textAlign: 'center', borderRadius: '12px',
                                                transition: 'all 0.2s', border: '2px solid var(--border-color)',
                                                background: 'rgba(255,255,255,0.03)', width: '100%'
                                            }}
                                            onMouseEnter={e => {
                                                e.currentTarget.style.borderColor = 'var(--accent, #a78bfa)';
                                                e.currentTarget.style.transform = 'translateY(-4px)';
                                                e.currentTarget.style.background = 'rgba(167,139,250,0.07)';
                                            }}
                                            onMouseLeave={e => {
                                                e.currentTarget.style.borderColor = 'var(--border-color)';
                                                e.currentTarget.style.transform = 'translateY(0)';
                                                e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                                            }}
                                        >
                                            <div style={{ background: 'rgba(167,139,250,0.15)', padding: '12px', borderRadius: '50%', marginBottom: '4px' }}>
                                                <Scissors size={24} style={{ color: 'var(--accent, #a78bfa)' }} />
                                            </div>
                                            <strong style={{ fontSize: '1.1rem' }}>Manual Editor</strong>
                                            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>Full creative control — Trim, Speed, Filters, Text & More</p>
                                            <div className="btn btn-sm btn-secondary" style={{ marginTop: '12px' }}>Launch Editor <Scissors size={14} /></div>
                                        </button>

                                        <button
                                            className="edit-mode-card glass btn-reset"
                                            onClick={startAutoEdit}
                                            style={{
                                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
                                                padding: '24px', cursor: 'pointer', textAlign: 'center', borderRadius: '12px',
                                                transition: 'all 0.2s', border: '2px solid var(--border-color)',
                                                background: 'rgba(255,255,255,0.03)', width: '100%'
                                            }}
                                            onMouseEnter={e => {
                                                e.currentTarget.style.borderColor = 'var(--primary)';
                                                e.currentTarget.style.transform = 'translateY(-4px)';
                                                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                                            }}
                                            onMouseLeave={e => {
                                                e.currentTarget.style.borderColor = 'var(--border-color)';
                                                e.currentTarget.style.transform = 'translateY(0)';
                                                e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                                            }}
                                        >
                                            <div style={{ background: 'var(--primary-glow)', padding: '12px', borderRadius: '50%', marginBottom: '4px' }}>
                                                <Zap size={24} style={{ color: 'var(--primary)' }} />
                                            </div>
                                            <strong style={{ fontSize: '1.1rem' }}>AI Auto-Edit</strong>
                                            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>Smart Automation — Gemini analyzes and crops for you</p>
                                            <div className="btn btn-sm btn-primary" style={{ marginTop: '12px' }}>Auto-edit with AI <Sparkles size={14} /></div>
                                        </button>
                                    </div>
                                </section>
                            )}

                            {/* Reference Style Video */}
                            <section className="editor-section">
                                <div className="section-title"><Smartphone size={18} /><h3>Style reference (optional)</h3></div>
                                <div className="glass" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <input type="text" className="input" placeholder="Paste a TikTok link here..." value={referenceUrl}
                                            onChange={(e) => setReferenceUrl(e.target.value)} style={{ flex: 1, margin: 0, borderColor: referenceUrl && !referenceUrl.includes('tiktok.com') ? 'var(--error)' : undefined }} />
                                        {referenceUrl && <button className="btn-icon btn-ghost" onClick={() => setReferenceUrl('')}><X size={16} /></button>}
                                    </div>
                                    {referenceUrl && !referenceUrl.includes('tiktok.com') && (
                                        <span className="text-xs text-error" style={{ color: 'var(--error)' }}>Please provide a valid TikTok link.</span>
                                    )}
                                </div>
                            </section>

                            {/* AI Analysis Results */}
                            {analysis && (
                                <section className="editor-section analysis-results">
                                    <div className="section-title"><Zap size={18} /><h3>AI Analysis</h3></div>

                                    {analysis.summary && (
                                        <div className="analysis-card">
                                            <strong>Summary</strong>
                                            <p>{analysis.summary}</p>
                                        </div>
                                    )}

                                    {analysis.keyMoments?.length > 0 && (
                                        <div className="analysis-card">
                                            <strong>Key Moments</strong>
                                            <div className="key-moments-list">
                                                {analysis.keyMoments.map((m, i) => (
                                                    <div key={i} className="key-moment">
                                                        <span className="moment-time">{formatMs(m.startMs)} - {formatMs(m.endMs)}</span>
                                                        <span className="moment-desc">{m.description}</span>
                                                        <span className="moment-score">{m.score}/10</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {analysis.suggestedCuts?.length > 0 && (
                                        <div className="analysis-card">
                                            <div className="flex items-center justify-between">
                                                <strong>Suggested Clips</strong>
                                                <span className="text-xs text-muted">Click to select</span>
                                            </div>
                                            <div className="suggested-cuts">
                                                {analysis.suggestedCuts.map((cut, i) => (
                                                    <button key={i} className={`btn btn-sm cut-btn ${startTime === cut.startMs ? 'btn-primary' : 'btn-secondary'}`}
                                                        onClick={() => handleSelectCut(cut)}
                                                        title={cut.reason}>
                                                        <Scissors size={14} /> {formatMs(cut.startMs)} — {formatMs(cut.endMs)}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </section>
                            )}

                            {/* Render Range / Trim */}
                            {analysis && (
                                <section className="editor-section">
                                    <div className="section-title"><Scissors size={18} /><h3>Part to keep</h3></div>
                                    <div className="range-controls glass">
                                        <div className="range-input-group">
                                            <div className="range-field">
                                                <label>Start</label>
                                                <input type="text" className="input input-sm" value={formatMs(startTime)} readOnly />
                                            </div>
                                            <div className="range-field">
                                                <label>End</label>
                                                <input type="text" className="input input-sm" value={formatMs(endTime)} readOnly />
                                            </div>
                                            <div className="range-field">
                                                <label>Duration</label>
                                                <span className="duration-label">{((endTime - startTime) / 1000).toFixed(1)}s</span>
                                            </div>
                                        </div>
                                        <button className="btn btn-sm btn-ghost" onClick={() => { setStartTime(0); setEndTime(duration); }}>Reset to Full Video</button>
                                    </div>
                                </section>
                            )}

                            {/* Output Quality */}
                            {analysisJobId && (
                                <section className="editor-section">
                                    <div className="section-title"><Monitor size={18} /><h3>Quality</h3></div>
                                    <div className="flex gap-md" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                                        <label className={`radio-card ${renderQuality === 'standard' ? 'active' : ''}`} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <input type="radio" value="standard" checked={renderQuality === 'standard'} onChange={() => setRenderQuality('standard')} hidden />
                                            <strong>Standard HD</strong>
                                            <span className="text-xs text-muted">720p / Fast render</span>
                                        </label>
                                        <label className={`radio-card ${renderQuality === 'high' ? 'active' : ''}`} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <input type="radio" value="high" checked={renderQuality === 'high'} onChange={() => setRenderQuality('high')} hidden />
                                            <strong>Upscale / 1080p</strong>
                                            <span className="text-xs text-muted">High Q / Slower</span>
                                        </label>
                                    </div>
                                </section>
                            )}

                            {/* Render Actions */}
                            {analysisJobId && (
                                <section className="editor-section">
                                    <div className="section-title"><Scissors size={18} /><h3>Render</h3></div>
                                    <div className="render-actions">
                                        <button className="btn btn-primary" onClick={() => handleRenderVideo('full')} disabled={rendering}>
                                            {rendering ? <><Loader2 size={16} className="spin" /> Rendering...</> : <><Scissors size={16} /> Crop to Vertical + Captions</>}
                                        </button>
                                        <button className="btn btn-secondary" onClick={() => handleRenderVideo('crop')} disabled={rendering}>
                                            <Smartphone size={16} /> Crop Only (9:16)
                                        </button>
                                        <button className="btn btn-secondary" onClick={() => handleRenderVideo('caption')} disabled={rendering}>
                                            <Type size={16} /> Captions Only
                                        </button>
                                    </div>
                                </section>
                            )}

                            {/* Caption */}
                            <section className="editor-section">
                                <div className="section-title">
                                    <Type size={18} /><h3>Caption</h3>
                                    <button className="btn-ai btn-sm ml-auto" onClick={handleAiCaption} disabled={aiGenerating}>
                                        {aiGenerating ? <Loader2 size={14} className="spin" /> : <><Sparkles size={14} /> AI</>}
                                    </button>
                                </div>
                                <textarea className="input caption-input" placeholder="Write your caption..." value={caption} onChange={(e) => setCaption(e.target.value)} />
                            </section>

                            {/* Platforms */}
                            <section className="editor-section">
                                <div className="section-title"><Calendar size={18} /><h3>Publish to</h3></div>

                                <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                                    <button
                                        className="btn btn-sm btn-ghost"
                                        onClick={() => {
                                            if (selectedPlatforms.length === connections.filter(c => c.status === 'active').length) {
                                                setSelectedPlatforms([]);
                                            } else {
                                                setSelectedPlatforms(connections.filter(c => c.status === 'active').map(c => c.id));
                                            }
                                        }}
                                    >
                                        <Check size={14} /> Select all
                                    </button>
                                </div>

                                <div className="platform-connections-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {connections.length === 0 ? (
                                        <div className="no-connections-hint"><AlertCircle size={14} /><span>No connections. <a href="/dashboard/connections">Connect now</a></span></div>
                                    ) : (
                                        // Group by groupName or 'Ungrouped'
                                        Object.entries(connections.reduce((acc, curr) => {
                                            const group = curr.groupName || 'Ungrouped';
                                            if (!acc[group]) acc[group] = [];
                                            acc[group].push(curr);
                                            return acc;
                                        }, {})).map(([group, groupConns]) => (
                                            <div key={group} className="connection-group" style={{
                                                background: 'var(--bg-secondary)',
                                                padding: '12px',
                                                borderRadius: '8px',
                                                border: '1px solid var(--border-color)'
                                            }}>
                                                <h4 style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                    {group}
                                                </h4>
                                                <div className="platform-selector" style={{ justifyContent: 'flex-start' }}>
                                                    {groupConns.map(conn => {
                                                        const pInfo = PLATFORMS.find(p => p.id === conn.platform);
                                                        const Icon = pInfo ? pInfo.icon : Target;
                                                        const color = pInfo ? pInfo.color : '#888';
                                                        const isActive = conn.status === 'active';

                                                        return (
                                                            <button
                                                                key={conn.id}
                                                                title={`@${conn.username} (${conn.platform})`}
                                                                className={`platform-btn ${selectedPlatforms.includes(conn.id) ? 'active' : ''} ${!isActive ? 'disabled' : ''}`}
                                                                onClick={() => isActive && togglePlatform(conn.id)}
                                                                style={{ '--p-color': color }}
                                                            >
                                                                <Icon size={20} />
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </section>
                        </>
                    )}

                    {activeTab === 'captions' && (
                        <>
                            <section className="editor-section">
                                <div className="section-title"><FileText size={18} /><h3>Subtitles</h3></div>
                                <div className="ai-subtitle-actions">
                                    {!analysis && (
                                        <p className="section-desc">Upload a video on the Editor tab — Gemini will generate subtitles automatically.</p>
                                    )}
                                    <div className="srt-mini-upload">
                                        <label className="btn btn-secondary btn-sm">
                                            <FileText size={14} /> Upload SRT
                                            <input type="file" accept=".srt" onChange={(e) => { if (e.target.files?.[0]) handleSrtUpload(e.target.files[0]); }} hidden />
                                        </label>
                                        {subtitles.length > 0 && (
                                            <button className="btn btn-sm btn-secondary" onClick={handleExportSrt}><Download size={14} /> Export SRT</button>
                                        )}
                                        {subtitles.length > 0 && (
                                            <button className="btn btn-sm btn-ghost" onClick={() => setShowCaptions(!showCaptions)}>
                                                {showCaptions ? 'Hide' : 'Show'} on Preview
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </section>

                            {subtitles.length > 0 && (
                                <section className="editor-section">
                                    <div className="section-title"><Type size={18} /><h3>{subtitles.length} Subtitles</h3></div>
                                    <div className="subtitle-list">
                                        {subtitles.map((sub, i) => (
                                            <div key={i} className={`subtitle-item ${i === currentSubtitleIndex ? 'active' : ''}`} onClick={() => setCurrentSubtitleIndex(i)}>
                                                <span className="subtitle-time">{formatMs(sub.startMs || 0)}</span>
                                                <input className="subtitle-text-input" value={sub.text}
                                                    onChange={(e) => { const u = [...subtitles]; u[i] = { ...u[i], text: e.target.value }; setSubtitles(u); }} />
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            )}
                        </>
                    )}

                    {activeTab === 'music' && (
                        <>
                            <section className="editor-section">
                                <div className="section-title"><Music size={18} /><h3>Background music</h3></div>
                                <div className="music-grid">
                                    {[
                                        { id: 'Soft Corners of the Day.mp3', name: 'Soft Corners of the Day' },
                                        { id: 'Soft Corners of the Day (1).mp3', name: 'Soft Corners of the Day (Alt 1)' },
                                        { id: 'Soft Corners of the Day (2).mp3', name: 'Soft Corners of the Day (Alt 2)' },
                                        { id: 'Midnight Apartment Walls.mp3', name: 'Midnight Apartment Walls' },
                                        { id: 'Clouds in My Coffee (1).mp3', name: 'Clouds in My Coffee' }
                                    ].map(track => (
                                        <button key={track.id} className={`music-track-card ${selectedMusic?.id === track.id ? 'active' : ''}`}
                                            onClick={() => setSelectedMusic(selectedMusic?.id === track.id ? null : track)}>
                                            <div className="track-icon"><Music size={20} /></div>
                                            <div className="track-info">
                                                <strong>{track.name}</strong>
                                                <span>{track.id}</span>
                                            </div>
                                            {selectedMusic?.id === track.id && <div className="track-check"><Check size={14} /></div>}
                                        </button>
                                    ))}
                                </div>
                                {selectedMusic && (
                                    <div style={{ marginTop: '20px' }}>
                                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Preview Selected Track</p>
                                        <audio crossOrigin="anonymous" controls src={`${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000'}/public/sounds/${encodeURIComponent(selectedMusic.id)}`} style={{ width: '100%', height: '40px', borderRadius: '8px' }} />
                                    </div>
                                )}
                            </section>
                            <section className="editor-section">
                                <div className="section-title"><Volume2 size={18} /><h3>Music volume</h3></div>
                                <div className="style-controls">
                                    <div className="control-row">
                                        <label>Level</label>
                                        <input type="range" min="0" max="1" step="0.05" value={musicVolume} onChange={(e) => setMusicVolume(parseFloat(e.target.value))} />
                                        <span>{Math.round(musicVolume * 100)}%</span>
                                    </div>
                                    <p className="text-xs text-muted">Original audio will be balanced with this music track.</p>
                                </div>
                            </section>
                        </>
                    )}

                    {activeTab === 'styles' && (
                        <>
                            <section className="editor-section">
                                <div className="section-title"><Palette size={18} /><h3>Caption style</h3></div>
                                <div className="style-grid">
                                    {CAPTION_STYLES.map(style => (
                                        <button key={style.id} className={`style-card ${selectedStyle.id === style.id ? 'active' : ''}`}
                                            onClick={() => setSelectedStyle(style)}>
                                            <div className="style-preview-box" style={{
                                                fontFamily: style.fontFamily, fontWeight: style.fontWeight, color: style.color,
                                                fontSize: '14px', textShadow: style.strokeWidth > 0 ? `0 0 ${style.strokeWidth}px ${style.strokeColor}` : 'none',
                                                background: style.bgColor || '#111', padding: '8px 12px', borderRadius: '6px',
                                            }}>Hello World</div>
                                            <div className="style-info"><strong>{style.name}</strong><span>{style.preview}</span></div>
                                            {selectedStyle.id === style.id && <div className="style-check"><Check size={14} /></div>}
                                        </button>
                                    ))}
                                </div>
                            </section>
                            <section className="editor-section">
                                <div className="section-title"><Scissors size={18} /><h3>Customize</h3></div>
                                <div className="style-controls">
                                    <div className="control-row"><label>Size</label>
                                        <input type="range" min="14" max="40" value={selectedStyle.fontSize} onChange={(e) => setSelectedStyle({ ...selectedStyle, fontSize: +e.target.value })} />
                                        <span>{selectedStyle.fontSize}px</span></div>
                                    <div className="control-row"><label>Text</label>
                                        <input type="color" value={selectedStyle.color} onChange={(e) => setSelectedStyle({ ...selectedStyle, color: e.target.value })} /></div>
                                    <div className="control-row"><label>Highlight</label>
                                        <input type="color" value={selectedStyle.highlightColor} onChange={(e) => setSelectedStyle({ ...selectedStyle, highlightColor: e.target.value })} /></div>
                                    <div className="control-row"><label>Position</label>
                                        <select className="input input-sm" value={selectedStyle.position} onChange={(e) => setSelectedStyle({ ...selectedStyle, position: e.target.value })}>
                                            <option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option>
                                        </select></div>
                                </div>
                            </section>
                        </>
                    )}
                </div>

                {/* ====== RIGHT: Live Preview ====== */}
                <div className="studio-preview">
                    <div className="preview-header">
                        <h3>Preview</h3>
                        <div className="preview-tabs">
                            <button className={`preview-tab ${previewMode === 'mobile' ? 'active' : ''}`} onClick={() => setPreviewMode('mobile')}><Smartphone size={14} /> Mobile</button>
                            <button className={`preview-tab ${previewMode === 'desktop' ? 'active' : ''}`} onClick={() => setPreviewMode('desktop')}><Monitor size={14} /> Desktop</button>
                        </div>
                    </div>

                    <div className="phone-container">
                        <div className={`phone-frame ${previewMode === 'desktop' ? 'desktop-frame' : ''}`}>
                            <div className="phone-screen">
                                <div className="preview-media" onClick={media && mediaType === 'video' ? togglePreviewPlay : undefined}>
                                    {renderedVideoUrl ? (
                                        <video
                                            ref={previewVideoRef}
                                            src={renderedVideoUrl}
                                            className="preview-video-fill"
                                            loop
                                            playsInline
                                            onEnded={() => setPreviewPlaying(false)}
                                            onPause={() => setPreviewPlaying(false)}
                                            onPlay={() => setPreviewPlaying(true)}
                                            autoPlay={false}
                                        />
                                    ) : media ? (
                                        mediaType === 'video' ? (
                                            <video
                                                ref={previewVideoRef}
                                                src={mediaBlobUrl.current}
                                                className="preview-video-fill"
                                                loop
                                                playsInline
                                                onEnded={() => setPreviewPlaying(false)}
                                                onPause={() => setPreviewPlaying(false)}
                                                onPlay={() => setPreviewPlaying(true)}
                                            />
                                        ) : (
                                            <img src={mediaBlobUrl.current} alt="" className="preview-video-fill" />
                                        )
                                    ) : (
                                        <div className="preview-placeholder"><Video size={40} /><span>Upload video to preview</span></div>
                                    )}

                                    {/* Play button overlay */}
                                    {media && mediaType === 'video' && !previewPlaying && (
                                        <div className="preview-play-overlay" onClick={togglePreviewPlay}>
                                            <div className="preview-play-btn"><Play size={28} /></div>
                                        </div>
                                    )}
                                    {renderedVideoUrl && !previewPlaying && (
                                        <div className="preview-play-overlay" onClick={togglePreviewPlay}>
                                            <div className="preview-play-btn"><Play size={28} /></div>
                                        </div>
                                    )}

                                    {/* Caption overlay (only for source, rendered video has burned-in captions) */}
                                    {showCaptions && currentSub && !renderedVideoUrl && (
                                        <div className={`caption-overlay caption-pos-${selectedStyle.position}`}
                                            style={{
                                                fontFamily: selectedStyle.fontFamily,
                                                fontSize: `${selectedStyle.fontSize * 0.5}px`,
                                                fontWeight: selectedStyle.fontWeight,
                                                color: selectedStyle.color,
                                                textShadow: selectedStyle.strokeWidth > 0
                                                    ? `0 0 ${selectedStyle.strokeWidth}px ${selectedStyle.strokeColor}, 0 0 ${selectedStyle.strokeWidth * 2}px ${selectedStyle.strokeColor}` : 'none',
                                                background: selectedStyle.bgColor || 'transparent',
                                                padding: selectedStyle.bgColor !== 'transparent' ? '6px 12px' : '0',
                                                borderRadius: '6px',
                                            }}>
                                            {currentSub.text.split(' ').map((word, wi) => (
                                                <span key={wi} style={{ color: wi === 0 ? selectedStyle.highlightColor : selectedStyle.color, marginRight: '4px' }}>{word}</span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {previewMode === 'mobile' && (
                                    <div className="preview-caption-area">
                                        <div className="ig-header-mini"><div className="ig-avatar" /><span>{currentWorkspace?.name || 'Nhlanhla_Ngcobo'}</span></div>
                                        <div className="ig-caption-text"><strong>{currentWorkspace?.name || 'Nhlanhla_Ngcobo'}</strong> {caption || 'Caption preview...'}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Download rendered video */}
                    {renderedVideoUrl && (
                        <div className="rendered-actions">
                            <a href={renderedVideoUrl} download className="btn btn-primary btn-block"><Download size={16} /> Download Rendered Video</a>
                            <button className="btn btn-secondary btn-block" onClick={() => setRenderedVideoUrl(null)}>← Back to Source</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function formatMs(ms) {
    if (!ms && ms !== 0) return '00:00';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
