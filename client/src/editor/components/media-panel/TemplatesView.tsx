import { useEffect, useRef, useState } from 'react';
import { FILTER_PREVIEW_CSS, LOOK_LABELS } from '../../constants';
import { EFFECTS, TRANSITIONS } from '../../lib/fx';
import { Loader2, Wand2 } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { musicApi, type SongGenres } from '../../../lib/music-api';
import { applyTemplate, TEMPLATES, type AutoCutTemplate, type TemplateMusic } from '../../lib/templates';
import { useAiStore } from '../../stores/ai-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';
import { arrangeClips } from '../../lib/arrange-clips';
import { SourcePicker } from './SourcePicker';
import { useMediaStore } from '../../stores/media-store';
import { PresetSearch, matchesPreset } from './PresetSearch';
import { TemplateGallery } from './TemplateGallery';

function Badge({ children }: { children: React.ReactNode }) {
    return <span className="ke-tpl__badge">{children}</span>;
}

export function TemplatesView() {
    const [mode, setMode] = useState<'json' | 'auto'>('json');
    return (
        <div className="ke-view">
            <div className="ke-view__head">
                <h3>Templates</h3>
            </div>
            <div className="ke-chip-row" role="tablist">
                <button role="tab" aria-selected={mode === 'json'} className={`ke-chip ${mode === 'json' ? 'is-active' : ''}`} onClick={() => setMode('json')}>
                    Fill-in templates
                </button>
                <button role="tab" aria-selected={mode === 'auto'} className={`ke-chip ${mode === 'auto' ? 'is-active' : ''}`} onClick={() => setMode('auto')}>
                    Auto-cut from one video
                </button>
            </div>
            {mode === 'json' ? <TemplateGallery /> : <AutoCutTemplates />}
        </div>
    );
}

function AutoCutTemplates() {
    const { plan } = useAuth();
    const sourceMediaId = useAiStore((s) => s.sourceMediaId);
    const notify = useUiStore((s) => s.notify);
    const [selected, setSelected] = useState<AutoCutTemplate>(TEMPLATES[0]);
    const [query, setQuery] = useState('');
    const [collection, setCollection] = useState('all');
    const [sourceIds, setSourceIds] = useState<string[]>([]);
    const [category, setCategory] = useState('all');
    const [excluded, setExcluded] = useState<string[]>([]);
    const [pace, setPace] = useState(1);
    const items = useMediaStore((s) => s.items);
    const footage = items.filter((item) => item.type !== 'audio');
    const automatic = arrangeClips(selected.recipe || [], footage.filter((m) => !excluded.includes(m.id)));
    const assigned = (selected.recipe || []).map((_, i) => sourceIds[i] || automatic[i] || '');
    const sourceThumb = footage.find((item) => item.id === sourceMediaId)?.thumbnailUrl;
    const visible = TEMPLATES.filter((t) => matchesPreset(t.id, `${t.name} ${t.description}`, query, collection) && (category === 'all' || t.category === category));
    const [texts, setTexts] = useState<Record<string, string>>({});
    const [running, setRunning] = useState<{ stage: string; progress: number } | null>(null);
    const controller = useRef<AbortController | null>(null);
    const allowAi = plan !== 'starter';
    const [songGenres, setSongGenres] = useState<SongGenres | null>(null);
    const [music, setMusic] = useState<Pick<TemplateMusic, 'genre' | 'vocals'>>({ genre: TEMPLATES[0].music?.genre || '', vocals: TEMPLATES[0].music?.vocals || 'any' });

    useEffect(() => {
        musicApi.songGenres().then(setSongGenres).catch(() => setSongGenres(null));
        return () => controller.current?.abort();
    }, []);

    const choose = (t: AutoCutTemplate) => {
        setSelected(t);
        setTexts({});
        setSourceIds([]);
        setPace(1);
        setMusic({ genre: t.music?.genre || '', vocals: t.music?.vocals || 'any' });
    };

    const textFields = [
        selected.hookText !== undefined && ['hookText', 'Opening text', selected.hookText],
        selected.ctaText !== undefined && ['ctaText', 'Call to action', selected.ctaText],
        selected.lowerThird !== undefined && ['lowerThird', 'Name label', selected.lowerThird],
    ].filter(Boolean) as [string, string, string][];

    const apply = async () => {
        if (!sourceMediaId || controller.current) return;
        const hasEdits = useTimelineStore.getState().tracks.some((t) => t.isMain && t.elements.length > 0);
        if (hasEdits && !window.confirm(`Apply “${selected.name}”? It replaces the clips on your main track (Ctrl+Z restores them).`)) return;
        controller.current = new AbortController();
        setRunning({ stage: 'Starting', progress: 0 });
        try {
            const message = await applyTemplate(selected, sourceMediaId, {
                allowAi,
                sourceIds: assigned,
                pace,
                hookText: texts.hookText,
                ctaText: texts.ctaText,
                lowerThird: texts.lowerThird,
                music: music.genre ? music : null,
                signal: controller.current.signal,
                onStage: (stage, progress) => setRunning({ stage, progress }),
            });
            notify(message, 'success');
        } catch (error) {
            if ((error as Error).message !== 'Cancelled') notify((error as Error).message, 'error');
        } finally {
            controller.current = null;
            setRunning(null);
        }
    };

    return (
        <div className="ke-stack">
            <SourcePicker allowImages={!!selected.recipe} videoOnly={!selected.recipe} disabled={!!running} />
            <PresetSearch query={query} onQuery={setQuery} collection={collection} onCollection={setCollection} count={visible.length} />

            <select className="ke-select" aria-label="Template category" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="all">All stories</option><option value="gym">Gym ? 10 recipes</option><option value="lifestyle">Lifestyle ? 10 recipes</option><option value="vlog">Vlog ? 10 recipes</option>
            </select>
            <div className="ke-tpl-list">
                {visible.map((t) => (
                    <button key={t.id} className={`ke-tpl ${selected.id === t.id ? 'is-active' : ''}`} onClick={() => choose(t)} disabled={!!running}>
                        <div className={`ke-tpl__frame is-${t.ratio.replace(':', 'x')}`} aria-hidden="true">
                            <span style={{ filter: FILTER_PREVIEW_CSS[t.filter], background: sourceThumb ? `url(${sourceThumb}) center / cover` : undefined }} />
                        </div>
                        <div className="ke-tpl__body">
                            <strong>{t.name}</strong>
                            <p>{t.description}</p>
                            <div className="ke-tpl__badges">
                                <Badge>{t.ratio}</Badge>
                                {t.recipe ? <Badge>{t.recipe.length} editable shots</Badge> : null}
                                <Badge>{t.targetSeconds ? `~${t.targetSeconds}s` : 'Full length'}</Badge>
                                {t.strategy !== 'even' ? <Badge>AI cuts</Badge> : null}
                                {t.captions ? <Badge>Captions</Badge> : null}
                                {t.music ? <Badge>Music</Badge> : null}
                                {t.filter !== 'none' ? <Badge>{LOOK_LABELS[t.filter]}</Badge> : null}
                                {t.transition ? <Badge>{TRANSITIONS.find((x) => x.type === t.transition?.type)?.label}</Badge> : null}
                                {t.effects?.length ? <Badge>{t.effects.map((e) => EFFECTS.find((x) => x.type === e.type)?.label).join(' + ')}</Badge> : null}
                            </div>
                        </div>
                    </button>
                ))}
            </div>

            {selected.recipe ? <div className="ke-recipe">
                <div className="ke-recipe__heading"><strong>{selected.name}</strong><span>YOUR SHOT LIST</span></div>
                <p className="ke-note">{selected.description}</p>
                <p className="ke-note">Clips are arranged automatically using filenames, duration and orientation. Rename clips with shot labels for better matching. Review or override any slot below.</p>
                <details><summary>Footage pool</summary>
                    {footage.map((m) => <label key={m.id} className="ke-recipe__pool"><input type="checkbox" disabled={!!running} checked={!excluded.includes(m.id)} onChange={() => { setExcluded((ids) => ids.includes(m.id) ? ids.filter((id) => id !== m.id) : [...ids, m.id]); setSourceIds([]); }} />{m.name}</label>)}
                </details>
                <button className="ke-btn ke-btn--sm" disabled={!!running} onClick={() => setSourceIds([])}>Rearrange automatically</button>
                <div className="ke-recipe__strip" aria-label="Shot duration preview">
                    {selected.recipe.map((shot, i) => <span key={i} style={{ flex: shot.seconds }} title={`${shot.label}: ${(shot.seconds / pace).toFixed(1)}s`}>{i + 1}</span>)}
                </div>
                {selected.recipe.map((shot, i) => {
                    const item = items.find((m) => m.id === assigned[i]);
                    return <label key={`${selected.id}-${i}`} className="ke-recipe__slot">
                        <span className="ke-recipe__number">{String(i + 1).padStart(2, '0')}</span>
                        {item?.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : <span className="ke-recipe__placeholder" />}
                        <span className="ke-recipe__field"><span>{shot.label} <small>{(shot.seconds / pace).toFixed(1)}s{shot.speed ? ` · ${shot.speed}×` : ''}</small></span>
                            <select className="ke-select" aria-label={`Footage for ${shot.label}`} disabled={!!running} value={sourceIds[i] || ''} onChange={(e) => setSourceIds((ids) => { const next = [...ids]; next[i] = e.target.value; return next; })}>
                                <option value="">Auto: {items.find((m) => m.id === automatic[i])?.name || 'No footage'}</option>
                                {footage.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                        </span>
                    </label>;
                })}
                <label className="ke-range"><span>Edit pace</span><input aria-label="Template edit pace" disabled={!!running} type="range" min={0.5} max={2} step={0.1} value={pace} onChange={(e) => setPace(Number(e.target.value))} /><strong>{pace.toFixed(1)}×</strong></label>
                <p className="ke-note">Pace changes shot lengths. Short sources are trimmed to what is available. Cuts use this recipe’s timing; they are not automatically synced to music.</p>
            </div> : null}

            {textFields.length ? (
                <div className="ke-stack">
                    {textFields.map(([key, label, placeholder]) => (
                        <label key={key} className="ke-field">
                            <span>{label}</span>
                            <input
                                className="ke-input"
                                placeholder={placeholder}
                                value={texts[key] ?? placeholder}
                                onChange={(e) => setTexts((s) => ({ ...s, [key]: e.target.value }))}
                                disabled={!!running}
                            />
                        </label>
                    ))}
                </div>
            ) : null}

            <div className="ke-stack">
                <div className="ke-field">
                    <span>Music</span>
                    <div className="ke-music-filters">
                        <select className="ke-select ke-select--sm" value={music.genre} onChange={(e) => setMusic((m) => ({ ...m, genre: e.target.value }))} disabled={!!running} aria-label="Music genre">
                            <option value="">No music</option>
                            {(songGenres?.genres || []).map((g) => (
                                <option key={g.id} value={g.id}>
                                    {g.name}
                                </option>
                            ))}
                            {!songGenres && music.genre ? <option value={music.genre}>{music.genre}</option> : null}
                        </select>
                        <select
                            className="ke-select ke-select--sm"
                            value={music.vocals}
                            onChange={(e) => setMusic((m) => ({ ...m, vocals: e.target.value as TemplateMusic['vocals'] }))}
                            disabled={!!running || !music.genre}
                            aria-label="Vocals"
                        >
                            <option value="any">Any vocals</option>
                            <option value="female">Female vocals</option>
                            <option value="male">Male vocals</option>
                        </select>
                    </div>
                </div>
            </div>

            {running ? (
                <div className="ke-progress-card">
                    <div className="ke-progress-card__row">
                        <Loader2 size={14} className="ke-spin" />
                        <span>{running.stage}…</span>
                        <button className="ke-btn ke-btn--ghost ke-btn--sm" onClick={() => controller.current?.abort()}>
                            Cancel
                        </button>
                    </div>
                    <div className="ke-bar">
                        <div style={{ width: `${running.progress}%` }} />
                    </div>
                </div>
            ) : (
                <button className="ke-btn ke-btn--primary ke-btn--block" onClick={apply} disabled={!sourceMediaId || (!!selected.recipe && !automatic.length)}>
                    <Wand2 size={15} /> Apply “{selected.name}”
                </button>
            )}
            {!allowAi && selected.strategy !== 'even' ? (
                <p className="ke-note">On the Starter plan cuts are spaced evenly. AI highlights and captions need Nano or higher.</p>
            ) : (
                <p className="ke-note">Everything stays editable afterwards: move cuts, change text, swap the music.</p>
            )}
        </div>
    );
}
