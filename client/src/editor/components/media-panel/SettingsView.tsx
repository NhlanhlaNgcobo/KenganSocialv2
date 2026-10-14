import { FilePlus2 } from 'lucide-react';
import { CANVAS_SIZES } from '../../constants';
import { useProjectStore } from '../../stores/project-store';
import type { AspectRatio } from '../../types';

const RATIOS: { value: AspectRatio; label: string }[] = [
    { value: '9:16', label: 'Vertical 9:16 — TikTok, Reels, Shorts' },
    { value: '1:1', label: 'Square 1:1 — Instagram feed' },
    { value: '16:9', label: 'Landscape 16:9 — YouTube' },
];

const BACKGROUNDS = ['#000000', '#ffffff', '#111827', '#8b5cf6', '#0ea5e9', '#f97316'];

export function SettingsView() {
    const { name, setName, ratio, setRatio, backgroundColor, setBackgroundColor, fps, newProject } = useProjectStore();
    const size = CANVAS_SIZES[ratio];

    return (
        <div className="ke-view">
            <div className="ke-view__head">
                <h3>Project settings</h3>
            </div>

            <label className="ke-field">
                <span>Project name</span>
                <input className="ke-input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>

            <div className="ke-field">
                <span>Canvas</span>
                <div className="ke-radio-list">
                    {RATIOS.map((r) => (
                        <label key={r.value} className={`ke-radio ${ratio === r.value ? 'is-active' : ''}`}>
                            <input type="radio" name="ratio" checked={ratio === r.value} onChange={() => setRatio(r.value)} />
                            {r.label}
                        </label>
                    ))}
                </div>
                <small className="ke-muted">
                    Exports at {size.width}×{size.height}, {fps} fps.
                </small>
            </div>

            <div className="ke-field">
                <span>Background</span>
                <div className="ke-swatches">
                    {BACKGROUNDS.map((c) => (
                        <button
                            key={c}
                            className={`ke-swatch ${backgroundColor === c ? 'is-active' : ''}`}
                            style={{ background: c }}
                            onClick={() => setBackgroundColor(c)}
                            aria-label={`Background ${c}`}
                        />
                    ))}
                    <input type="color" value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} aria-label="Custom background" />
                </div>
                <small className="ke-muted">Shown wherever no clip covers the canvas, and in timeline gaps.</small>
            </div>

            <button
                className="ke-btn ke-btn--block ke-btn--danger"
                onClick={() => {
                    if (window.confirm('Start a new project? This clears the current timeline and media from this browser.')) newProject();
                }}
            >
                <FilePlus2 size={15} /> New project
            </button>
        </div>
    );
}
