import { useEffect, useRef, useState } from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { musicApi, type LibrarySummary } from '../../../lib/music-api';
import { applyTemplate, TEMPLATES, type AutoCutTemplate } from '../../lib/templates';
import { useAiStore } from '../../stores/ai-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';
import { SourcePicker } from './SourcePicker';

function Badge({ children }: { children: React.ReactNode }) {
    return <span className="ke-tpl__badge">{children}</span>;
}

export function TemplatesView() {
    const { plan } = useAuth();
    const sourceMediaId = useAiStore((s) => s.sourceMediaId);
    const notify = useUiStore((s) => s.notify);
    const [selected, setSelected] = useState<AutoCutTemplate>(TEMPLATES[0]);
    const [texts, setTexts] = useState<Record<string, string>>({});
    const [running, setRunning] = useState<{ stage: string; progress: number } | null>(null);
    const controller = useRef<AbortController | null>(null);
    const allowAi = plan !== 'starter';
    const [library, setLibrary] = useState<LibrarySummary | null>(null);
    const [music, setMusic] = useState({ genre: TEMPLATES[0].music?.genre || '', mood: TEMPLATES[0].music?.mood || '' });

    useEffect(() => {
        musicApi.summary().then(setLibrary).catch(() => setLibrary(null));
    }, []);

    const choose = (t: AutoCutTemplate) => {
        setSelected(t);
        setMusic({ genre: t.music?.genre || '', mood: t.music?.mood || '' });
    };

    const textFields = [
        selected.hookText !== undefined && ['hookText', 'Opening text', selected.hookText],
        selected.ctaText !== undefined && ['ctaText', 'Call to action', selected.ctaText],
        selected.lowerThird !== undefined && ['lowerThird', 'Name label', selected.lowerThird],
    ].filter(Boolean) as [string, string, string][];

    const apply = async () => {
        if (!sourceMediaId) return;
        const hasEdits = useTimelineStore.getState().tracks.some((t) => t.isMain && t.elements.length > 1);
        if (hasEdits && !window.confirm(`Apply “${selected.name}”? It replaces the clips on your main track (Ctrl+Z restores them).`)) return;
        controller.current = new AbortController();
        setRunning({ stage: 'Starting', progress: 0 });
        try {
            const message = await applyTemplate(selected, sourceMediaId, {
                allowAi,
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
            setRunning(null);
        }
    };

    return (
        <div className="ke-view">
            <div className="ke-view__head">
                <h3>Auto-cut templates</h3>
            </div>
            <SourcePicker />

            <div className="ke-tpl-list">
                {TEMPLATES.map((t) => (
                    <button key={t.id} className={`ke-tpl ${selected.id === t.id ? 'is-active' : ''}`} onClick={() => choose(t)} disabled={!!running}>
                        <div className={`ke-tpl__frame is-${t.ratio.replace(':', 'x')}`} aria-hidden="true">
                            <span />
                        </div>
                        <div className="ke-tpl__body">
                            <strong>{t.name}</strong>
                            <p>{t.description}</p>
                            <div className="ke-tpl__badges">
                                <Badge>{t.ratio}</Badge>
                                <Badge>{t.targetSeconds ? `~${t.targetSeconds}s` : 'Full length'}</Badge>
                                {t.strategy !== 'even' ? <Badge>AI cuts</Badge> : null}
                                {t.captions ? <Badge>Captions</Badge> : null}
                                {t.music ? <Badge>Music</Badge> : null}
                            </div>
                        </div>
                    </button>
                ))}
            </div>

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
                            {(library?.genres || []).filter((g) => g.name !== 'Stings').map((g) => (
                                <option key={g.id} value={g.name}>
                                    {g.name}
                                </option>
                            ))}
                            {!library && music.genre ? <option value={music.genre}>{music.genre}</option> : null}
                        </select>
                        <select className="ke-select ke-select--sm" value={music.mood} onChange={(e) => setMusic((m) => ({ ...m, mood: e.target.value }))} disabled={!!running || !music.genre} aria-label="Music mood">
                            <option value="">Any mood</option>
                            {(library?.moods || []).map((m) => (
                                <option key={m.name} value={m.name}>
                                    {m.name}
                                </option>
                            ))}
                            {!library && music.mood ? <option value={music.mood}>{music.mood}</option> : null}
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
                <button className="ke-btn ke-btn--primary ke-btn--block" onClick={apply} disabled={!sourceMediaId}>
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
