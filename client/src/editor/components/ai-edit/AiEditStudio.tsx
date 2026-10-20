import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Loader2, PencilLine, Sparkles, Upload, Wand2, X } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { formatDuration, type EditOptions } from '../../lib/ai-edit';
import { useAiEditStore } from '../../stores/ai-edit-store';
import { useMediaStore } from '../../stores/media-store';
import { useProjectStore } from '../../stores/project-store';
import { useUiStore } from '../../stores/ui-store';
import { CaptionSample, StyleFacts, StylePanel } from './StylePanel';
import './ai-edit.css';

const TOGGLES: { key: keyof EditOptions; label: string; hint: string }[] = [
    { key: 'removeSilence', label: 'Cut pauses', hint: 'Jump cuts at the style’s pace' },
    { key: 'removeFillers', label: 'Remove filler words', hint: 'um, uh, erm' },
    { key: 'captions', label: 'Captions', hint: 'In the style’s font, colours and position' },
    { key: 'hook', label: 'Hook', hint: 'Opening title, and a cold open for long videos' },
    { key: 'zooms', label: 'Zooms', hint: 'Punch-ins on whoever is speaking' },
    { key: 'callouts', label: 'Keyword callouts', hint: 'Pop-up text on key moments' },
    { key: 'colorMatch', label: 'Colour match', hint: 'Grade towards the reference' },
];

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
    return (
        <label className={`aie-toggle ${on ? 'is-on' : ''}`}>
            <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
            <span className="aie-toggle__switch" aria-hidden="true" />
            <span className="aie-toggle__text">
                <strong>{label}</strong>
                <small>{hint}</small>
            </span>
        </label>
    );
}

export function AiEditStudio() {
    const { plan: userPlan } = useAuth();
    const store = useAiEditStore();
    const { open, close, presets, styles, selectedId, footageId, setFootage, options, setOptions, edit, runEdit, cancelEdit, plan, apply, reset, updateStyle } = store;
    const items = useMediaStore((s) => s.items);
    const notify = useUiStore((s) => s.notify);
    const setExportOpen = useUiStore((s) => s.setExportOpen);
    const fileInput = useRef<HTMLInputElement>(null);
    const [renaming, setRenaming] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, close]);

    if (!open) return null;

    const style = [...styles, ...presets].find((s) => s.id === selectedId) || null;
    const isSaved = !!style && styles.some((s) => s.id === style.id);
    const videos = items.filter((i) => i.type === 'video');
    const footage = videos.find((v) => v.id === footageId) || null;
    const locked = userPlan === 'starter';

    const addFootage = async (file: File) => {
        const key = useProjectStore.getState().projectKey;
        if (!key) return;
        const [item] = await useMediaStore.getState().addFiles([file], key);
        if (item) setFootage(item.id);
    };

    const openInEditor = (thenExport = false) => {
        try {
            apply();
            close();
            notify('AI edit applied. Everything is on the timeline to fine-tune (undo with Ctrl+Z).', 'success');
            if (thenExport) setExportOpen(true);
        } catch (e) {
            notify((e as Error).message, 'error');
        }
    };

    return (
        <div className="ke-modal aie" role="dialog" aria-modal="true" aria-label="AI Edit">
            <div className="aie__card">
                <header className="aie__head">
                    <div>
                        <h3>
                            <Wand2 size={17} /> AI Edit
                        </h3>
                        <p>Edit your footage the way your favourite videos are edited. You can fine-tune everything in the editor afterwards.</p>
                    </div>
                    <button className="ke-icon-btn" onClick={close} title="Close (Esc)">
                        <X size={17} />
                    </button>
                </header>

                {locked ? (
                    <div className="ke-alert">AI Edit is part of the paid plans. Upgrade under Billing to have your footage edited in your style.</div>
                ) : null}

                <div className="aie__body">
                    <StylePanel />

                    <section className="aie-col aie-col--main">
                        {style ? (
                            <div className="aie-detail">
                                <div className="aie-detail__head">
                                    {renaming === style.id ? (
                                        <input
                                            className="ke-input"
                                            autoFocus
                                            defaultValue={style.name}
                                            onBlur={async (e) => {
                                                setRenaming(null);
                                                const name = e.target.value.trim();
                                                if (name && name !== style.name) await updateStyle(style.id, { name }).catch((err) => notify(err.message, 'error'));
                                            }}
                                            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                                        />
                                    ) : (
                                        <h4>
                                            {style.name}
                                            {isSaved ? (
                                                <button className="ke-icon-btn" title="Rename" onClick={() => setRenaming(style.id)}>
                                                    <PencilLine size={13} />
                                                </button>
                                            ) : null}
                                        </h4>
                                    )}
                                    <div className="aie-detail__sample">
                                        <CaptionSample style={style} />
                                    </div>
                                </div>
                                <p className="aie-detail__summary">{style.summary}</p>
                                <StyleFacts style={style} />
                            </div>
                        ) : (
                            <p className="ke-muted">Pick or learn a style on the left.</p>
                        )}

                        <div className="aie-step">
                            <span className="aie-step__n">2</span>
                            <div>
                                <h4>Your footage</h4>
                                <p>Raw recording, e.g. a podcast with guests or a talking-head take.</p>
                            </div>
                        </div>
                        <div className="aie-footage">
                            <select className="ke-select" value={footageId || ''} onChange={(e) => setFootage(e.target.value || null)}>
                                <option value="">{videos.length ? 'Choose a video from this project' : 'No videos in this project yet'}</option>
                                {videos.map((v) => (
                                    <option key={v.id} value={v.id}>
                                        {v.name} ({formatDuration(v.duration)})
                                    </option>
                                ))}
                            </select>
                            <input ref={fileInput} type="file" accept="video/*" hidden onChange={(e) => e.target.files?.[0] && addFootage(e.target.files[0])} />
                            <button className="ke-btn" onClick={() => fileInput.current?.click()}>
                                <Upload size={14} /> From device
                            </button>
                        </div>

                        <div className="aie-options">
                            <div className="aie-options__row">
                                <span>Format</span>
                                <div className="ke-seg ke-seg--text">
                                    {(['auto', '9:16', '16:9', '1:1'] as const).map((r) => (
                                        <button key={r} className={options.ratio === r ? 'is-active' : ''} onClick={() => setOptions({ ratio: r })}>
                                            {r === 'auto' ? `Style (${style?.format.ratio || '—'})` : r}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="aie-options__row">
                                <span>Edit</span>
                                <div className="ke-seg ke-seg--text">
                                    <button className={options.mode === 'full' ? 'is-active' : ''} onClick={() => setOptions({ mode: 'full' })}>
                                        Full video
                                    </button>
                                    <button className={options.mode === 'highlights' ? 'is-active' : ''} onClick={() => setOptions({ mode: 'highlights' })}>
                                        Best moment
                                    </button>
                                </div>
                                {options.mode === 'highlights' ? (
                                    <div className="ke-seg ke-seg--text">
                                        {([30, 60, 90] as const).map((t) => (
                                            <button key={t} className={options.targetSeconds === t ? 'is-active' : ''} onClick={() => setOptions({ targetSeconds: t })}>
                                                {t}s
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                            {options.mode === 'highlights' ? (
                                <input className="ke-input" value={options.focus} onChange={(e) => setOptions({ focus: e.target.value })} placeholder="Optional: what the moment should be about" />
                            ) : null}
                            <div className="aie-toggles">
                                {TOGGLES.map((t) => (
                                    <Toggle key={t.key} on={!!options[t.key]} onChange={(v) => setOptions({ [t.key]: v } as Partial<EditOptions>)} label={t.label} hint={t.hint} />
                                ))}
                            </div>
                        </div>

                        <div className="aie-step">
                            <span className="aie-step__n">3</span>
                            <div>
                                <h4>Edit</h4>
                                <p>Long footage takes a while: transcription and face tracking run on the server.</p>
                            </div>
                        </div>

                        {edit.running ? (
                            <div className="ke-progress-card">
                                <div className="ke-progress-card__row">
                                    <Loader2 size={14} className="ke-spin" />
                                    <span>{edit.stage || 'Working'}…</span>
                                    <span className="ke-mono">{edit.progress}%</span>
                                    <button className="ke-btn ke-btn--ghost ke-btn--sm" onClick={cancelEdit}>
                                        Cancel
                                    </button>
                                </div>
                                <div className="ke-bar">
                                    <div style={{ width: `${edit.progress}%` }} />
                                </div>
                            </div>
                        ) : plan ? (
                            <div className="aie-result">
                                <div className="aie-result__head">
                                    <CheckCircle2 size={18} className="ke-ok" />
                                    <strong>
                                        Edited: {formatDuration(plan.sourceDuration)} → {formatDuration(plan.duration)}
                                    </strong>
                                </div>
                                <ul>
                                    <li>{plan.summary.cuts} cuts, {formatDuration(plan.summary.removedSec)} of pauses and filler removed</li>
                                    {plan.summary.punchIns ? <li>{plan.summary.punchIns} punch-in zooms{plan.summary.speakers > 1 ? `, following ${plan.summary.speakers} speakers` : ''}</li> : null}
                                    {plan.summary.captions ? <li>{plan.summary.captions} captions</li> : null}
                                    {plan.summary.hookTitle ? <li>Hook: “{plan.summary.hookTitle}”</li> : null}
                                    {plan.summary.coldOpenSec ? <li>{plan.summary.coldOpenSec.toFixed(0)}s cold open</li> : null}
                                    {plan.summary.callouts ? <li>{plan.summary.callouts} keyword callouts</li> : null}
                                    {plan.summary.graded ? <li>Colour matched to the style</li> : null}
                                    {plan.highlight ? <li>Best moment: “{plan.highlight.title}”</li> : null}
                                </ul>
                                <div className="aie-result__actions">
                                    <button className="ke-btn ke-btn--primary" onClick={() => openInEditor(false)}>
                                        <PencilLine size={14} /> Open in editor
                                    </button>
                                    <button className="ke-btn" onClick={() => openInEditor(true)}>
                                        <Download size={14} /> Apply and export
                                    </button>
                                    <button className="ke-btn ke-btn--ghost" onClick={reset}>
                                        Start over
                                    </button>
                                </div>
                                <p className="ke-note">Applying replaces the main track and caption tracks; your other tracks stay. Undo with Ctrl+Z.</p>
                            </div>
                        ) : (
                            <button
                                className="ke-btn ke-btn--primary ke-btn--block aie-run"
                                disabled={locked || !style || !footage}
                                onClick={() => runEdit().catch((e) => notify(e.message, 'error'))}
                            >
                                <Sparkles size={15} /> {footage ? `Edit “${footage.name}” in this style` : 'Choose footage to edit'}
                            </button>
                        )}
                        {edit.error ? <div className="ke-alert ke-alert--error">{edit.error}</div> : null}
                    </section>
                </div>
            </div>
        </div>
    );
}
