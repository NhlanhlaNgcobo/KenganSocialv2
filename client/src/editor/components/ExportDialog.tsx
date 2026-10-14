import { useRef, useState } from 'react';
import { CheckCircle2, Download, Loader2, X } from 'lucide-react';
import { CANVAS_SIZES } from '../constants';
import { exportTimeline, saveBlob, type ExportProgress } from '../lib/export';
import { formatTimecode } from '../lib/time';
import { useProjectStore } from '../stores/project-store';
import { useTimelineStore } from '../stores/timeline-store';
import { useUiStore } from '../stores/ui-store';

export function ExportDialog() {
    const open = useUiStore((s) => s.exportOpen);
    const setOpen = useUiStore((s) => s.setExportOpen);
    const { name, ratio, fps } = useProjectStore();
    const duration = useTimelineStore((s) => s.getTotalDuration());
    const [progress, setProgress] = useState<ExportProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<Blob | null>(null);
    const controller = useRef<AbortController | null>(null);

    if (!open) return null;

    const fileName = `${name.replace(/[^\w\- ]+/g, '').trim() || 'kengan-export'}.mp4`;
    const busy = !!progress && progress.stage !== 'done' && !error;

    const start = async () => {
        setError(null);
        setResult(null);
        controller.current = new AbortController();
        try {
            const blob = await exportTimeline(setProgress, controller.current.signal);
            setResult(blob);
            saveBlob(blob, fileName);
        } catch (e) {
            setError((e as Error).message);
            setProgress(null);
        }
    };

    const close = () => {
        controller.current?.abort();
        setProgress(null);
        setError(null);
        setResult(null);
        setOpen(false);
    };

    const size = CANVAS_SIZES[ratio];

    return (
        <div className="ke-modal" role="dialog" aria-modal="true" aria-label="Export video" onPointerDown={(e) => e.target === e.currentTarget && !busy && close()}>
            <div className="ke-modal__card">
                <div className="ke-modal__head">
                    <h3>Export video</h3>
                    <button className="ke-icon-btn" onClick={close} title={busy ? 'Cancel export' : 'Close'}>
                        <X size={16} />
                    </button>
                </div>

                <dl className="ke-summary">
                    <div>
                        <dt>File</dt>
                        <dd>{fileName}</dd>
                    </div>
                    <div>
                        <dt>Resolution</dt>
                        <dd>
                            {size.width}×{size.height} ({ratio})
                        </dd>
                    </div>
                    <div>
                        <dt>Length</dt>
                        <dd className="ke-mono">{formatTimecode(duration, fps)}</dd>
                    </div>
                    <div>
                        <dt>Format</dt>
                        <dd>MP4 · H.264 · AAC</dd>
                    </div>
                </dl>

                {progress ? (
                    <div className="ke-progress-card">
                        <div className="ke-progress-card__row">
                            {progress.stage === 'done' ? <CheckCircle2 size={15} className="ke-ok" /> : <Loader2 size={15} className="ke-spin" />}
                            <span>{progress.message}</span>
                            <span className="ke-mono">{progress.progress}%</span>
                        </div>
                        <div className="ke-bar">
                            <div style={{ width: `${progress.progress}%` }} />
                        </div>
                    </div>
                ) : null}

                {error ? <div className="ke-alert ke-alert--error">{error}</div> : null}

                <div className="ke-modal__foot">
                    {result ? (
                        <button className="ke-btn" onClick={() => saveBlob(result, fileName)}>
                            <Download size={15} /> Download again
                        </button>
                    ) : null}
                    <button className="ke-btn ke-btn--primary" onClick={start} disabled={busy || duration <= 0}>
                        {busy ? <Loader2 size={15} className="ke-spin" /> : <Download size={15} />} {busy ? 'Exporting…' : result ? 'Export again' : 'Export'}
                    </button>
                </div>
                <p className="ke-note">Rendering runs on the Kengan server. Your media is uploaded only when you export.</p>
            </div>
        </div>
    );
}
