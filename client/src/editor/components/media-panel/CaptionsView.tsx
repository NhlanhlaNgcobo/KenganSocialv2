import { useState } from 'react';
import { PresetSearch, matchesPreset } from './PresetSearch';
import { CaptionSample } from './CaptionSample';
import { Loader2, Sparkles } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { CAPTION_STYLES } from '../../constants';
import { CAPTION_TEMPLATES, captionLook, captionText } from '../../lib/caption-templates';
import { getCanvasSize, useProjectStore } from '../../stores/project-store';
import { useAiStore } from '../../stores/ai-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';
import type { TextElement } from '../../types';
import { SourcePicker } from './SourcePicker';
import { usePlaybackStore } from '../../stores/playback-store';

export function CaptionsView() {
    const { plan } = useAuth();
    const [query, setQuery] = useState('');
    const [collection, setCollection] = useState('all');
    const [hover, setHover] = useState<string | null>(null);
    const visible = CAPTION_TEMPLATES.filter((t) => matchesPreset(t.id, `${t.name} ${t.description || ''}`, query, collection));
    const { status, mode, stage, progress, error, captionStyle, setCaptionStyle, run, cancel, sourceMediaId } = useAiStore();
    const tracks = useTimelineStore((s) => s.tracks);
    const notify = useUiStore((s) => s.notify);
    const canTranscribe = plan !== 'starter';
    const busy = status === 'running' && mode === 'subtitles';

    const captionTrack = tracks.find((t) => t.type === 'text' && t.elements.some((e) => e.type === 'text' && e.isCaption));

    const restyle = (style: keyof typeof CAPTION_STYLES) => {
        setCaptionStyle(style);
        if (!captionTrack) return;
        const store = useTimelineStore.getState();
        const height = getCanvasSize(useProjectStore.getState().ratio).height;
        store.pushHistory();
        captionTrack.elements.forEach((el, i) => {
            if (el.type !== 'text' || !el.isCaption) return;
            const raw = el.rawContent ?? el.content;
            store.updateElement(captionTrack.id, el.id, { ...captionLook(style, i, raw, height), content: captionText(style, raw), rawContent: raw } as Partial<TextElement>, false);
        });
    };

    const generate = async () => {
        try {
            notify(await run('subtitles'), 'success');
        } catch (e) {
            if ((e as Error).message !== 'Cancelled') notify((e as Error).message, 'error');
        }
    };

    return (
        <div className="ke-view">
            <div className="ke-view__head">
                <h3>Captions</h3>
            </div>
            <SourcePicker />

            <PresetSearch query={query} onQuery={setQuery} collection={collection} onCollection={setCollection} count={visible.length} />
            <div className="ke-field">
                <span>Caption template{captionTrack ? ' (click to restyle your captions)' : ''}</span>
                <div className="ke-cap-grid">
                    {visible.map((t) => (
                        <button key={t.id} className={`ke-cap-card ${captionStyle === t.id ? 'is-active' : ''}`}
                            onClick={() => restyle(t.id as keyof typeof CAPTION_STYLES)} title={t.description || t.name}
                            onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover(null)}
                            onFocus={() => setHover(t.id)} onBlur={() => setHover(null)} aria-pressed={captionStyle === t.id}>
                            <CaptionSample template={t} active={hover === t.id} />
                            <small>{t.name}</small>
                        </button>
                    ))}
                </div>
            </div>

            <button className="ke-btn ke-btn--block" onClick={() => {
                const height = getCanvasSize(useProjectStore.getState().ratio).height;
                const content = 'Your words here';
                useTimelineStore.getState().addTextAtTime(usePlaybackStore.getState().currentTime, {
                    ...captionLook(captionStyle, 0, content, height), content: captionText(captionStyle, content), rawContent: content,
                    name: 'Caption', duration: 2, isCaption: true,
                });
                notify('Caption added. Select it to edit the words and timing in Properties.', 'success');
            }}>Add a caption manually</button>
            {busy ? (
                <div className="ke-progress-card">
                    <div className="ke-progress-card__row">
                        <Loader2 size={14} className="ke-spin" />
                        <span>{stage || 'working'}…</span>
                        <button className="ke-btn ke-btn--ghost ke-btn--sm" onClick={cancel}>
                            Cancel
                        </button>
                    </div>
                    <div className="ke-bar">
                        <div style={{ width: `${progress}%` }} />
                    </div>
                </div>
            ) : (
                <button className="ke-btn ke-btn--primary ke-btn--block" onClick={generate} disabled={!canTranscribe || !sourceMediaId || status === 'running'}>
                    <Sparkles size={15} /> {captionTrack ? 'Regenerate captions' : 'Generate captions'}
                </button>
            )}

            {!canTranscribe ? <p className="ke-note">Auto captions need the Nano plan or higher.</p> : null}
            {error && mode === 'subtitles' ? <div className="ke-alert ke-alert--error">{error}</div> : null}
            {captionTrack ? (
                <p className="ke-note">
                    {captionTrack.elements.length} captions on the timeline. Select one to edit its text, or drag it to retime. Edited wording uses even word timing until captions are regenerated.
                </p>
            ) : null}
        </div>
    );
}
