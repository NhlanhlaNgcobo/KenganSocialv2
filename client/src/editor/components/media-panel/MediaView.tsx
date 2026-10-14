import { useRef, useState } from 'react';
import { CloudUpload, Image as ImageIcon, Loader2, Music, Plus, Search, Trash2, Video } from 'lucide-react';
import { formatShort } from '../../lib/time';
import { useMediaStore } from '../../stores/media-store';
import { usePlaybackStore } from '../../stores/playback-store';
import { useProjectStore } from '../../stores/project-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';
import { DRAG_MIME, type MediaItem } from '../../types';

const TYPE_ICONS = { video: Video, image: ImageIcon, audio: Music };

export function MediaView() {
    const { items, isImporting, importErrors, addFiles, removeItem } = useMediaStore();
    const projectKey = useProjectStore((s) => s.projectKey);
    const notify = useUiStore((s) => s.notify);
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');
    const [dragOver, setDragOver] = useState(false);

    const importFiles = async (files: File[]) => {
        if (!projectKey || !files.length) return;
        const added = await addFiles(files, projectKey);
        // First import into an empty project goes straight onto the main track.
        const timeline = useTimelineStore.getState();
        if (added.length && timeline.getTotalDuration() === 0) {
            let cursor = 0;
            for (const item of added.filter((i) => i.type !== 'audio')) {
                timeline.addMediaAtTime(item, cursor);
                cursor += item.type === 'image' ? 5 : item.duration;
            }
        }
    };

    const addToTimeline = (item: MediaItem) => {
        const ok = useTimelineStore.getState().addMediaAtTime(item, usePlaybackStore.getState().currentTime);
        if (!ok) notify(`Could not place ${item.name}.`, 'error');
    };

    const remove = (item: MediaItem) => {
        const used = useTimelineStore.getState().tracks.some((t) => t.elements.some((e) => e.type === 'media' && e.mediaId === item.id));
        if (used && !window.confirm(`"${item.name}" is used on the timeline. Remove it and its clips?`)) return;
        if (used) useTimelineStore.getState().removeElementsForMedia(item.id);
        if (projectKey) removeItem(item.id, projectKey);
    };

    const filtered = items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()));

    return (
        <div
            className={`ke-view ${dragOver ? 'is-dragover' : ''}`}
            onDragOver={(e) => {
                if (e.dataTransfer.types.includes('Files')) {
                    e.preventDefault();
                    setDragOver(true);
                }
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                importFiles(Array.from(e.dataTransfer.files || []));
            }}
        >
            <div className="ke-view__head">
                <h3>Media</h3>
                <button className="ke-btn ke-btn--primary ke-btn--sm" onClick={() => inputRef.current?.click()} disabled={isImporting}>
                    {isImporting ? <Loader2 size={14} className="ke-spin" /> : <Plus size={14} />} Import
                </button>
                <input
                    ref={inputRef}
                    type="file"
                    hidden
                    multiple
                    accept="video/*,image/*,audio/*"
                    onChange={(e) => {
                        importFiles(Array.from(e.target.files || []));
                        e.target.value = '';
                    }}
                />
            </div>

            {items.length > 0 ? (
                <label className="ke-search">
                    <Search size={14} />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search media" />
                </label>
            ) : null}

            {importErrors.length ? (
                <div className="ke-alert ke-alert--error">
                    {importErrors.map((err) => (
                        <p key={err}>{err}</p>
                    ))}
                </div>
            ) : null}

            {items.length === 0 ? (
                <button className="ke-dropzone" onClick={() => inputRef.current?.click()}>
                    <CloudUpload size={26} />
                    <strong>Drop videos, images or audio</strong>
                    <span>or click to browse. Files stay in your browser until you export.</span>
                </button>
            ) : (
                <div className="ke-media-grid">
                    {filtered.map((item) => {
                        const Icon = TYPE_ICONS[item.type];
                        return (
                            <div
                                key={item.id}
                                className="ke-media-card"
                                draggable
                                onDragStart={(e) => {
                                    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: 'media', mediaId: item.id }));
                                    e.dataTransfer.effectAllowed = 'copy';
                                }}
                                onDoubleClick={() => addToTimeline(item)}
                                title={`${item.name} — drag to the timeline or double-click to add at the playhead`}
                            >
                                <div className="ke-media-card__thumb">
                                    {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" draggable={false} /> : <Icon size={22} />}
                                    {item.type !== 'image' ? <span className="ke-media-card__dur">{formatShort(item.duration)}</span> : null}
                                    {item.uploadStatus === 'uploading' ? <Loader2 size={14} className="ke-spin ke-media-card__status" /> : null}
                                    <div className="ke-media-card__actions">
                                        <button className="ke-icon-btn ke-icon-btn--xs" title="Add at playhead" onClick={() => addToTimeline(item)}>
                                            <Plus size={12} />
                                        </button>
                                        <button className="ke-icon-btn ke-icon-btn--xs" title="Remove from project" onClick={() => remove(item)}>
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                </div>
                                <span className="ke-media-card__name">
                                    <Icon size={11} /> {item.name}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
