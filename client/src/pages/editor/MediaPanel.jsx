import { Upload, Plus, Loader2, Film, Clock, Trash2, PlusCircle } from 'lucide-react';
import { useRef, useState } from 'react';

export default function MediaPanel({
    mediaItems,
    onUpload,
    uploading,
    onSelectMedia,
    onAddToTimeline,
    onDeleteMedia,
    activeTool,
}) {
    const fileRef = useRef(null);
    const [dragOver, setDragOver] = useState(false);

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        const mediaFiles = files.filter(f =>
            f.type.startsWith('video/') || f.type.startsWith('audio/') || f.type.startsWith('image/')
        );
        mediaFiles.forEach(f => onUpload(f));
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(true);
    };

    const handleDragLeave = () => {
        setDragOver(false);
    };

    return (
        <div
            className={`cc-media-panel ${dragOver ? 'cc-drag-over' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
        >
            {/* Top bar */}
            <div className="cc-media-header">
                <span className="cc-media-title">{activeTool === 'media' ? 'Media' : activeTool.charAt(0).toUpperCase() + activeTool.slice(1)}</span>
                <button
                    className="cc-import-btn"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                >
                    {uploading ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                    {uploading ? 'Uploading...' : 'Import'}
                </button>
                <input
                    ref={fileRef}
                    type="file"
                    accept="video/*,audio/*,image/*"
                    multiple
                    onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        files.forEach(f => onUpload(f));
                        e.target.value = '';
                    }}
                    hidden
                />
            </div>

            {/* Media grid */}
            {activeTool === 'media' && (
                <div className="cc-media-grid">
                    {mediaItems.length === 0 && !uploading && (
                        <div className="cc-media-empty">
                            <Film size={32} />
                            <p>No media imported</p>
                            <span>Click Import or drag videos here</span>
                        </div>
                    )}

                    {mediaItems.map((item) => (
                        <div
                            key={item.uploadId}
                            className="cc-media-item"
                            onClick={() => onSelectMedia(item)}
                        >
                            {/* Thumbnail */}
                            <div className="cc-media-thumb">
                                {item.thumbnails?.[0] ? (
                                    <img
                                        src={item._isLocal
                                            ? item.thumbnails[0]
                                            : `${item._pyBase}${item.thumbnails[0]}`
                                        }
                                        alt={item.filename}
                                        loading="lazy"
                                    />
                                ) : (
                                    <Film size={24} />
                                )}
                                <span className="cc-media-duration">
                                    <Clock size={10} />
                                    {formatDuration(item.duration)}
                                </span>
                            </div>
                            <div className="cc-media-info">
                                <span className="cc-media-name">{item.filename}</span>
                                <div className="cc-media-actions">
                                    <button
                                        className="cc-media-action-btn"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onAddToTimeline(item);
                                        }}
                                        title="Add to timeline"
                                    >
                                        <PlusCircle size={14} />
                                    </button>
                                    <button
                                        className="cc-media-action-btn cc-media-action-delete"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDeleteMedia(item.uploadId);
                                        }}
                                        title="Remove"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Audio Placeholder */}
            {activeTool === 'audio' && (
                <div className="cc-tool-placeholder">
                    <div className="placeholder-icon">🎵</div>
                    <h4>Audio Library</h4>
                    <p>Browse royalty-free music and sound effects. Click to apply placeholder.</p>
                    <div className="placeholder-list">
                        <button className="placeholder-item"> Cinematic Intro (2:01)</button>
                        <button className="placeholder-item"> Upbeat Vlog (1:15)</button>
                        <button className="placeholder-item"> Lofi Chill (3:30)</button>
                        <button className="placeholder-item"> SFX: Swoosh</button>
                        <button className="placeholder-item"> SFX: Pop</button>
                    </div>
                </div>
            )}

            {/* Text Placeholder */}
            {activeTool === 'text' && (
                <div className="cc-tool-placeholder">
                    <div className="placeholder-icon">T</div>
                    <h4>Text Presets</h4>
                    <p>Add text layers to your video. Click to apply placeholder.</p>
                    <div className="placeholder-list">
                        <button className="placeholder-item"><b>Default Heading</b></button>
                        <button className="placeholder-item" style={{ color: '#fff', textShadow: '0 0 5px #0ff, 0 0 10px #0ff' }}>Neon Glow</button>
                        <button className="placeholder-item" style={{ fontFamily: 'serif', fontStyle: 'italic' }}>Cinematic Title</button>
                        <button className="placeholder-item">Subtitle Style</button>
                    </div>
                </div>
            )}

            {/* Generic Placeholder for other tools */}
            {!['media', 'audio', 'text'].includes(activeTool) && (
                <div className="cc-tool-placeholder">
                    <div className="placeholder-icon">🎨</div>
                    <h4>{activeTool.charAt(0).toUpperCase() + activeTool.slice(1)} Library</h4>
                    <p>This capability is currently in development. Placeholders and UI elements will appear here soon.</p>
                    <div className="placeholder-list">
                        <button className="placeholder-item">Template 1</button>
                        <button className="placeholder-item">Template 2</button>
                        <button className="placeholder-item">Template 3</button>
                        <button className="placeholder-item">Template 4</button>
                    </div>
                </div>
            )}
        </div>
    );
}

function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}
