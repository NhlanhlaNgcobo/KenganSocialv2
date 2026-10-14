import { AlignCenter, AlignLeft, AlignRight, Bold, Eye, EyeOff, Italic, Loader2, Volume2, VolumeX, Wand2 } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { STABILIZE_PRESETS, useEnhanceStore } from '../../stores/enhance-store';
import { getCanvasSize } from '../../stores/project-store';
import { DEFAULT_TRANSFORM, fillScale, getTransform, isIdentity } from '../../lib/transform';
import { useUiStore } from '../../stores/ui-store';
import { FILTERS, FONT_FAMILIES, SPEED_PRESETS } from '../../constants';
import { formatTimecode, getElementLength } from '../../lib/time';
import { useMediaStore } from '../../stores/media-store';
import { usePlaybackStore } from '../../stores/playback-store';
import { useProjectStore } from '../../stores/project-store';
import { useTimelineStore } from '../../stores/timeline-store';
import type { ClipTransform, MediaElement, TextElement, TimelineTrack } from '../../types';

/** Edits made while dragging a slider or typing are grouped into one undo step. */
const beginEdit = () => useTimelineStore.getState().pushHistory();

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="ke-prop">
            <span className="ke-prop__label">{label}</span>
            <div className="ke-prop__control">{children}</div>
        </div>
    );
}

function Slider({ value, min, max, step, format, onChange }: { value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
    return (
        <div className="ke-slider">
            <input type="range" min={min} max={max} step={step} value={value} onPointerDown={beginEdit} onKeyDown={beginEdit} onChange={(e) => onChange(Number(e.target.value))} />
            <span className="ke-mono">{format(value)}</span>
        </div>
    );
}

function TextProperties({ track, el }: { track: TimelineTrack; el: TextElement }) {
    const update = (partial: Partial<TextElement>) => useTimelineStore.getState().updateElement(track.id, el.id, partial, false);
    const commit = (partial: Partial<TextElement>) => useTimelineStore.getState().updateElement(track.id, el.id, partial);

    return (
        <>
            <section className="ke-props-section">
                <h4>Text</h4>
                <textarea className="ke-input ke-textarea" rows={3} value={el.content} onFocus={beginEdit} onChange={(e) => update({ content: e.target.value, name: e.target.value.slice(0, 24) || 'Text' })} />
            </section>
            <section className="ke-props-section">
                <h4>Style</h4>
                <Row label="Font">
                    <select className="ke-select" value={el.fontFamily} onChange={(e) => commit({ fontFamily: e.target.value })}>
                        {FONT_FAMILIES.map((f) => (
                            <option key={f} value={f}>
                                {f}
                            </option>
                        ))}
                    </select>
                </Row>
                <Row label="Size">
                    <Slider value={el.fontSize} min={16} max={240} step={1} format={(v) => `${v}`} onChange={(v) => update({ fontSize: v })} />
                </Row>
                <Row label="Format">
                    <div className="ke-seg">
                        <button className={el.fontWeight === 'bold' ? 'is-active' : ''} onClick={() => commit({ fontWeight: el.fontWeight === 'bold' ? 'normal' : 'bold' })} title="Bold">
                            <Bold size={14} />
                        </button>
                        <button className={el.fontStyle === 'italic' ? 'is-active' : ''} onClick={() => commit({ fontStyle: el.fontStyle === 'italic' ? 'normal' : 'italic' })} title="Italic">
                            <Italic size={14} />
                        </button>
                        {(['left', 'center', 'right'] as const).map((a) => {
                            const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight;
                            return (
                                <button key={a} className={el.textAlign === a ? 'is-active' : ''} onClick={() => commit({ textAlign: a })} title={`Align ${a}`}>
                                    <Icon size={14} />
                                </button>
                            );
                        })}
                    </div>
                </Row>
                <Row label="Color">
                    <input type="color" className="ke-color" value={el.color} onPointerDown={beginEdit} onChange={(e) => update({ color: e.target.value })} />
                </Row>
                <Row label="Background">
                    <div className="ke-inline">
                        <input
                            type="color"
                            className="ke-color"
                            value={el.backgroundColor.startsWith('#') ? el.backgroundColor : '#000000'}
                            onPointerDown={beginEdit}
                            onChange={(e) => update({ backgroundColor: e.target.value })}
                        />
                        <button className={`ke-chip ${el.backgroundColor === 'transparent' ? 'is-active' : ''}`} onClick={() => commit({ backgroundColor: 'transparent' })}>
                            None
                        </button>
                    </div>
                </Row>
                <Row label="Opacity">
                    <Slider value={el.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ opacity: v })} />
                </Row>
            </section>
            <section className="ke-props-section">
                <h4>Transform</h4>
                <Row label="X">
                    <input className="ke-input ke-input--num" type="number" value={Math.round(el.x)} onFocus={beginEdit} onChange={(e) => update({ x: Number(e.target.value) || 0 })} />
                </Row>
                <Row label="Y">
                    <input className="ke-input ke-input--num" type="number" value={Math.round(el.y)} onFocus={beginEdit} onChange={(e) => update({ y: Number(e.target.value) || 0 })} />
                </Row>
                <Row label="Rotation">
                    <Slider value={el.rotation} min={-180} max={180} step={1} format={(v) => `${v}°`} onChange={(v) => update({ rotation: v })} />
                </Row>
                <button className="ke-btn ke-btn--sm" onClick={() => commit({ x: 0, y: 0, rotation: 0 })}>
                    Reset position
                </button>
                <p className="ke-note">Rotation is shown in preview only; exports keep text upright.</p>
            </section>
        </>
    );
}

function EnhanceSection({ mediaId }: { mediaId: string }) {
    const { plan } = useAuth();
    const { options, setOptions, run, cancel, runningMediaId, stage, progress, error } = useEnhanceStore();
    const ratio = useProjectStore((s) => s.ratio);
    const notify = useUiStore((s) => s.notify);
    const busy = runningMediaId !== null;
    const allowed = plan !== 'starter';

    const apply = async () => {
        try {
            notify(await run(mediaId), 'success');
        } catch (e) {
            if ((e as Error).message !== 'Cancelled') notify((e as Error).message, 'error');
        }
    };

    return (
        <section className="ke-props-section">
            <h4>Enhance</h4>
            <label className="ke-check">
                <input type="checkbox" checked={options.stabilize} disabled={busy} onChange={(e) => setOptions({ stabilize: e.target.checked })} />
                Stabilize shaky footage
            </label>
            {options.stabilize ? (
                <div className="ke-subpanel">
                    <div className="ke-chip-row">
                        {(
                            [
                                ['gentle', 'Gentle'],
                                ['handheld', 'Handheld'],
                                ['tripod', 'Tripod lock'],
                                ['noZoom', 'No zoom'],
                            ] as const
                        ).map(([key, label]) => {
                            const preset = STABILIZE_PRESETS[key];
                            const active = (Object.keys(preset) as (keyof typeof preset)[]).every((k) => options[k] === preset[k]);
                            return (
                                <button key={key} className={`ke-chip ${active ? 'is-active' : ''}`} disabled={busy} onClick={() => setOptions(preset)}>
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                    <Row label="Camera">
                        <div className="ke-seg ke-seg--text">
                            <button className={options.mode === 'smooth' ? 'is-active' : ''} disabled={busy} onClick={() => setOptions({ mode: 'smooth' })} title="Keeps intentional pans and walks, removes shake">
                                Smooth motion
                            </button>
                            <button className={options.mode === 'tripod' ? 'is-active' : ''} disabled={busy} onClick={() => setOptions({ mode: 'tripod' })} title="Holds the frame still wherever possible">
                                Tripod
                            </button>
                        </div>
                    </Row>
                    <Row label="Strength">
                        <div className="ke-slider">
                            <input type="range" min={0} max={100} step={5} value={options.strength} disabled={busy} onChange={(e) => setOptions({ strength: Number(e.target.value) })} />
                            <span className="ke-mono">{options.strength}%</span>
                        </div>
                    </Row>
                    <Row label="Edges">
                        <select className="ke-select" value={options.edgeFill} disabled={busy} onChange={(e) => setOptions({ edgeFill: e.target.value as typeof options.edgeFill })}>
                            <option value="zoom">Zoom in to hide edges</option>
                            <option value="blur">Fill edges with blur</option>
                            <option value="black">Show black edges</option>
                        </select>
                    </Row>
                    <Row label="Zoom">
                        <div className="ke-seg ke-seg--text">
                            <button className={options.zoomMode === 'auto' ? 'is-active' : ''} disabled={busy} onClick={() => setOptions({ zoomMode: 'auto' })}>
                                Auto
                            </button>
                            <button className={options.zoomMode === 'manual' ? 'is-active' : ''} disabled={busy} onClick={() => setOptions({ zoomMode: 'manual' })}>
                                Manual
                            </button>
                        </div>
                    </Row>
                    {options.zoomMode === 'manual' ? (
                        <Row label="Zoom level">
                            <div className="ke-slider">
                                <input type="range" min={1} max={1.5} step={0.01} value={options.zoom} disabled={busy} onChange={(e) => setOptions({ zoom: Number(e.target.value) })} />
                                <span className="ke-mono">{Math.round(options.zoom * 100)}%</span>
                            </div>
                        </Row>
                    ) : null}
                    <label className="ke-check">
                        <input type="checkbox" checked={options.correctRotation} disabled={busy} onChange={(e) => setOptions({ correctRotation: e.target.checked })} />
                        Straighten rotation wobble
                    </label>
                    <p className="ke-note">
                        {options.edgeFill === 'zoom'
                            ? options.zoomMode === 'auto'
                                ? `Auto zoom scales with strength (about ${Math.round((0.02 + 0.23 * options.strength / 100) * 100)}% at this setting).`
                                : options.zoom < 1.03
                                    ? 'Little zoom leaves little room to move the frame, so stabilization will be mild.'
                                    : 'Higher zoom allows stronger stabilization but crops more of the picture.'
                            : 'Nothing is cropped; moving edges are filled instead.'}
                    </p>
                </div>
            ) : null}
            <label className="ke-check">
                <input type="checkbox" checked={options.autoframe} disabled={busy} onChange={(e) => setOptions({ autoframe: e.target.checked })} />
                Auto-frame to {ratio} (follows faces and motion)
            </label>

            {busy && runningMediaId === mediaId ? (
                <div className="ke-progress-card">
                    <div className="ke-progress-card__row">
                        <Loader2 size={14} className="ke-spin" />
                        <span>{stage}…</span>
                        <button className="ke-btn ke-btn--ghost ke-btn--sm" onClick={cancel}>
                            Cancel
                        </button>
                    </div>
                    <div className="ke-bar">
                        <div style={{ width: `${progress}%` }} />
                    </div>
                </div>
            ) : (
                <button className="ke-btn ke-btn--primary ke-btn--sm" onClick={apply} disabled={busy || !allowed || (!options.stabilize && !options.autoframe)}>
                    <Wand2 size={13} /> Apply
                </button>
            )}
            {!allowed ? <p className="ke-note">Stabilize and auto-frame need the Nano plan or higher.</p> : null}
            {error && !busy ? <div className="ke-alert ke-alert--error">{error}</div> : null}
            <p className="ke-note">Creates a new version of this video and swaps it in on every clip that uses it (Ctrl+Z to undo).</p>
        </section>
    );
}

function TransformSection({ track, el }: { track: TimelineTrack; el: MediaElement }) {
    const media = useMediaStore((s) => s.items.find((i) => i.id === el.mediaId));
    const ratio = useProjectStore((s) => s.ratio);
    const canvas = getCanvasSize(ratio);
    const t = getTransform(el);
    const set = (partial: Partial<ClipTransform>, record = false) =>
        useTimelineStore.getState().updateElement(track.id, el.id, { transform: { ...t, ...partial } }, record);
    const fill = fillScale(media?.width || 0, media?.height || 0, canvas.width, canvas.height);
    const isFill = Math.abs(t.scale - fill) < 0.005 && fill !== 1;

    return (
        <section className="ke-props-section">
            <h4>Transform</h4>
            <div className="ke-chip-row">
                <button className={`ke-chip ${t.scale === 1 && t.x === 0 && t.y === 0 ? 'is-active' : ''}`} onClick={() => set({ scale: 1, x: 0, y: 0 }, true)} title="Show the whole clip">
                    Fit
                </button>
                <button className={`ke-chip ${isFill ? 'is-active' : ''}`} onClick={() => set({ scale: fill, x: 0, y: 0 }, true)} disabled={fill === 1} title="Zoom to cover the canvas (no bars)">
                    Fill frame
                </button>
                <button className="ke-chip" onClick={() => set({ ...DEFAULT_TRANSFORM }, true)} disabled={isIdentity(t)}>
                    Reset
                </button>
            </div>
            <Row label="Zoom">
                <Slider value={t.scale} min={0.1} max={4} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ scale: v })} />
            </Row>
            <Row label="Position">
                <div className="ke-inline">
                    <input className="ke-input ke-input--num" type="number" value={Math.round(t.x)} onFocus={beginEdit} onChange={(e) => set({ x: Number(e.target.value) || 0 })} title="X (px from centre)" />
                    <input className="ke-input ke-input--num" type="number" value={Math.round(t.y)} onFocus={beginEdit} onChange={(e) => set({ y: Number(e.target.value) || 0 })} title="Y (px from centre)" />
                </div>
            </Row>
            <Row label="Rotation">
                <Slider value={t.rotation} min={-180} max={180} step={1} format={(v) => `${v}°`} onChange={(v) => set({ rotation: v })} />
            </Row>
            <Row label="Flip">
                <div className="ke-chip-row">
                    <button className={`ke-chip ${t.flipH ? 'is-active' : ''}`} onClick={() => set({ flipH: !t.flipH }, true)}>Horizontal</button>
                    <button className={`ke-chip ${t.flipV ? 'is-active' : ''}`} onClick={() => set({ flipV: !t.flipV }, true)}>Vertical</button>
                </div>
            </Row>
            {track.isMain ? (
                <>
                    <Row label="Animate">
                        <select className="ke-select" value={t.animation} onChange={(e) => set({ animation: e.target.value as ClipTransform['animation'] }, true)}>
                            <option value="none">No animation</option>
                            <option value="zoom-in">Slow zoom in</option>
                            <option value="zoom-out">Slow zoom out</option>
                        </select>
                    </Row>
                    {t.animation !== 'none' ? (
                        <Row label="Amount">
                            <Slider value={t.animationAmount} min={0.05} max={0.6} step={0.01} format={(v) => `+${Math.round(v * 100)}%`} onChange={(v) => set({ animationAmount: v })} />
                        </Row>
                    ) : null}
                </>
            ) : (
                <p className="ke-note">Zoom animation is available on the main track. On this track, zoom below 100% makes a picture-in-picture.</p>
            )}
        </section>
    );
}

function MediaProperties({ track, el }: { track: TimelineTrack; el: MediaElement }) {
    const media = useMediaStore((s) => s.items.find((i) => i.id === el.mediaId));
    const update = (partial: Partial<MediaElement>) => useTimelineStore.getState().updateElement(track.id, el.id, partial, false);
    const commit = (partial: Partial<MediaElement>) => useTimelineStore.getState().updateElement(track.id, el.id, partial);
    const hasAudio = media?.type !== 'image';
    const hasPicture = media?.type !== 'audio';

    return (
        <>
            <section className="ke-props-section">
                <h4>Details</h4>
                <Row label="Name">
                    <input className="ke-input" value={el.name} onFocus={beginEdit} onChange={(e) => update({ name: e.target.value })} />
                </Row>
                {media && media.type !== 'image' ? (
                    <Row label="Source">
                        <span className="ke-mono ke-muted">
                            {formatTimecode(el.trimStart)} → {formatTimecode(el.duration - el.trimEnd)}
                        </span>
                    </Row>
                ) : null}
            </section>

            {hasAudio ? (
                <section className="ke-props-section">
                    <h4>Audio</h4>
                    <Row label="Volume">
                        <Slider value={el.volume ?? 1} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ volume: v })} />
                    </Row>
                    <Row label="Mute">
                        <button className={`ke-chip ${el.muted ? 'is-active' : ''}`} onClick={() => commit({ muted: !el.muted })}>
                            {el.muted ? <VolumeX size={13} /> : <Volume2 size={13} />} {el.muted ? 'Muted' : 'On'}
                        </button>
                    </Row>
                </section>
            ) : null}

            {media?.type !== 'image' ? (
                <section className="ke-props-section">
                    <h4>Speed</h4>
                    <div className="ke-chip-row">
                        {SPEED_PRESETS.map((s) => (
                            <button key={s} className={`ke-chip ${(el.speed || 1) === s ? 'is-active' : ''}`} onClick={() => commit({ speed: s })}>
                                {s}x
                            </button>
                        ))}
                    </div>
                </section>
            ) : null}

            {hasPicture ? <TransformSection track={track} el={el} /> : null}

            {media?.type === 'video' ? <EnhanceSection mediaId={el.mediaId} /> : null}

            {hasPicture ? (
                <section className="ke-props-section">
                    <h4>Filter</h4>
                    <div className="ke-chip-row">
                        {FILTERS.map((f) => (
                            <button key={f} className={`ke-chip ${(el.filter || 'none') === f ? 'is-active' : ''}`} onClick={() => commit({ filter: f })}>
                                {f}
                            </button>
                        ))}
                    </div>
                </section>
            ) : null}
        </>
    );
}

export function PropertiesPanel() {
    const selected = useTimelineStore((s) => s.selected);
    const tracks = useTimelineStore((s) => s.tracks);
    const totalDuration = useTimelineStore((s) => s.getTotalDuration());
    const { name, ratio, fps } = useProjectStore();

    const resolved = selected
        .map(({ trackId, elementId }) => {
            const track = tracks.find((t) => t.id === trackId);
            const element = track?.elements.find((e) => e.id === elementId);
            return track && element ? { track, element } : null;
        })
        .filter(Boolean) as { track: TimelineTrack; element: TextElement | MediaElement }[];

    if (resolved.length === 0) {
        return (
            <div className="ke-panel ke-props">
                <div className="ke-props__head">
                    <h3>Properties</h3>
                </div>
                <div className="ke-props__body">
                    <section className="ke-props-section">
                        <h4>Project</h4>
                        <Row label="Name">
                            <span>{name}</span>
                        </Row>
                        <Row label="Canvas">
                            <span>{ratio}</span>
                        </Row>
                        <Row label="Frame rate">
                            <span>{fps} fps</span>
                        </Row>
                        <Row label="Length">
                            <span className="ke-mono">{formatTimecode(totalDuration, fps)}</span>
                        </Row>
                    </section>
                    <p className="ke-note">Select a clip or text on the timeline to edit it.</p>
                </div>
            </div>
        );
    }

    if (resolved.length > 1) {
        return (
            <div className="ke-panel ke-props">
                <div className="ke-props__head">
                    <h3>{resolved.length} items selected</h3>
                </div>
                <div className="ke-props__body">
                    <p className="ke-note">Use the timeline toolbar to split, duplicate or delete the selection.</p>
                </div>
            </div>
        );
    }

    const { track, element } = resolved[0];
    const seek = usePlaybackStore.getState().seek;
    const media = element.type === 'media' ? useMediaStore.getState().getItem(element.mediaId) : undefined;

    return (
        <div className="ke-panel ke-props">
            <div className="ke-props__head">
                <h3>{element.type === 'text' ? 'Text' : `${media?.type === 'audio' ? 'Audio' : media?.type === 'image' ? 'Image' : 'Video'} clip`}</h3>
                <button
                    className="ke-icon-btn"
                    title={element.hidden ? 'Show' : 'Hide'}
                    onClick={() => useTimelineStore.getState().toggleElementHidden(track.id, element.id)}
                >
                    {element.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
            </div>
            <div className="ke-props__body">
                {element.type === 'text' ? <TextProperties track={track} el={element} /> : <MediaProperties track={track} el={element} />}
                <section className="ke-props-section">
                    <h4>Timing</h4>
                    <Row label="Start">
                        <button className="ke-link ke-mono" onClick={() => seek(element.startTime)}>
                            {formatTimecode(element.startTime, fps)}
                        </button>
                    </Row>
                    <Row label="Length">
                        <span className="ke-mono">{formatTimecode(getElementLength(element), fps)}</span>
                    </Row>
                </section>
            </div>
        </div>
    );
}
