import { useEffect, useState } from 'react';
import { buildLut, LOOK_NAMES, neutralColor, sampleLut } from '../../lib/color-pipeline.js';
import { canTransition, DEFAULT_TRANSITION_SECONDS, EFFECTS, effectPreview, TRANSITION_GROUPS, TRANSITIONS, transitionStyles } from '../../lib/fx';
import { useMediaStore } from '../../stores/media-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';
import type { ClipEffect, ColorSettings, EffectType, MediaElement, TransitionType } from '../../types';
import { PresetSearch, matchesPreset } from './PresetSearch';
import { usePreviewTime } from '../../hooks/use-preview-time';

/** Main-track clips the panel acts on: the selected ones, or every clip when none is selected. */
function useTargets() {
    const tracks = useTimelineStore((s) => s.tracks);
    const selected = useTimelineStore((s) => s.selected);
    const main = tracks.find((t) => t.isMain);
    const clips = (main?.elements.filter((e) => e.type === 'media') as MediaElement[] | undefined)?.sort((a, b) => a.startTime - b.startTime) || [];
    const chosen = clips.filter((c) => selected.some((s) => s.elementId === c.id));
    return { main, clips, chosen, targets: selected.length ? chosen : clips, hasSelection: selected.length > 0 };
}

function useThumb(clip: MediaElement | undefined) {
    return useMediaStore((s) => (clip ? s.items.find((i) => i.id === clip.mediaId)?.thumbnailUrl : undefined));
}

/** Look thumbnails: the clip's own thumbnail run through each look's LUT (cached per image). */
const thumbCache = new Map<string, Record<string, string>>();
function useLookThumbs(src: string | undefined) {
    const [thumbs, setThumbs] = useState<Record<string, string>>(() => (src && thumbCache.get(src)) || {});
    useEffect(() => {
        if (!src) return undefined;
        if (thumbCache.has(src)) {
            setThumbs(thumbCache.get(src)!);
            return undefined;
        }
        let cancelled = false;
        const img = new Image();
        img.onload = () => {
            const w = 96;
            const h = Math.max(1, Math.round((w * img.naturalHeight) / img.naturalWidth));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0, w, h);
            const base = ctx.getImageData(0, 0, w, h);
            const out: Record<string, string> = {};
            for (const look of Object.keys(LOOK_NAMES)) {
                const lut = buildLut({ creative: { look } }, {}, 13);
                const data = new ImageData(new Uint8ClampedArray(base.data), w, h);
                for (let i = 0; i < data.data.length; i += 4) {
                    const [r, g, b] = sampleLut(lut, data.data[i] / 255, data.data[i + 1] / 255, data.data[i + 2] / 255);
                    data.data[i] = r * 255;
                    data.data[i + 1] = g * 255;
                    data.data[i + 2] = b * 255;
                }
                ctx.putImageData(data, 0, 0);
                out[look] = canvas.toDataURL('image/jpeg', 0.8);
            }
            thumbCache.set(src, out);
            if (!cancelled) setThumbs(out);
        };
        img.src = src;
        return () => {
            cancelled = true;
        };
    }, [src]);
    return thumbs;
}

/** Looks and effects for main-track clips. */
export function EffectsView() {
    const { main, clips, chosen, targets } = useTargets();
    const notify = useUiStore((s) => s.notify);
    const thumb = useThumb(targets[0]);
    const scope = chosen.length ? `${chosen.length} selected clip${chosen.length === 1 ? '' : 's'}` : `all ${clips.length} clips`;
    const [query, setQuery] = useState('');
    const [collection, setCollection] = useState('all');
    const [hover, setHover] = useState<EffectType | null>(null);
    const time = usePreviewTime(hover !== null);
    const visible = EFFECTS.filter((fx) => matchesPreset(fx.type, `${fx.label} ${fx.description}`, query, collection));

    const lookThumbs = useLookThumbs(thumb);
    const applyLook = (look: string | null) => {
        if (!main || !targets.length) return notify('Add a clip to the main track first.', 'error');
        const timeline = useTimelineStore.getState();
        timeline.pushHistory();
        for (const c of targets) {
            const base = (c.color || neutralColor()) as ColorSettings;
            timeline.updateElement(main.id, c.id, { filter: 'none', color: { ...base, creative: { ...base.creative, look } } }, false);
        }
        notify(look ? `${(LOOK_NAMES as Record<string, string>)[look]} look on ${scope}. Fine-tune it under Colour › Creative.` : `Look removed from ${scope}.`, 'success');
    };
    const toggleEffect = (type: EffectType) => {
        if (!main || !targets.length) return notify('Add a clip to the main track first.', 'error');
        const timeline = useTimelineStore.getState();
        const allHave = targets.every((c) => c.effects?.some((e) => e.type === type));
        if (!allHave && targets.some((c) => (c.effects?.length || 0) >= 6 && !c.effects?.some((e) => e.type === type))) {
            return notify('A selected clip already has six effects. Remove one in Properties first.', 'error');
        }
        timeline.pushHistory();
        for (const c of targets) {
            const effects = c.effects || [];
            const next: ClipEffect[] = allHave ? effects.filter((e) => e.type !== type) : effects.some((e) => e.type === type) ? effects : [...effects, { type, amount: 0.5 }].slice(0, 6);
            timeline.updateElement(main.id, c.id, { effects: next }, false);
        }
        notify(`${EFFECTS.find((e) => e.type === type)?.label} ${allHave ? 'removed from' : 'added to'} ${scope}. Adjust the amount in the clip's properties.`, 'success');
    };

    return (
        <div className="ke-view">
            <div className="ke-view__head">
                <h3>Effects</h3>
            </div>
            <p className="ke-note">Applies to {clips.length ? scope : 'main-track clips'}. Select clips on the timeline to target only those.</p>

            <h4 className="ke-subhead">Looks</h4>
            <div className="ke-fx-grid">
                <button className={`ke-fx-card ${targets.length > 0 && targets.every((c) => !c.color?.creative?.look) ? 'is-active' : ''}`} onClick={() => applyLook(null)}>
                    <span className="ke-fx-card__thumb" style={{ backgroundImage: thumb ? `url(${thumb})` : undefined }} />
                    <small>None</small>
                </button>
                {Object.entries(LOOK_NAMES as Record<string, string>).map(([look, label]) => {
                    const active = targets.length > 0 && targets.every((c) => c.color?.creative?.look === look);
                    return (
                        <button key={look} className={`ke-fx-card ${active ? 'is-active' : ''}`} onClick={() => applyLook(look)}>
                            <span className="ke-fx-card__thumb" style={{ backgroundImage: lookThumbs[look] ? `url(${lookThumbs[look]})` : thumb ? `url(${thumb})` : undefined }} />
                            <small>{label}</small>
                        </button>
                    );
                })}
            </div>

            <h4 className="ke-subhead">Effects</h4>
            <PresetSearch query={query} onQuery={setQuery} collection={collection} onCollection={setCollection} count={visible.length} />
            <div className="ke-fx-grid">
                {visible.map((fx) => {
                    const preview = effectPreview([{ type: fx.type, amount: 0.6 }], hover === fx.type ? time : 0.08, 0.15);
                    const active = targets.length > 0 && targets.every((c) => c.effects?.some((e) => e.type === fx.type));
                    return (
                        <button key={fx.type} className={`ke-fx-card ${active ? 'is-active' : ''}`} onClick={() => toggleEffect(fx.type)} title={fx.description} aria-pressed={active}
                            onMouseEnter={() => setHover(fx.type)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(fx.type)} onBlur={() => setHover(null)}>
                            <span className="ke-fx-card__thumb" style={{ backgroundImage: thumb ? `url(${thumb})` : undefined, filter: preview.filter || undefined, transform: preview.transform || undefined }}>
                                {preview.overlays.map((o, i) => (
                                    <i key={i} style={o} />
                                ))}
                            </span>
                            <small>{fx.label}</small>
                            {fx.exportOnly ? <span className="ke-render-badge">Export preview only</span> : null}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/** Small looping demo of a transition between two colour cards. */
function TransitionDemo({ type, playing }: { type: TransitionType; playing: boolean }) {
    const time = usePreviewTime(playing, 1.4);
    const p = playing ? Math.min(1, Math.max(0, time - 0.2)) : 0.5;
    const s = transitionStyles(type, p);
    return (
        <span className="ke-fx-card__thumb ke-tr-demo">
            <i className="ke-tr-demo__a" style={s.a}>
                A
            </i>
            <i className="ke-tr-demo__b" style={s.b}>
                B
            </i>
            {s.wash ? <i style={s.wash} /> : null}
        </span>
    );
}

/** Transitions between main-track clips. */
export function TransitionsView() {
    const { main, clips, chosen, hasSelection } = useTargets();
    const notify = useUiStore((s) => s.notify);
    const [duration, setDuration] = useState(DEFAULT_TRANSITION_SECONDS);
    const [hover, setHover] = useState<TransitionType | null>(null);
    const [query, setQuery] = useState('');
    const [collection, setCollection] = useState('all');
    const visible = TRANSITIONS.filter((t) => matchesPreset(t.type, `${t.label} ${t.description || ''}`, query, collection));
    const overlayClips = useTimelineStore((s) => s.tracks.filter((t) => t.type === 'media' && !t.isMain).reduce((n, t) => n + t.elements.length, 0));

    // Cuts: each clip that directly follows another. Selected clips → their incoming cut; else every cut.
    const cuts = clips.map((c, i) => ({ clip: c, prev: clips[i - 1] })).filter((x) => canTransition(x.prev, x.clip));
    // A selected clip means the cut into it, or the cut after it when it is the first clip.
    // If the selection touches no cut, every cut is used.
    const selectedCuts = cuts.filter((x) => chosen.includes(x.clip) || (chosen.includes(x.prev!) && !cuts.some((y) => y.clip === x.prev)));
    const targetCuts = hasSelection ? selectedCuts : cuts;

    const apply = (type: TransitionType | null) => {
        if (!main || !targetCuts.length) return notify(cuts.length ? 'Select a clip that directly follows another.' : 'Put two clips next to each other on the main track first.', 'error');
        const timeline = useTimelineStore.getState();
        timeline.pushHistory();
        for (const { clip } of targetCuts) timeline.updateElement(main.id, clip.id, { transitionIn: type ? { type, duration } : null }, false);
        notify(type ? `${TRANSITIONS.find((t) => t.type === type)?.label} on ${targetCuts.length} cut${targetCuts.length === 1 ? '' : 's'}.` : `Removed transitions from ${targetCuts.length} cut${targetCuts.length === 1 ? '' : 's'}.`, 'success');
    };

    return (
        <div className="ke-view">
            <div className="ke-view__head">
                <h3>Transitions</h3>
            </div>
            <p className="ke-note">
                {cuts.length
                    ? selectedCuts.length
                        ? `Applies to ${targetCuts.length} cut${targetCuts.length === 1 ? '' : 's'} at the selected clip${chosen.length === 1 ? '' : 's'}. Click empty timeline space to target every cut.`
                        : `Applies to all ${cuts.length} cut${cuts.length === 1 ? '' : 's'}. Select a clip to change only the cut into it.`
                    : 'Add at least two videos or images to the main track. Transitions go on the cuts between them.'}
            </p>
            {overlayClips > 0 ? (
                <div className="ke-alert">
                    <p>
                        {overlayClips} clip{overlayClips === 1 ? ' is' : 's are'} on an overlay track, so {overlayClips === 1 ? 'it has' : 'they have'} no cuts to transition on.
                    </p>
                    <button
                        className="ke-btn ke-btn--sm ke-btn--primary"
                        onClick={() => {
                            const n = useTimelineStore.getState().moveOverlaysToMain();
                            notify(`Moved ${n} clip${n === 1 ? '' : 's'} onto the main track. Pick a transition.`, 'success');
                        }}
                    >
                        Move them onto the main track
                    </button>
                </div>
            ) : null}
            <label className="ke-range">
                <span>Duration</span>
                <input type="range" min={0.2} max={2} step={0.1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
                <strong>{duration.toFixed(1)}s</strong>
            </label>
            <PresetSearch query={query} onQuery={setQuery} collection={collection} onCollection={setCollection} count={visible.length} />
            {TRANSITION_GROUPS.filter((group) => visible.some((t) => t.group === group)).map((group) => (
                <div key={group}>
                    <h4 className="ke-subhead">{group}</h4>
                    <div className="ke-fx-grid">
                        {visible.filter((t) => t.group === group).map((t) => (
                            <button key={t.type} className="ke-fx-card" title={t.description || t.label} onClick={() => apply(t.type)} onMouseEnter={() => setHover(t.type)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(t.type)} onBlur={() => setHover(null)}>
                                <TransitionDemo type={t.type} playing={hover === t.type} />
                                <small>{t.label}</small>
                            </button>
                        ))}
                    </div>
                </div>
            ))}
            {targetCuts.some((x) => x.clip.transitionIn) ? (
                <button className="ke-btn ke-btn--sm" onClick={() => apply(null)}>
                    Remove transitions
                </button>
            ) : null}
            <p className="ke-note">Transitions are centred on the cut, so the timeline length doesn’t change.</p>
        </div>
    );
}
