import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Download, ImagePlus, Keyboard, Loader2, Maximize2, Wand2 } from 'lucide-react';
import { enterLandscape } from './phone/PhoneLayout';
import ThumbnailStudio from '../../components/thumbnails/ThumbnailStudio';
import { useAiEditStore } from '../stores/ai-edit-store';
import { useMediaStore } from '../stores/media-store';
import { usePlaybackStore } from '../stores/playback-store';
import { useTimelineStore } from '../stores/timeline-store';
import { useProjectStore } from '../stores/project-store';
import { useUiStore } from '../stores/ui-store';
import { SHORTCUTS } from '../hooks/use-editor-shortcuts';

/** `compact`: phone landscape. Icon-only actions, no shortcuts list, and a full-screen button. */
export function EditorHeader({ compact = false }: { compact?: boolean }) {
    const { name, setName, lastSavedAt } = useProjectStore();
    const setExportOpen = useUiStore((s) => s.setExportOpen);
    const openAiEdit = useAiEditStore((s) => s.openStudio);
    const aiEditBusy = useAiEditStore((s) => s.edit.running || s.analysis.running);
    const [showKeys, setShowKeys] = useState(false);
    const ratio = useProjectStore((s) => s.ratio);
    const notify = useUiStore((s) => s.notify);
    const [thumb, setThumb] = useState<{ uploadId: string; start: number; end: number } | null>(null);
    const [thumbBusy, setThumbBusy] = useState(false);

    /** Thumbnail from the video under the playhead (or the first video), uploaded first if needed. */
    const openThumbnail = async () => {
        const media = useMediaStore.getState().items;
        const t = usePlaybackStore.getState().currentTime;
        const videos = useTimelineStore
            .getState()
            .tracks.flatMap((track) => track.elements)
            .filter((el: any) => el.type === 'media' && media.find((m) => m.id === el.mediaId)?.type === 'video') as any[];
        const visible = (el: any) => (el.duration - el.trimStart - el.trimEnd) / (el.speed || 1);
        const el = videos.find((e) => t >= e.startTime && t < e.startTime + visible(e)) || videos[0];
        if (!el) return notify('Add a video to the timeline first.', 'error');
        setThumbBusy(true);
        try {
            const ids = await useMediaStore.getState().ensureUploaded([el.mediaId]);
            setThumb({ uploadId: ids[el.mediaId], start: el.trimStart, end: el.duration - el.trimEnd });
        } catch (error) {
            notify(`The video could not be prepared: ${(error as Error).message}`, 'error');
        } finally {
            setThumbBusy(false);
        }
    };

    return (
        <header className={`ke-header ${compact ? 'is-compact' : ''}`}>
            <div className="ke-header__left">
                <Link to="/dashboard" className="ke-icon-btn" title="Back to dashboard" aria-label="Back to dashboard">
                    <ChevronLeft size={18} />
                </Link>
                <input className="ke-header__name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" />
                <span className="ke-muted ke-header__saved">
                    {lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Not saved yet'}
                </span>
            </div>
            <div className="ke-header__right">
                {compact && document.fullscreenEnabled ? (
                    <button className="ke-icon-btn" onClick={enterLandscape} title="Full screen" aria-label="Full screen">
                        <Maximize2 size={17} />
                    </button>
                ) : null}
                {compact ? null : (
                    <div className="ke-popover-anchor">
                        <button className="ke-icon-btn" title="Keyboard shortcuts" onClick={() => setShowKeys((v) => !v)}>
                            <Keyboard size={17} />
                        </button>
                        {showKeys ? (
                            <div className="ke-popover" onMouseLeave={() => setShowKeys(false)}>
                                <h4>Shortcuts</h4>
                                {SHORTCUTS.map(([keys, label]) => (
                                    <div key={keys} className="ke-shortcut">
                                        <span>{label}</span>
                                        <kbd>{keys}</kbd>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                )}
                <button className="ke-btn" onClick={openThumbnail} disabled={thumbBusy} title="Make a TikTok cover or YouTube thumbnail from your video" aria-label="Thumbnail">
                    {thumbBusy ? <Loader2 size={15} className="ke-spin" /> : <ImagePlus size={15} />}
                    <span className="ke-btn__label">Thumbnail</span>
                </button>
                <button className={`ke-btn ke-btn--ai ${aiEditBusy ? 'is-busy' : ''}`} onClick={openAiEdit} title="Edit your footage in the style of a reference video" aria-label={aiEditBusy ? 'AI edit, working' : 'AI edit'}>
                    <Wand2 size={15} />
                    <span className="ke-btn__label">AI edit{aiEditBusy ? '…' : ''}</span>
                </button>
                <button className="ke-btn ke-btn--primary" onClick={() => setExportOpen(true)}>
                    <Download size={15} /> Export
                </button>
            </div>
            {thumb ? (
                <ThumbnailStudio
                    uploadId={thumb.uploadId}
                    start={thumb.start}
                    end={thumb.end}
                    title={name}
                    defaultFormat={ratio === '16:9' ? 'youtube' : 'tiktok'}
                    onClose={() => setThumb(null)}
                />
            ) : null}
        </header>
    );
}
