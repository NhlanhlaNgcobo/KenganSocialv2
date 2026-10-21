/**
 * Exact preview: renders a few seconds around the playhead with the export engine (same server
 * pipeline as Export) and plays it over the live preview, so what you check is what you'll get.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, ScanEye, X } from 'lucide-react';
import { exportTimeline } from '../../lib/export';
import { usePlaybackStore } from '../../stores/playback-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';

const BEFORE = 0.5;
const AFTER = 2.5;

export function ExactPreviewButton({ onResult }: { onResult: (r: { url: string; start: number; end: number } | null) => void }) {
    const [busy, setBusy] = useState<number | null>(null);
    const controller = useRef<AbortController | null>(null);
    const notify = useUiStore((s) => s.notify);
    useEffect(() => () => controller.current?.abort(), []);

    const run = async () => {
        if (controller.current) {
            controller.current.abort();
            return;
        }
        const total = useTimelineStore.getState().getTotalDuration();
        const t = usePlaybackStore.getState().currentTime;
        const start = Math.max(0, Math.min(t - BEFORE, total - BEFORE - AFTER));
        const end = Math.min(total, start + BEFORE + AFTER);
        if (end - start < 0.2) return notify('Add something to the timeline first.', 'error');
        usePlaybackStore.getState().pause();
        controller.current = new AbortController();
        setBusy(0);
        try {
            const blob = await exportTimeline((p) => setBusy(p.stage === 'rendering' ? p.progress : 0), controller.current.signal, { start, end });
            onResult({ url: URL.createObjectURL(blob), start, end });
        } catch (error) {
            if (!controller.current?.signal.aborted) notify(`Exact preview failed: ${(error as Error).message}`, 'error');
        } finally {
            controller.current = null;
            setBusy(null);
        }
    };

    return (
        <button className={`ke-chip ${busy !== null ? 'is-active' : ''}`} onClick={run} title="Render 3 seconds around the playhead with the export engine (click again to cancel)">
            {busy !== null ? <Loader2 size={12} className="ke-spin" /> : <ScanEye size={12} />} {busy !== null ? `Rendering ${busy}%` : 'Exact preview'}
        </button>
    );
}

/** The blob URL is released by the owner when the preview is closed or replaced (see PreviewPanel). */
export function ExactPreviewOverlay({ result, onClose }: { result: { url: string; start: number; end: number }; onClose: () => void }) {
    return (
        <div className="ke-exact">
            <video className="ke-exact__video" src={result.url} autoPlay loop controls playsInline />
            <div className="ke-exact__bar">
                <span>
                    Export engine · {result.start.toFixed(1)}s–{result.end.toFixed(1)}s
                </span>
                <button className="ke-icon-btn" title="Close exact preview" onClick={onClose}>
                    <X size={14} />
                </button>
            </div>
        </div>
    );
}
