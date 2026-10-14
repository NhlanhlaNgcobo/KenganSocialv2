import { Copy, Magnet, Minus, Plus, Redo2, Scissors, Trash2, Type, Undo2, WrapText } from 'lucide-react';
import { TIMELINE } from '../../constants';
import { usePlaybackStore } from '../../stores/playback-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';

export function TimelineToolbar() {
    const {
        selected,
        snappingEnabled,
        rippleEnabled,
        toggleSnapping,
        toggleRipple,
        splitAtPlayhead,
        duplicateSelected,
        removeSelected,
        undo,
        redo,
        history,
        future,
        addTextAtTime,
    } = useTimelineStore();
    const zoom = useUiStore((s) => s.zoom);
    const setZoom = useUiStore((s) => s.setZoom);
    const notify = useUiStore((s) => s.notify);

    const split = () => {
        const count = splitAtPlayhead(usePlaybackStore.getState().currentTime);
        if (!count) notify('Move the playhead over a clip to split it.');
    };

    const zoomBy = (factor: number) => setZoom(Math.min(TIMELINE.MAX_ZOOM, Math.max(TIMELINE.MIN_ZOOM, zoom * factor)));

    return (
        <div className="ke-timeline__toolbar">
            <div className="ke-toolbar-group">
                <button className="ke-icon-btn" title="Undo (Ctrl+Z)" onClick={undo} disabled={!history.length}>
                    <Undo2 size={15} />
                </button>
                <button className="ke-icon-btn" title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!future.length}>
                    <Redo2 size={15} />
                </button>
                <span className="ke-divider" />
                <button className="ke-icon-btn" title="Split at playhead (S)" onClick={split}>
                    <Scissors size={15} />
                </button>
                <button className="ke-icon-btn" title="Duplicate (Ctrl+D)" onClick={duplicateSelected} disabled={!selected.length}>
                    <Copy size={15} />
                </button>
                <button className="ke-icon-btn" title="Delete (Del)" onClick={removeSelected} disabled={!selected.length}>
                    <Trash2 size={15} />
                </button>
                <span className="ke-divider" />
                <button
                    className="ke-icon-btn"
                    title="Add text at playhead (T)"
                    onClick={() => addTextAtTime(usePlaybackStore.getState().currentTime)}
                >
                    <Type size={15} />
                </button>
            </div>
            <div className="ke-toolbar-group">
                <button className={`ke-icon-btn ${snappingEnabled ? 'is-active' : ''}`} title="Snapping (N)" onClick={toggleSnapping}>
                    <Magnet size={15} />
                </button>
                <button className={`ke-icon-btn ${rippleEnabled ? 'is-active' : ''}`} title="Ripple delete" onClick={toggleRipple}>
                    <WrapText size={15} />
                </button>
                <span className="ke-divider" />
                <button className="ke-icon-btn" title="Zoom out (-)" onClick={() => zoomBy(1 / 1.4)}>
                    <Minus size={15} />
                </button>
                <input
                    className="ke-zoom-slider"
                    type="range"
                    min={Math.log(TIMELINE.MIN_ZOOM)}
                    max={Math.log(TIMELINE.MAX_ZOOM)}
                    step={0.01}
                    value={Math.log(zoom)}
                    onChange={(e) => setZoom(Math.exp(Number(e.target.value)))}
                    aria-label="Timeline zoom"
                />
                <button className="ke-icon-btn" title="Zoom in (+)" onClick={() => zoomBy(1.4)}>
                    <Plus size={15} />
                </button>
            </div>
        </div>
    );
}
