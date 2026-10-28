import { useState } from 'react';
import { ArrowRight, Flame, Loader2, Save, Wand2 } from 'lucide-react';
import { useAiEditStore } from '../../stores/ai-edit-store';
import { useAuth } from '../../../context/AuthContext';
import { CAPTION_STYLES } from '../../constants';
import { applyKeepSegments, type AutoEditOptions } from '../../lib/ai';
import { formatShort } from '../../lib/time';
import { useAiStore } from '../../stores/ai-store';
import { useProjectStore } from '../../stores/project-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';
import type { AspectRatio, VideoFilter } from '../../types';
import { SourcePicker } from './SourcePicker';
import { confirmDialog } from '../../../lib/dialogs';

interface StylePreset {
    id: string;
    name: string;
    ratio: AspectRatio;
    filter: VideoFilter;
    captionStyle: keyof typeof CAPTION_STYLES;
    autoEdit: Partial<AutoEditOptions>;
}

const BUILT_IN: StylePreset[] = [
    {
        id: 'trendy-tiktok',
        name: 'Trendy TikTok',
        ratio: '9:16',
        filter: 'vivid',
        captionStyle: 'bold',
        autoEdit: { goal: 'high-retention', aggressiveness: 'balanced', removeSilence: true, preserveHookSeconds: 3, minClipLength: 6, maxClipLength: 18 },
    },
    {
        id: 'cinematic-reel',
        name: 'Cinematic Reel',
        ratio: '9:16',
        filter: 'drama',
        captionStyle: 'minimal',
        autoEdit: { goal: 'story-first', aggressiveness: 'light', removeSilence: false, preserveHookSeconds: 5, minClipLength: 8, maxClipLength: 22 },
    },
    {
        id: 'youtube-explainer',
        name: 'YouTube Explainer',
        ratio: '16:9',
        filter: 'none',
        captionStyle: 'minimal',
        autoEdit: { goal: 'story-first', aggressiveness: 'light', removeSilence: true, preserveHookSeconds: 5, minClipLength: 10, maxClipLength: 30 },
    },
];

const STORAGE_KEY = 'kengan-editor-style-presets';

function loadCustomPresets(): StylePreset[] {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
        return [];
    }
}

function RangeRow({ label, value, min, max, step = 1, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void }) {
    return (
        <label className="ke-range">
            <span>{label}</span>
            <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
            <strong>
                {step < 1 ? value.toFixed(2) : value}
                {suffix}
            </strong>
        </label>
    );
}

export function AiView() {
    const { plan } = useAuth();
    const { status, mode, stage, progress, error, options, setOptions, run, cancel, viralClips, sourceMediaId, setCaptionStyle } = useAiStore();
    const notify = useUiStore((s) => s.notify);
    const [custom, setCustom] = useState<StylePreset[]>(loadCustomPresets);
    const [presetName, setPresetName] = useState('');

    const canTranscribe = plan !== 'starter';
    const canFindViral = plan === 'creator' || plan === 'agency';
    const running = status === 'running' && mode !== 'subtitles';

    const start = async (m: 'viral' | 'auto-edit') => {
        if (m === 'auto-edit' && !(await confirmDialog('Auto-edit replaces the clips on your main track with the best moments. You can undo it.', { confirmLabel: 'Auto-edit' }))) return;
        try {
            notify(await run(m), 'success');
        } catch (e) {
            if ((e as Error).message !== 'Cancelled') notify((e as Error).message, 'error');
        }
    };

    const applyPreset = (preset: StylePreset) => {
        useProjectStore.getState().setRatio(preset.ratio);
        setOptions(preset.autoEdit);
        setCaptionStyle(preset.captionStyle);
        const timeline = useTimelineStore.getState();
        const main = timeline.tracks.find((t) => t.isMain);
        if (main?.elements.length) {
            timeline.pushHistory();
            for (const el of main.elements) timeline.updateElement(main.id, el.id, { filter: preset.filter }, false);
        }
        notify(`Applied “${preset.name}”.`, 'success');
    };

    const savePreset = () => {
        const name = presetName.trim();
        if (!name) return;
        const main = useTimelineStore.getState().tracks.find((t) => t.isMain);
        const firstClip = main?.elements.find((e) => e.type === 'media');
        const preset: StylePreset = {
            id: `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            name,
            ratio: useProjectStore.getState().ratio,
            filter: firstClip && firstClip.type === 'media' ? firstClip.filter : 'none',
            captionStyle: useAiStore.getState().captionStyle,
            autoEdit: options,
        };
        const next = [...custom.filter((p) => p.id !== preset.id), preset];
        setCustom(next);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
            /* storage unavailable */
        }
        setPresetName('');
        notify(`Saved “${name}”.`, 'success');
    };

    return (
        <div className="ke-view">
            <div className="ke-view__head">
                <h3>AI tools</h3>
            </div>
            <button className="aie-launch" onClick={() => useAiEditStore.getState().openStudio()}>
                <span className="aie-launch__icon">
                    <Wand2 size={16} />
                </span>
                <span>
                    <strong>AI Edit in a style</strong>
                    <small>Paste a TikTok or YouTube video you like; we edit your footage the same way.</small>
                </span>
                <ArrowRight size={15} />
            </button>
            <SourcePicker />

            {running ? (
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
                <div className="ke-stack">
                    <button className="ke-btn ke-btn--primary ke-btn--block" onClick={() => start('auto-edit')} disabled={!canTranscribe || !sourceMediaId || status === 'running'}>
                        <Wand2 size={15} /> Auto-edit best moments
                    </button>
                    <button className="ke-btn ke-btn--block" onClick={() => start('viral')} disabled={!canFindViral || !sourceMediaId || status === 'running'}>
                        <Flame size={15} /> Find viral moments
                    </button>
                </div>
            )}
            {!canTranscribe ? <p className="ke-note">AI editing needs the Nano plan or higher.</p> : !canFindViral ? <p className="ke-note">Viral moment finder needs the Creator plan.</p> : null}
            {error && mode !== 'subtitles' ? <div className="ke-alert ke-alert--error">{error}</div> : null}

            {viralClips.length > 0 && sourceMediaId ? (
                <section className="ke-section">
                    <h4>Suggested moments</h4>
                    <div className="ke-list">
                        {viralClips.slice(0, 8).map((clip, i) => (
                            <button key={`${clip.startSec}-${i}`} className="ke-list__item" onClick={() => applyKeepSegments(sourceMediaId, [clip])} title="Use only this moment on the main track">
                                <div>
                                    <strong>
                                        {formatShort(clip.startSec)} – {formatShort(clip.endSec)}
                                    </strong>
                                    <p>{clip.reason}</p>
                                </div>
                                <span className="ke-score">
                                    <Flame size={12} /> {Math.round(clip.score)}
                                </span>
                            </button>
                        ))}
                    </div>
                    <button className="ke-btn ke-btn--sm" onClick={() => applyKeepSegments(sourceMediaId, viralClips)}>
                        Use all moments
                    </button>
                </section>
            ) : null}

            <section className="ke-section">
                <h4>Auto-edit strategy</h4>
                <div className="ke-grid-2">
                    <select className="ke-select" value={options.goal} onChange={(e) => setOptions({ goal: e.target.value as AutoEditOptions['goal'] })}>
                        <option value="high-retention">High retention</option>
                        <option value="story-first">Story first</option>
                        <option value="sales-focused">Sales focused</option>
                    </select>
                    <select className="ke-select" value={options.aggressiveness} onChange={(e) => setOptions({ aggressiveness: e.target.value as AutoEditOptions['aggressiveness'] })}>
                        <option value="light">Light cuts</option>
                        <option value="balanced">Balanced</option>
                        <option value="aggressive">Aggressive</option>
                    </select>
                </div>
                <RangeRow label="Hook protection" value={options.preserveHookSeconds} min={1} max={8} suffix="s" onChange={(v) => setOptions({ preserveHookSeconds: v })} />
                <RangeRow label="Min clip" value={options.minClipLength} min={3} max={12} suffix="s" onChange={(v) => setOptions({ minClipLength: v })} />
                <RangeRow label="Max clip" value={options.maxClipLength} min={8} max={30} suffix="s" onChange={(v) => setOptions({ maxClipLength: v })} />
                <RangeRow label="Hook boost" value={options.hookBoost} min={0} max={0.6} step={0.05} onChange={(v) => setOptions({ hookBoost: v })} />
                <RangeRow label="Speech weight" value={options.speechDensityWeight} min={0.1} max={0.7} step={0.05} onChange={(v) => setOptions({ speechDensityWeight: v })} />
                <RangeRow label="Scene weight" value={options.sceneChangeWeight} min={0.1} max={0.7} step={0.05} onChange={(v) => setOptions({ sceneChangeWeight: v })} />
                <label className="ke-check">
                    <input type="checkbox" checked={options.removeBlackFrames} onChange={(e) => setOptions({ removeBlackFrames: e.target.checked })} /> Remove black frames
                </label>
                <label className="ke-check">
                    <input type="checkbox" checked={options.removeSilence} onChange={(e) => setOptions({ removeSilence: e.target.checked })} /> Trim silences
                </label>
            </section>

            <section className="ke-section">
                <h4>Style presets</h4>
                <div className="ke-list">
                    {[...BUILT_IN, ...custom].map((preset) => (
                        <button key={preset.id} className="ke-list__item" onClick={() => applyPreset(preset)}>
                            <div>
                                <strong>{preset.name}</strong>
                                <p>
                                    {preset.ratio} · {preset.filter} filter · {preset.captionStyle} captions
                                </p>
                            </div>
                        </button>
                    ))}
                </div>
                <form
                    className="ke-search"
                    onSubmit={(e) => {
                        e.preventDefault();
                        savePreset();
                    }}
                >
                    <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Save current look as…" />
                    <button className="ke-btn ke-btn--sm" type="submit" disabled={!presetName.trim()}>
                        <Save size={13} />
                    </button>
                </form>
            </section>
        </div>
    );
}
