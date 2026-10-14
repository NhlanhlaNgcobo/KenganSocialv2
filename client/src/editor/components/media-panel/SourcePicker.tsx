import { useEffect } from 'react';
import { useAiStore } from '../../stores/ai-store';
import { useMediaStore } from '../../stores/media-store';
import { useTimelineStore } from '../../stores/timeline-store';

/** Picks which imported video/audio the AI tools analyse. Defaults to the first clip on the main track. */
export function SourcePicker() {
    const items = useMediaStore((s) => s.items).filter((i) => i.type !== 'image');
    const sourceMediaId = useAiStore((s) => s.sourceMediaId);
    const setSource = useAiStore((s) => s.setSource);

    useEffect(() => {
        if (sourceMediaId && items.some((i) => i.id === sourceMediaId)) return;
        const main = useTimelineStore.getState().tracks.find((t) => t.isMain);
        const first = main?.elements.find((e) => e.type === 'media');
        const fallback = first && first.type === 'media' ? first.mediaId : items[0]?.id;
        setSource(fallback ?? null);
    }, [items, sourceMediaId, setSource]);

    if (!items.length) return <p className="ke-note">Import a video in the Media tab first.</p>;

    return (
        <label className="ke-field">
            <span>Source</span>
            <select className="ke-select" value={sourceMediaId ?? ''} onChange={(e) => setSource(e.target.value)}>
                {items.map((i) => (
                    <option key={i.id} value={i.id}>
                        {i.name}
                    </option>
                ))}
            </select>
        </label>
    );
}
