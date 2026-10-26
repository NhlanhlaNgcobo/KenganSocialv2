import { CAMERA_MOTIONS } from '../../lib/camera-motion.js';
import { useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Eye, EyeOff, Italic, Layers, Loader2, Pipette, Volume2, VolumeX, Wand2 } from 'lucide-react';
import { defaultLayout, layoutTransform, OVERLAY_LAYOUTS, OVERLAY_SIZES, type OverlayAnchor, type OverlaySize } from '../../lib/overlay-layouts';
import { DEFAULT_KEY, KEY_PRESETS } from '../../lib/chroma-key';
import { useAuth } from '../../../context/AuthContext';
import { CLEANUP_PRESETS, hasCleanup, NO_CLEANUP, STABILIZE_PRESETS, useEnhanceStore } from '../../stores/enhance-store';
import type { CleanupOptions } from '../../lib/editor-api';
import { getCanvasSize } from '../../stores/project-store';
import { DEFAULT_TRANSFORM, fillScale, getTransform, isIdentity } from '../../lib/transform';
import { useUiStore } from '../../stores/ui-store';
import { FONT_FAMILIES, LOOK_LABELS, SPEED_PRESETS } from '../../constants';
import { canTransition, DEFAULT_TRANSITION_SECONDS, EFFECTS, TRANSITION_GROUPS, TRANSITIONS } from '../../lib/fx';
import { ColorPanel, colorFromLegacy } from './ColorPanel';
import { KeyframePanel } from './KeyframePanel';
import { BeatPanel } from './BeatPanel';
import { LOOK_NAMES } from '../../lib/color-pipeline.js';
import { formatTimecode, getElementLength } from '../../lib/time';
import { useMediaStore } from '../../stores/media-store';
import { usePlaybackStore } from '../../stores/playback-store';
import { useProjectStore } from '../../stores/project-store';
import { useTimelineStore } from '../../stores/timeline-store';
import type { ChromaKey, ClipEffect, ClipTransform, EffectType, MediaElement, TextAnimation, TextElement, TimelineTrack, TransitionType } from '../../types';
import { CAPTION_MOTIONS, TEXT_ANIMATIONS, captionTokens } from '../../lib/caption-motion.js';

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
                <textarea className="ke-input ke-textarea" rows={3} value={el.content} onFocus={beginEdit} onChange={(e) => update({ content: e.target.value, rawContent: e.target.value, name: e.target.value.slice(0, 24) || 'Text' })} />
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
                <Row label="Outline">
                    <div className="ke-inline">
                        <input
                            type="color"
                            className="ke-color"
                            value={el.strokeColor && el.strokeColor.startsWith('#') ? el.strokeColor : '#000000'}
                            onPointerDown={beginEdit}
                            onChange={(e) => update({ strokeColor: e.target.value, strokeWidth: el.strokeWidth || Math.max(2, Math.round(el.fontSize * 0.08)) })}
                        />
                        <button className={`ke-chip ${!el.strokeWidth ? 'is-active' : ''}`} onClick={() => commit({ strokeWidth: 0 })}>
                            None
                        </button>
                    </div>
                </Row>
                {el.strokeWidth ? (
                    <Row label="Outline width">
                        <Slider value={el.strokeWidth} min={1} max={24} step={1} format={(v) => `${v}`} onChange={(v) => update({ strokeWidth: v })} />
                    </Row>
                ) : null}
                <Row label="Animation">
                    <div className="ke-seg ke-seg--text">
                        {(['none', 'fade', 'pop'] as TextAnimation[]).map((a) => (
                            <button key={a} className={(el.animation || 'none') === a ? 'is-active' : ''} onClick={() => commit({ animation: a })}>
                                {a === 'none' ? 'None' : a === 'fade' ? 'Fade' : 'Pop'}
                            </button>
                        ))}
                    </div>
                </Row>
                {!el.isCaption ? <Row label="Title motion"><select className="ke-select" value={el.captionMotion || ''} onChange={(e) => commit({ captionMotion: e.target.value || undefined, animation: 'none' })}><option value="">None</option>{TEXT_ANIMATIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></Row> : null}
                {el.isCaption ? <>
                    <Row label="Word motion">
                        <select className="ke-select" value={el.captionMotion || ''} onChange={(e) => commit({ captionMotion: e.target.value || undefined, animation: 'none' })}>
                            <option value="">None</option>
                            {CAPTION_MOTIONS.map((mode) => <option key={mode} value={mode}>{mode.replaceAll('-', ' ')}</option>)}
                        </select>
                    </Row>
                    <Row label="Accent">
                        <input type="color" className="ke-color" aria-label="Caption accent colour" value={el.accentColor || '#a3e635'} onFocus={beginEdit} onChange={(e) => update({ accentColor: e.target.value })} />
                    </Row>
                    <details className="ke-word-timing">
                        <summary>Word timing · seconds</summary>
                        <p className="ke-note">Times are relative to the start of this caption, before trimming.</p>
                        {captionTokens(el.content, el.captionWords, el.duration).map((word, i, words) => <div className="ke-word-timing__row" key={i}>
                            <span>{word.text}</span>
                            {(['start', 'end'] as const).map((edge) => <input key={edge} type="number" className="ke-input" min={0} max={el.duration} step={0.01}
                                aria-label={`${word.text} ${edge} time`} value={Number(word[edge].toFixed(2))} onFocus={beginEdit}
                                onChange={(e) => {
                                    const value = Math.max(0, Math.min(el.duration, Number(e.target.value) || 0));
                                    update({ captionWords: words.map((w, n) => n === i ? { ...w, [edge]: edge === 'start' ? Math.min(value, w.end) : Math.max(value, w.start) } : w) });
                                }} />)}
                        </div>)}
                    </details>
                </> : null}
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
            </section>
            <KeyframePanel track={track} el={el} />
        </>
    );
}

function CleanupControls({ cleanup, setCleanup, busy, audioOnly }: { cleanup: CleanupOptions; setCleanup: (c: CleanupOptions) => void; busy: boolean; audioOnly: boolean }) {
    const v = cleanup.video;
    const a = cleanup.audio;
    const setV = (p: Partial<CleanupOptions['video']>) => setCleanup({ ...cleanup, video: { ...v, ...p } });
    const setA = (p: Partial<CleanupOptions['audio']>) => setCleanup({ ...cleanup, audio: { ...a, ...p } });
    const matches = (preset: CleanupOptions) => JSON.stringify(preset) === JSON.stringify(cleanup);
    return (
        <div className="ke-subpanel">
            <div className="ke-chip-row">
                {Object.entries(CLEANUP_PRESETS)
                    .filter(([, preset]) => !audioOnly || preset.value.audio.noise !== 'off')
                    .map(([key, preset]) => (
                        <button key={key} className={`ke-chip ${matches(preset.value) ? 'is-active' : ''}`} disabled={busy} title={preset.hint} onClick={() => setCleanup(preset.value)}>
                            {preset.label}
                        </button>
                    ))}
                {hasCleanup(cleanup) ? (
                    <button className="ke-chip" disabled={busy} onClick={() => setCleanup(NO_CLEANUP)}>
                        Clear
                    </button>
                ) : null}
            </div>
            {!audioOnly ? (
                <>
                    <h5 className="ke-subhead">Picture</h5>
                    <Row label="Denoise">
                        <div className="ke-seg ke-seg--text">
                            {(['off', 'light', 'medium', 'strong'] as const).map((d) => (
                                <button key={d} className={v.denoise === d ? 'is-active' : ''} disabled={busy} onClick={() => setV({ denoise: d })}>
                                    {d === 'off' ? 'Off' : d[0].toUpperCase() + d.slice(1)}
                                </button>
                            ))}
                        </div>
                    </Row>
                    <Row label="Sharpen">
                        <div className="ke-slider">
                            <input type="range" min={0} max={1} step={0.05} value={v.sharpen} disabled={busy} onChange={(e) => setV({ sharpen: Number(e.target.value) })} />
                            <span className="ke-mono">{Math.round(v.sharpen * 100)}%</span>
                        </div>
                    </Row>
                    <label className="ke-check">
                        <input type="checkbox" checked={v.autoLevels} disabled={busy} onChange={(e) => setV({ autoLevels: e.target.checked })} /> Auto levels (fix flat, washed-out footage)
                    </label>
                    <label className="ke-check">
                        <input type="checkbox" checked={v.deband} disabled={busy} onChange={(e) => setV({ deband: e.target.checked })} /> Smooth colour banding (skies, gradients)
                    </label>
                    <label className="ke-check">
                        <input type="checkbox" checked={v.deflicker} disabled={busy} onChange={(e) => setV({ deflicker: e.target.checked })} /> Remove flicker (lights, timelapse)
                    </label>
                </>
            ) : null}
            <h5 className="ke-subhead">Sound</h5>
            <Row label="Noise">
                <select className="ke-select" value={a.noise} disabled={busy} onChange={(e) => setA({ noise: e.target.value as CleanupOptions['audio']['noise'] })}>
                    <option value="off">Off</option>
                    <option value="voice">Voice (AI, RNNoise)</option>
                    <option value="voice-laughter">Voice + laughter (AI)</option>
                    <option value="general">General sound (AI)</option>
                    <option value="fft">Steady hiss (spectral)</option>
                </select>
            </Row>
            {a.noise !== 'off' ? (
                <Row label="Strength">
                    <div className="ke-slider">
                        <input type="range" min={0.1} max={1} step={0.05} value={a.strength} disabled={busy} onChange={(e) => setA({ strength: Number(e.target.value) })} />
                        <span className="ke-mono">{Math.round(a.strength * 100)}%</span>
                    </div>
                </Row>
            ) : null}
            <Row label="Hum">
                <div className="ke-seg ke-seg--text">
                    {(['off', '50', '60'] as const).map((h) => (
                        <button key={h} className={a.hum === h ? 'is-active' : ''} disabled={busy} onClick={() => setA({ hum: h })} title={h === '50' ? 'Mains hum in South Africa, Europe, Africa' : h === '60' ? 'Mains hum in the Americas' : ''}>
                            {h === 'off' ? 'Off' : `${h} Hz`}
                        </button>
                    ))}
                </div>
            </Row>
            <Row label="Loudness">
                <select className="ke-select" value={a.loudness} disabled={busy} onChange={(e) => setA({ loudness: e.target.value as CleanupOptions['audio']['loudness'] })}>
                    <option value="off">Leave as is</option>
                    <option value="social">Social video (-14 LUFS)</option>
                    <option value="podcast">Podcast (-16 LUFS)</option>
                </select>
            </Row>
            <label className="ke-check">
                <input type="checkbox" checked={a.clarity} disabled={busy} onChange={(e) => setA({ clarity: e.target.checked })} /> Voice clarity (cut rumble, lift presence, even out levels)
            </label>
            <label className="ke-check">
                <input type="checkbox" checked={a.deess} disabled={busy} onChange={(e) => setA({ deess: e.target.checked })} /> Soften harsh “s” sounds
            </label>
            <label className="ke-check">
                <input type="checkbox" checked={a.declick} disabled={busy} onChange={(e) => setA({ declick: e.target.checked })} /> Remove clicks and pops
            </label>
        </div>
    );
}

function EnhanceSection({ mediaId, audioOnly = false }: { mediaId: string; audioOnly?: boolean }) {
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
            <h4>{audioOnly ? 'Clean up sound' : 'Enhance & clean up'}</h4>
            <CleanupControls cleanup={options.cleanup} setCleanup={(cleanup) => setOptions({ cleanup })} busy={busy} audioOnly={audioOnly} />
            {!audioOnly ? (
                <>
            <h5 className="ke-subhead">Camera</h5>
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
                </>
            ) : null}

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
                <button
                    className="ke-btn ke-btn--primary ke-btn--sm"
                    onClick={apply}
                    disabled={busy || !allowed || (audioOnly ? !hasCleanup(options.cleanup) : !options.stabilize && !options.autoframe && !hasCleanup(options.cleanup))}
                >
                    <Wand2 size={13} /> Apply
                </button>
            )}
            {!allowed ? <p className="ke-note">Enhance and clean-up need the Nano plan or higher.</p> : null}
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
        <>
        <OverlaySection track={track} el={el} />
        {!track.isMain && media && media.type !== 'audio' ? <ChromaKeySection track={track} el={el} isVideo={media.type === 'video'} /> : null}
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
                            {CAMERA_MOTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
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
        </>
    );
}

/**
 * Picture-in-picture: layouts and size for a clip on an overlay track, or a button that moves a
 * main-track clip onto one. Dragging the overlay on the preview moves and resizes it freely.
 */
function OverlaySection({ track, el }: { track: TimelineTrack; el: MediaElement }) {
    const media = useMediaStore((s) => s.items.find((i) => i.id === el.mediaId));
    const ratio = useProjectStore((s) => s.ratio);
    const canvas = getCanvasSize(ratio);
    const [size, setSize] = useState<OverlaySize>('medium');
    const notify = useUiStore((s) => s.notify);
    if (!media || media.type === 'audio') return null;
    const t = getTransform(el);

    if (track.isMain) {
        return (
            <section className="ke-props-section">
                <h4>Overlay</h4>
                <button
                    className="ke-btn ke-btn--block"
                    onClick={() => {
                        const placed = useTimelineStore.getState().makeOverlay(track.id, el.id, layoutTransform(defaultLayout(media, canvas), 'medium', media, canvas, t));
                        if (!placed) notify('Could not move this clip to an overlay track.', 'error');
                    }}
                >
                    <Layers size={15} /> Make overlay
                </button>
                <p className="ke-note">Moves this clip on top of the main video as a picture-in-picture, like a reaction or a presenter in front of a screen.</p>
            </section>
        );
    }

    const apply = (anchor: OverlayAnchor, nextSize = size) =>
        useTimelineStore.getState().updateElement(track.id, el.id, { transform: layoutTransform(anchor, nextSize, media, canvas, t) }, true);
    return (
        <section className="ke-props-section">
            <h4>Overlay layout</h4>
            <div className="ke-overlay-grid" role="group" aria-label="Overlay layout">
                {OVERLAY_LAYOUTS.map((l) => (
                    <button key={l.id} className={`ke-overlay-pick ke-overlay-pick--${l.id}`} onClick={() => apply(l.id)} title={l.hint}>
                        <span className="ke-overlay-pick__frame" aria-hidden="true">
                            <i />
                        </span>
                        <small>{l.label}</small>
                    </button>
                ))}
            </div>
            <Row label="Size">
                <div className="ke-seg ke-seg--text">
                    {OVERLAY_SIZES.map((s) => (
                        <button key={s.id} className={size === s.id ? 'is-active' : ''} onClick={() => setSize(s.id)}>
                            {s.label}
                        </button>
                    ))}
                </div>
            </Row>
            <p className="ke-note">Pick a size, then a layout to place it, or drag it on the preview. Pull the corner handle to resize.</p>
        </section>
    );
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

/** Green/blue screen removal for overlay clips (lib/chroma-key.ts; preview and export match). */
function ChromaKeySection({ track, el, isVideo }: { track: TimelineTrack; el: MediaElement; isVideo: boolean }) {
    const key = el.chromaKey || null;
    const running = useEnhanceStore((s) => (s.runningMediaId === el.mediaId ? s : null));
    const busy = useEnhanceStore((s) => !!s.runningMediaId);
    const notify = useUiStore((s) => s.notify);
    const removeWithAi = async () => {
        try {
            notify(await useEnhanceStore.getState().removeBackground(track.id, el.id), 'success');
        } catch (error) {
            if ((error as Error).message !== 'Cancelled') notify((error as Error).message, 'error');
        }
    };
    const commit = (next: ChromaKey | null) => useTimelineStore.getState().updateElement(track.id, el.id, { chromaKey: next });
    const update = (partial: Partial<ChromaKey>) => key && useTimelineStore.getState().updateElement(track.id, el.id, { chromaKey: { ...key, ...partial } }, false);
    const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
    const pick = async () => {
        try {
            const { sRGBHex } = await new EyeDropper!().open();
            commit({ ...(key || DEFAULT_KEY), color: sRGBHex });
        } catch {
            // Cancelled with Escape.
        }
    };
    return (
        <section className="ke-props-section">
            <h4>Green screen</h4>
            {isVideo ? (
                running ? (
                    <div className="ke-bg-remove">
                        <Loader2 size={14} className="ke-spin" />
                        <span>
                            {running.stage} {running.progress ? `${running.progress}%` : ''}
                        </span>
                        <button className="ke-btn ke-btn--sm" onClick={() => useEnhanceStore.getState().cancel()}>
                            Cancel
                        </button>
                    </div>
                ) : (
                    <button className="ke-btn ke-btn--block" onClick={removeWithAi} disabled={busy} title="No green screen? AI cuts out the people and removes everything behind them.">
                        <Wand2 size={15} /> Remove background with AI
                    </button>
                )
            ) : null}
            <div className="ke-chip-row">
                <button className={`ke-chip ${!key ? 'is-active' : ''}`} onClick={() => commit(null)}>
                    Off
                </button>
                {KEY_PRESETS.map((p) => (
                    <button key={p.id} className={`ke-chip ${key?.color.toLowerCase() === p.color ? 'is-active' : ''}`} onClick={() => commit({ ...(key || DEFAULT_KEY), color: p.color })}>
                        {p.label}
                    </button>
                ))}
            </div>
            {key ? (
                <>
                    <Row label="Key colour">
                        <div className="ke-key-colour">
                            <input type="color" className="ke-color" aria-label="Key colour" value={key.color} onPointerDown={beginEdit} onChange={(e) => update({ color: e.target.value })} />
                            {EyeDropper ? (
                                <button className="ke-btn ke-btn--sm" onClick={pick} title="Click the screen colour in the preview">
                                    <Pipette size={13} /> Pick
                                </button>
                            ) : null}
                        </div>
                    </Row>
                    <Row label="Strength">
                        <Slider value={key.similarity} min={0.01} max={0.5} step={0.005} format={(v) => `${Math.round(v * 200)}`} onChange={(v) => update({ similarity: v })} />
                    </Row>
                    <Row label="Softness">
                        <Slider value={key.blend} min={0} max={0.3} step={0.005} format={(v) => `${Math.round((v / 0.3) * 100)}`} onChange={(v) => update({ blend: v })} />
                    </Row>
                    <Row label="Spill">
                        <Slider value={key.spill} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ spill: v })} />
                    </Row>
                    <p className="ke-note">Raise Strength until the screen disappears, add Softness for smoother edges, and Spill to remove the green glow on hair and edges.</p>
                </>
            ) : (
                <p className="ke-note">Filmed in front of a green or blue screen? Turn it on to remove the screen so the video behind shows through. No screen? Use Remove background with AI (works on people; takes a little while).</p>
            )}
        </section>
    );
}

function EffectsSection({ el, commit, update }: { el: MediaElement; commit: (p: Partial<MediaElement>) => void; update: (p: Partial<MediaElement>) => void }) {
    const effects = el.effects || [];
    const has = (type: EffectType) => effects.some((e) => e.type === type);
    const toggle = (type: EffectType) => {
        if (!has(type) && effects.length >= 6) return useUiStore.getState().notify('Remove an effect before adding another. The limit is six per clip.', 'error');
        commit({ effects: has(type) ? effects.filter((e) => e.type !== type) : [...effects, { type, amount: 0.5 }] });
    };
    const setAmount = (type: EffectType, amount: number) => update({ effects: effects.map((e): ClipEffect => (e.type === type ? { ...e, amount } : e)) });
    return (
        <section className="ke-props-section">
            <h4>Effects</h4>
            <div className="ke-chip-row">
                {EFFECTS.map((fx) => (
                    <button key={fx.type} className={`ke-chip ${has(fx.type) ? 'is-active' : ''}`} onClick={() => toggle(fx.type)} title={fx.description}>
                        {fx.label}
                    </button>
                ))}
            </div>
            {effects.map((e, index) => {
                const info = EFFECTS.find((f) => f.type === e.type);
                return (
                    <div key={e.type} className="ke-effect-controls">
                        <Row label={info?.label || e.type}>
                            <Slider value={e.amount} min={0} max={1} step={0.02} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setAmount(e.type, v)} />
                        </Row>
                        <div className="ke-inline">
                            <button className="ke-chip" aria-pressed={e.enabled !== false} onClick={() => commit({ effects: effects.map((fx, n) => n === index ? { ...fx, enabled: fx.enabled === false } : fx) })}>{e.enabled === false ? 'Bypassed' : 'Enabled'}</button>
                            <button className="ke-chip" disabled={index === 0} aria-label={`Move ${info?.label} earlier`} onClick={() => { const next = [...effects]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; commit({ effects: next }); }}>↑</button>
                            <button className="ke-chip" disabled={index === effects.length - 1} aria-label={`Move ${info?.label} later`} onClick={() => { const next = [...effects]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; commit({ effects: next }); }}>↓</button>
                            <button className="ke-chip" onClick={() => commit({ effects: effects.filter((_, n) => n !== index) })}>Remove</button>
                        </div>
                    </div>
                );
            })}
            {effects.some((e) => EFFECTS.find((f) => f.type === e.type)?.exportOnly) ? <p className="ke-note">Export preview only: {effects.filter((e) => EFFECTS.find((f) => f.type === e.type)?.exportOnly).map((e) => EFFECTS.find((f) => f.type === e.type)?.label).join(', ')}.</p> : null}
            <p className="ke-note">Effects render on main-track clips. Up to 6 per clip.</p>
        </section>
    );
}

function TransitionSection({ track, el }: { track: TimelineTrack; el: MediaElement }) {
    const clips = (track.elements.filter((e) => e.type === 'media') as MediaElement[]).sort((a, b) => a.startTime - b.startTime);
    const prev = clips[clips.indexOf(el) - 1];
    const commit = (partial: Partial<MediaElement>) => useTimelineStore.getState().updateElement(track.id, el.id, partial);
    const update = (partial: Partial<MediaElement>) => useTimelineStore.getState().updateElement(track.id, el.id, partial, false);
    const current = el.transitionIn;
    const setType = (type: TransitionType | null) => commit({ transitionIn: type ? { type, duration: current?.duration || DEFAULT_TRANSITION_SECONDS } : null });
    const applyAll = () => {
        if (!current) return;
        const timeline = useTimelineStore.getState();
        timeline.pushHistory();
        clips.forEach((c, i) => i > 0 && canTransition(clips[i - 1], c) && timeline.updateElement(track.id, c.id, { transitionIn: current }, false));
    };
    const next = clips[clips.indexOf(el) + 1];
    if (!prev) {
        return next ? (
            <section className="ke-props-section">
                <h4>Transition in</h4>
                <p className="ke-note">This is the first clip. Select the next clip (or use the Transitions tab) to set the transition between them.</p>
            </section>
        ) : null;
    }
    const joined = canTransition(prev, el);
    return (
        <section className="ke-props-section">
            <h4>Transition in</h4>
            {!joined ? (
                <p className="ke-note">Move this clip so it starts where the previous clip ends to add a transition.</p>
            ) : (
                <>
                    <select className="ke-select" value={current?.type || ''} onChange={(e) => setType((e.target.value as TransitionType) || null)}>
                        <option value="">None (hard cut)</option>
                        {TRANSITION_GROUPS.map((group) => (
                            <optgroup key={group} label={group}>
                                {TRANSITIONS.filter((t) => t.group === group).map((t) => (
                                    <option key={t.type} value={t.type}>
                                        {t.label}
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                    {current ? (
                        <>
                            <Row label="Duration">
                                <Slider value={current.duration} min={0.2} max={2} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(v) => update({ transitionIn: { ...current, duration: v } })} />
                            </Row>
                            <button className="ke-btn ke-btn--sm" onClick={applyAll}>
                                Use on every cut
                            </button>
                        </>
                    ) : null}
                    <p className="ke-note">Centred on the cut; your timeline length stays the same.</p>
                </>
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

            {hasAudio && media ? <BeatPanel track={track} el={el} /> : null}

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

            {hasPicture ? <KeyframePanel track={track} el={el} /> : null}

            {media?.type === 'video' || media?.type === 'audio' ? <EnhanceSection mediaId={el.mediaId} audioOnly={media.type === 'audio'} /> : null}

            {track.isMain && hasPicture ? <TransitionSection track={track} el={el} /> : null}

            {hasPicture && el.filter && el.filter !== 'none' ? (
                <section className="ke-props-section">
                    <h4>Legacy look</h4>
                    <p className="ke-note">
                        This clip uses the older “{LOOK_LABELS[el.filter]}” filter. Switch to the colour panel’s look for exact preview and intensity control.
                    </p>
                    <div className="ke-inline">
                        <button
                            className="ke-btn ke-btn--sm"
                            onClick={() => {
                                const base = el.color || colorFromLegacy(el.grade);
                                commit({ filter: 'none', grade: undefined, color: { ...base, creative: { ...base.creative, look: LOOK_NAMES[el.filter] ? el.filter : null } } });
                            }}
                        >
                            Convert
                        </button>
                        <button className="ke-btn ke-btn--sm" onClick={() => commit({ filter: 'none' })}>
                            Remove
                        </button>
                    </div>
                </section>
            ) : null}

            {hasPicture ? <ColorPanel track={track} el={el} /> : null}

            {track.isMain && hasPicture ? <EffectsSection el={el} commit={commit} update={update} /> : null}
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
