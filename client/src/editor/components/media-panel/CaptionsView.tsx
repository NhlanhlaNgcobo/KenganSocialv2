import { Loader2, Sparkles } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { CAPTION_STYLES } from '../../constants';
import { useAiStore } from '../../stores/ai-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';
import type { TextElement } from '../../types';
import { SourcePicker } from './SourcePicker';

export function CaptionsView() {
    const { plan } = useAuth();
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
        store.pushHistory();
        for (const el of captionTrack.elements) {
            store.updateElement(captionTrack.id, el.id, CAPTION_STYLES[style] as Partial<TextElement>, false);
        }
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

            <div className="ke-field">
                <span>Style</span>
                <div className="ke-chip-row">
                    {Object.keys(CAPTION_STYLES).map((style) => (
                        <button key={style} className={`ke-chip ${captionStyle === style ? 'is-active' : ''}`} onClick={() => restyle(style as keyof typeof CAPTION_STYLES)}>
                            {style}
                        </button>
                    ))}
                </div>
            </div>

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
                    {captionTrack.elements.length} captions on the timeline. Select one to edit its text, or drag it to retime.
                </p>
            ) : null}
        </div>
    );
}
