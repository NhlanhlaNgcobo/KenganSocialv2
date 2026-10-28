/**
 * Kengan JSON templates: gallery with preview playback, "Use template" with a media slot list,
 * editable text/colours/music, saving the current edit as a template, and JSON import/export.
 */
import { useMemo, useRef, useState } from 'react';
import { Download, FileUp, Loader2, Play, Save, Trash2, Wand2 } from 'lucide-react';
import { applyBuiltTemplate, buildTemplate, builtInTemplates, deleteTemplate, loadTemplate, savedTemplates, saveTemplate, timelineToTemplate, type KenganTemplate } from '../../lib/template-build';
import { resolveTiming } from '../../lib/template-schema.js';
import { useMediaStore } from '../../stores/media-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';
import { TemplatePreview } from './TemplatePreview';
import { confirmDialog, promptDialog } from '../../../lib/dialogs';

function downloadJson(template: KenganTemplate) {
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${template.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TemplateGallery() {
    const notify = useUiStore((s) => s.notify);
    const items = useMediaStore((s) => s.items);
    const [saved, setSaved] = useState(() => savedTemplates());
    const all = useMemo(() => [...builtInTemplates(), ...saved], [saved]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selected = all.find((x) => x.id === selectedId) || null;
    const [hover, setHover] = useState<string | null>(null);
    const [assignments, setAssignments] = useState<Record<string, string>>({});
    const [params, setParams] = useState<Record<string, string | number>>({});
    const [musicId, setMusicId] = useState<string>('');
    const [busy, setBusy] = useState(false);
    const [importErrors, setImportErrors] = useState<string[]>([]);
    const fileRef = useRef<HTMLInputElement>(null);
    const footage = items.filter((m) => m.type === 'video' || m.type === 'image');
    const audio = items.filter((m) => m.type === 'audio');
    const isSaved = (id: string) => saved.some((x) => x.id === id);

    const choose = (t: KenganTemplate) => {
        setSelectedId(t.id);
        setParams({});
        setMusicId(audio[0]?.id || '');
        // Fill slots in order from the media library.
        const usable = footage.slice(0, t.slots.length);
        setAssignments(Object.fromEntries(t.slots.map((s, i) => [s.id, usable.length ? usable[i % usable.length].id : ''])));
    };

    const use = async () => {
        if (!selected || busy) return;
        const hasEdits = useTimelineStore.getState().tracks.some((t) => t.isMain && t.elements.length > 0);
        if (hasEdits && !(await confirmDialog(`Use “${selected.name}”? It replaces the clips on your main track (Ctrl+Z restores them).`, { confirmLabel: 'Use template' }))) return;
        setBusy(true);
        try {
            const built = await buildTemplate(selected, { assignments, params, musicId: selected.music ? musicId || null : null });
            applyBuiltTemplate(selected, built);
            notify([`${selected.name}: ${built.main.length} shots, ${built.duration.toFixed(1)}s.`, ...built.notes].join(' '), 'success');
        } catch (error) {
            notify((error as Error).message, 'error');
        } finally {
            setBusy(false);
        }
    };

    const saveCurrent = async () => {
        const name = await promptDialog('Name this template', { defaultValue: 'My template' });
        if (name === null) return;
        try {
            const { template, onBeats } = timelineToTemplate({ name });
            saveTemplate(template);
            setSaved(savedTemplates());
            setSelectedId(template.id);
            notify(`Saved “${template.name}”: ${template.slots.length} shots${onBeats ? ', timed in beats' : ''}. Download it to share or back it up.`, 'success');
        } catch (error) {
            notify((error as Error).message, 'error');
        }
    };

    const importFile = async (file: File) => {
        setImportErrors([]);
        const result = loadTemplate(await file.text());
        if (!result.ok || !result.template) {
            setImportErrors(result.errors.slice(0, 8));
            return;
        }
        if (builtInTemplates().some((x) => x.id === result.template!.id)) result.template.id = `${result.template.id}-copy`;
        saveTemplate(result.template);
        setSaved(savedTemplates());
        setSelectedId(result.template.id);
        notify(`Imported “${result.template.name}”.${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`, 'success');
    };

    const timing = selected ? resolveTiming(selected, {}) : null;
    const thumbs = selected ? selected.slots.map((s) => items.find((m) => m.id === assignments[s.id])?.thumbnailUrl) : [];
    const unitLabel = (len: number) => (selected?.timing.unit === 'beats' ? `${len} beat${len === 1 ? '' : 's'}` : `${len}s`);

    return (
        <div className="ke-stack ke-tplg">
            <div className="ke-inline">
                <button className="ke-btn ke-btn--sm" onClick={saveCurrent} title="Turn the current edit into a reusable template">
                    <Save size={13} /> Save edit as template
                </button>
                <button className="ke-btn ke-btn--sm" onClick={() => fileRef.current?.click()}>
                    <FileUp size={13} /> Import JSON
                </button>
                <input
                    ref={fileRef}
                    type="file"
                    hidden
                    accept="application/json,.json"
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void importFile(f);
                        e.target.value = '';
                    }}
                />
            </div>
            {importErrors.length ? (
                <div className="ke-alert ke-alert--error">
                    <p>That template file has problems:</p>
                    {importErrors.map((e) => (
                        <p key={e}>• {e}</p>
                    ))}
                </div>
            ) : null}

            <div className="ke-tplg__grid">
                {all.map((t) => {
                    const d = resolveTiming(t, {}).duration;
                    return (
                        <button key={t.id} className={`ke-tplg__card ${selectedId === t.id ? 'is-active' : ''}`} onClick={() => choose(t)} onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover(null)}>
                            <TemplatePreview template={t} compact playing={hover === t.id || selectedId === t.id} />
                            <strong>{t.name}</strong>
                            <small>
                                {t.canvas.ratio} · {Math.round(d)}s · {t.slots.length} shots{t.timing.unit === 'beats' ? ' · beat sync' : ''}
                                {isSaved(t.id) ? ' · yours' : ''}
                            </small>
                        </button>
                    );
                })}
            </div>

            {selected && timing ? (
                <div className="ke-recipe">
                    <div className="ke-recipe__heading">
                        <strong>{selected.name}</strong>
                        <span>
                            <Play size={10} /> PREVIEW
                        </span>
                    </div>
                    <TemplatePreview template={selected} thumbs={thumbs} params={params} />
                    {selected.description ? <p className="ke-note">{selected.description}</p> : null}

                    <h5 className="ke-subhead">Your media</h5>
                    {selected.slots.map((slot, i) => {
                        const item = items.find((m) => m.id === assignments[slot.id]);
                        return (
                            <label key={slot.id} className="ke-recipe__slot">
                                <span className="ke-recipe__number">{String(i + 1).padStart(2, '0')}</span>
                                {item?.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : <span className="ke-recipe__placeholder" />}
                                <span className="ke-recipe__field">
                                    <span>
                                        {slot.label} <small>{unitLabel(slot.length)}{selected.timing.unit === 'beats' ? '' : ''}</small>
                                    </span>
                                    <select className="ke-select" aria-label={`Media for ${slot.label}`} value={assignments[slot.id] || ''} onChange={(e) => setAssignments((a) => ({ ...a, [slot.id]: e.target.value }))}>
                                        <option value="">Reuse other media</option>
                                        {footage
                                            .filter((m) => slot.accepts.includes(m.type as 'video' | 'image'))
                                            .map((m) => (
                                                <option key={m.id} value={m.id}>
                                                    {m.name}
                                                </option>
                                            ))}
                                    </select>
                                </span>
                            </label>
                        );
                    })}
                    {!footage.length ? <p className="ke-note">Import videos or photos in Media first.</p> : null}

                    {selected.params.length ? <h5 className="ke-subhead">Text and style</h5> : null}
                    {selected.params.map((p) => {
                        const value = params[p.id] ?? p.default;
                        return (
                            <label key={p.id} className="ke-field">
                                <span>{p.label}</span>
                                {p.type === 'text' ? (
                                    <input className="ke-input" value={String(value)} maxLength={200} onChange={(e) => setParams((s) => ({ ...s, [p.id]: e.target.value }))} />
                                ) : p.type === 'color' ? (
                                    <input type="color" value={String(value)} onChange={(e) => setParams((s) => ({ ...s, [p.id]: e.target.value }))} aria-label={p.label} />
                                ) : p.type === 'choice' ? (
                                    <select className="ke-select" value={String(value)} onChange={(e) => setParams((s) => ({ ...s, [p.id]: e.target.value }))}>
                                        {p.options!.map((o) => (
                                            <option key={o}>{o}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <span className="ke-range">
                                        <input type="range" min={p.min} max={p.max} step={0.05} value={Number(value)} onChange={(e) => setParams((s) => ({ ...s, [p.id]: Number(e.target.value) }))} aria-label={p.label} />
                                        <strong>{Number(value).toFixed(2)}</strong>
                                    </span>
                                )}
                            </label>
                        );
                    })}

                    {selected.music ? (
                        <label className="ke-field">
                            <span>Music{selected.timing.unit === 'beats' ? ' (cuts follow its beats)' : ''}</span>
                            <select className="ke-select" value={musicId} onChange={(e) => setMusicId(e.target.value)} aria-label="Template music">
                                <option value="">No music</option>
                                {audio.map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.name}
                                    </option>
                                ))}
                            </select>
                            {!audio.length ? <small className="ke-muted">Import a song in Media or Music to use it here.</small> : null}
                        </label>
                    ) : null}

                    <button className="ke-btn ke-btn--primary ke-btn--block" disabled={busy || !footage.length} onClick={use}>
                        {busy ? <Loader2 size={15} className="ke-spin" /> : <Wand2 size={15} />} Use template
                    </button>
                    <div className="ke-inline">
                        <button className="ke-btn ke-btn--sm" onClick={() => downloadJson(selected)}>
                            <Download size={13} /> Download JSON
                        </button>
                        {isSaved(selected.id) ? (
                            <button
                                className="ke-btn ke-btn--sm"
                                onClick={async () => {
                                    if (!(await confirmDialog(`Delete “${selected.name}” from this browser?`, { confirmLabel: 'Delete', danger: true }))) return;
                                    deleteTemplate(selected.id);
                                    setSaved(savedTemplates());
                                    setSelectedId(null);
                                }}
                            >
                                <Trash2 size={13} /> Delete
                            </button>
                        ) : null}
                    </div>
                    <p className="ke-note">
                        {selected.timing.unit === 'beats'
                            ? `Timed in beats: with music, every cut lands on its beats (about ${Math.round(timing.duration)}s at ${selected.timing.bpm} BPM).`
                            : `About ${Math.round(timing.duration)}s.`}{' '}
                        Everything stays editable after you use it. Saved templates live in this browser; download them to keep a copy.
                    </p>
                </div>
            ) : null}
        </div>
    );
}
