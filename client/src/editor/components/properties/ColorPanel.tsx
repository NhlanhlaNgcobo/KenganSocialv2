import { ColorScopes } from './ColorScopes';
/**
 * Lumetri-style colour panel: Basic Correction, Creative, Curves, Colour Wheels, HSL, Vignette.
 * Settings compile to a 3D LUT (lib/color-pipeline.js) used by both the preview and the export.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ChevronDown, ClipboardCopy, ClipboardPaste, RotateCcw, Upload } from 'lucide-react';
import { buildLut, lutToCube, curveFunction, HSL_BANDS, LOOK_NAMES, neutralColor, normalizeColor, parseCube, WHEEL_RED_ANGLE } from '../../lib/color-pipeline.js';
import { useProjectStore } from '../../stores/project-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';
import type { ColorSettings, ColorWheel, MediaElement, TimelineTrack } from '../../types';
import { colorFromLegacy } from '../../lib/grade';

export { colorFromLegacy };

type Curve = 'master' | 'red' | 'green' | 'blue';

/** Copy/paste clipboard for grades (session only). */
let gradeClipboard: ColorSettings | null = null;

function Section({ title, children, defaultOpen = false, changed = false }: { title: string; children: ReactNode; defaultOpen?: boolean; changed?: boolean }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className={`ke-lumetri__section ${open ? 'is-open' : ''}`}>
            <button className="ke-lumetri__head" onClick={() => setOpen(!open)}>
                <ChevronDown size={14} />
                <span>{title}</span>
                {changed ? <i className="ke-lumetri__dot" title="Adjusted" /> : null}
            </button>
            {open ? <div className="ke-lumetri__body">{children}</div> : null}
        </div>
    );
}

function Slide({ label, value, min, max, step = 1, neutral, unit = '', onStart, onChange, track }: { label: string; value: number; min: number; max: number; step?: number; neutral: number; unit?: string; onStart: () => void; onChange: (v: number) => void; track?: string }) {
    return (
        <div className="ke-lumetri__slider" onDoubleClick={() => (onStart(), onChange(neutral))} title="Double-click to reset">
            <span className={value !== neutral ? 'is-changed' : ''}>{label}</span>
            <input type="range" min={min} max={max} step={step} value={value} style={track ? { background: track } : undefined} onPointerDown={onStart} onKeyDown={onStart} onChange={(e) => onChange(Number(e.target.value))} />
            <input
                className="ke-lumetri__num"
                type="number"
                value={Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}
                step={step}
                min={min}
                max={max}
                onFocus={onStart}
                onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))}
            />
            {unit ? <small>{unit}</small> : null}
        </div>
    );
}

/** Draggable tone curve (click to add a point, drag to move, double-click a point to remove). */
function CurveEditor({ points, channel, onStart, onChange }: { points: [number, number][]; channel: Curve; onStart: () => void; onChange: (p: [number, number][]) => void }) {
    const svg = useRef<SVGSVGElement>(null);
    const [drag, setDrag] = useState<number | null>(null);
    const size = 200;
    const colour = { master: '#e4e4e7', red: '#f87171', green: '#4ade80', blue: '#60a5fa' }[channel];
    const fn = curveFunction(points);
    const path = Array.from({ length: 65 }, (_, i) => {
        const x = i / 64;
        return `${i ? 'L' : 'M'}${(x * size).toFixed(1)},${((1 - Math.min(1, Math.max(0, fn(x)))) * size).toFixed(1)}`;
    }).join(' ');
    const toPoint = (e: ReactPointerEvent): [number, number] => {
        const r = svg.current!.getBoundingClientRect();
        return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
    };
    return (
        <svg
            ref={svg}
            className="ke-curve"
            viewBox={`0 0 ${size} ${size}`}
            onPointerDown={(e) => {
                if ((e.target as Element).tagName === 'circle') return;
                onStart();
                const p = toPoint(e);
                const next = [...points, p].sort((a, b) => a[0] - b[0]).slice(0, 12) as [number, number][];
                onChange(next);
                setDrag(next.indexOf(p));
                (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
                if (drag === null) return;
                const p = toPoint(e);
                const next = points.map((q, i) => (i === drag ? p : q)) as [number, number][];
                onChange(next);
            }}
            onPointerUp={() => setDrag(null)}
        >
            {[0.25, 0.5, 0.75].map((g) => (
                <g key={g} stroke="rgba(255,255,255,0.08)">
                    <line x1={g * size} y1={0} x2={g * size} y2={size} />
                    <line x1={0} y1={g * size} x2={size} y2={g * size} />
                </g>
            ))}
            <line x1={0} y1={size} x2={size} y2={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 4" />
            <path d={path} fill="none" stroke={colour} strokeWidth={2} />
            {points.map((p, i) => (
                <circle
                    key={i}
                    cx={p[0] * size}
                    cy={(1 - p[1]) * size}
                    r={5}
                    fill={colour}
                    stroke="#111"
                    onPointerDown={(e) => {
                        e.stopPropagation();
                        onStart();
                        setDrag(i);
                        svg.current?.setPointerCapture(e.pointerId);
                    }}
                    onDoubleClick={(e) => {
                        e.stopPropagation();
                        onStart();
                        onChange(points.filter((_, j) => j !== i));
                    }}
                />
            ))}
        </svg>
    );
}

/** Colour wheel pad: drag the puck to push a colour, slider below for brightness of the range. */
function WheelPad({ label, wheel, onStart, onChange }: { label: string; wheel: ColorWheel; onStart: () => void; onChange: (w: ColorWheel) => void }) {
    const pad = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const move = (e: ReactPointerEvent) => {
        const r = pad.current!.getBoundingClientRect();
        let x = ((e.clientX - r.left) / r.width) * 2 - 1;
        let y = -(((e.clientY - r.top) / r.height) * 2 - 1);
        const len = Math.hypot(x, y);
        if (len > 1) {
            x /= len;
            y /= len;
        }
        // Fine control: the outer part of the wheel is the strongest push.
        onChange({ ...wheel, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
    };
    // Hue ring positioned like a vectorscope (red at ~103°, counter-clockwise).
    const ring = `conic-gradient(from ${90 - WHEEL_RED_ANGLE}deg, #f00, #f0f, #00f, #0ff, #0f0, #ff0, #f00)`;
    return (
        <div className="ke-wheel">
            <span className="ke-wheel__label">{label}</span>
            <div
                ref={pad}
                className="ke-wheel__pad"
                style={{ background: `radial-gradient(circle, #3a3a42 0%, rgba(58,58,66,0) 70%), ${ring}` }}
                onPointerDown={(e) => {
                    onStart();
                    setDragging(true);
                    e.currentTarget.setPointerCapture(e.pointerId);
                    move(e);
                }}
                onPointerMove={(e) => dragging && move(e)}
                onPointerUp={() => setDragging(false)}
                onDoubleClick={() => (onStart(), onChange({ ...wheel, x: 0, y: 0 }))}
                title="Drag to tint; double-click to reset"
            >
                <i className="ke-wheel__puck" style={{ left: `${50 + wheel.x * 50}%`, top: `${50 - wheel.y * 50}%` }} />
            </div>
            <input type="range" min={-1} max={1} step={0.01} value={wheel.luma} onPointerDown={onStart} onChange={(e) => onChange({ ...wheel, luma: Number(e.target.value) })} onDoubleClick={() => (onStart(), onChange({ ...wheel, luma: 0 }))} />
        </div>
    );
}

const BAND_COLOURS: Record<string, string> = { red: '#ef4444', orange: '#f97316', yellow: '#eab308', green: '#22c55e', aqua: '#06b6d4', blue: '#3b82f6', purple: '#8b5cf6', magenta: '#d946ef' };

export function ColorPanel({ track, el }: { track: TimelineTrack; el: MediaElement }) {
    const notify = useUiStore((s) => s.notify);
    const { luts, addLut } = useProjectStore();
    const [curve, setCurve] = useState<Curve>('master');
    const [band, setBand] = useState('orange');
    const fileInput = useRef<HTMLInputElement>(null);

    // Clips graded by AI Edit carry the quick grade; it converts on first edit.
    const color = (el.color ? normalizeColor(el.color) : colorFromLegacy(el.grade)) as ColorSettings;
    const neutral = neutralColor() as ColorSettings;
    const begin = () => useTimelineStore.getState().pushHistory();
    const write = (next: ColorSettings) => useTimelineStore.getState().updateElement(track.id, el.id, { color: next, grade: undefined }, false);
    const set = <K extends keyof ColorSettings>(group: K, partial: Partial<ColorSettings[K]>) => write({ ...color, [group]: { ...(color[group] as object), ...partial } } as ColorSettings);

    const changed = (group: keyof ColorSettings) => JSON.stringify(color[group]) !== JSON.stringify(neutral[group]);

    const importCube = async (file: File) => {
        try {
            const lut = parseCube(await file.text());
            const id = addLut({ name: file.name.replace(/\.cube$/i, ''), size: lut.size, data: Array.from(lut.data, (v) => Math.round(v * 10000) / 10000) });
            begin();
            set('creative', { look: `lut:${id}` });
            notify(`Imported “${file.name}” (${lut.size}³ LUT).`, 'success');
        } catch (e) {
            notify((e as Error).message, 'error');
        }
    };

    const applyToAll = () => {
        const timeline = useTimelineStore.getState();
        timeline.pushHistory();
        let n = 0;
        for (const t of timeline.tracks)
            for (const e of t.elements)
                if (e.type === 'media' && e.mediaId === el.mediaId && e.id !== el.id) {
                    timeline.updateElement(t.id, e.id, { color, grade: undefined }, false);
                    n += 1;
                }
        notify(`Grade copied to ${n} other clip${n === 1 ? '' : 's'} of this video.`, 'success');
    };

    const B = color.basic;
    const C = color.creative;
    const V = color.vignette;
    const bandValue = color.hsl[band] || { hue: 0, saturation: 0, luminance: 0 };

    return (
        <section className="ke-props-section ke-lumetri">
            <div className="ke-lumetri__top">
                <h4>Colour</h4>
                <div className="ke-inline">
                    <button className="ke-icon-btn" title="Copy grade" onClick={() => ((gradeClipboard = color), notify('Grade copied.', 'info'))}>
                        <ClipboardCopy size={14} />
                    </button>
                    <button className="ke-icon-btn" title="Paste grade" disabled={!gradeClipboard} onClick={() => gradeClipboard && (begin(), write(gradeClipboard))}>
                        <ClipboardPaste size={14} />
                    </button>
                    <button className="ke-icon-btn" title="Reset all colour" onClick={() => (begin(), useTimelineStore.getState().updateElement(track.id, el.id, { color: null, grade: undefined }, false))}>
                        <RotateCcw size={14} />
                    </button>
                </div>
            </div>

            <Section title="Scopes & comparison"><ColorScopes el={el} color={color} /></Section>
            <Section title="Basic correction" defaultOpen changed={changed('basic')}>
                <h5 className="ke-subhead">White balance</h5>
                <Slide label="Temperature" value={B.temperature} min={-100} max={100} neutral={0} onStart={begin} onChange={(v) => set('basic', { temperature: v })} track="linear-gradient(90deg,#4f8ef7,#d4d4d8,#f5a524)" />
                <Slide label="Tint" value={B.tint} min={-100} max={100} neutral={0} onStart={begin} onChange={(v) => set('basic', { tint: v })} track="linear-gradient(90deg,#22c55e,#d4d4d8,#d946ef)" />
                <h5 className="ke-subhead">Tone</h5>
                <Slide label="Exposure" value={B.exposure} min={-4} max={4} step={0.05} neutral={0} onStart={begin} onChange={(v) => set('basic', { exposure: v })} />
                <Slide label="Contrast" value={B.contrast} min={-100} max={100} neutral={0} onStart={begin} onChange={(v) => set('basic', { contrast: v })} />
                <Slide label="Highlights" value={B.highlights} min={-100} max={100} neutral={0} onStart={begin} onChange={(v) => set('basic', { highlights: v })} />
                <Slide label="Shadows" value={B.shadows} min={-100} max={100} neutral={0} onStart={begin} onChange={(v) => set('basic', { shadows: v })} />
                <Slide label="Whites" value={B.whites} min={-100} max={100} neutral={0} onStart={begin} onChange={(v) => set('basic', { whites: v })} />
                <Slide label="Blacks" value={B.blacks} min={-100} max={100} neutral={0} onStart={begin} onChange={(v) => set('basic', { blacks: v })} />
                <Slide label="Saturation" value={B.saturation} min={0} max={200} neutral={100} onStart={begin} onChange={(v) => set('basic', { saturation: v })} />
            </Section>

            <Section title="Creative" changed={changed('creative')}>
                <div className="ke-lumetri__row">
                    <span>Look</span>
                    <select className="ke-select" value={C.look || ''} onChange={(e) => (begin(), e.target.value === '__import' ? fileInput.current?.click() : set('creative', { look: e.target.value || null }))}>
                        <option value="">None</option>
                        <optgroup label="Kengan looks">
                            {Object.entries(LOOK_NAMES).map(([id, name]) => (
                                <option key={id} value={id}>
                                    {name}
                                </option>
                            ))}
                        </optgroup>
                        {Object.keys(luts).length ? (
                            <optgroup label="Imported LUTs">
                                {Object.entries(luts).map(([id, l]) => (
                                    <option key={id} value={`lut:${id}`}>
                                        {l.name}
                                    </option>
                                ))}
                            </optgroup>
                        ) : null}
                        <option value="__import">Import .cube LUT…</option>
                    </select>
                    <button className="ke-icon-btn" title="Import a .cube LUT" onClick={() => fileInput.current?.click()}>
                        <Upload size={14} />
                    </button>
                    <input ref={fileInput} type="file" accept=".cube" hidden onChange={(e) => e.target.files?.[0] && importCube(e.target.files[0])} />
                </div>
                <Slide label="Intensity" value={C.intensity} min={0} max={200} neutral={100} onStart={begin} onChange={(v) => set('creative', { intensity: v })} />
                <Slide label="Faded film" value={C.fadedFilm} min={0} max={100} neutral={0} onStart={begin} onChange={(v) => set('creative', { fadedFilm: v })} />
                <Slide label="Vibrance" value={C.vibrance} min={-100} max={100} neutral={0} onStart={begin} onChange={(v) => set('creative', { vibrance: v })} />
                <Slide label="Saturation" value={C.saturation} min={0} max={200} neutral={100} onStart={begin} onChange={(v) => set('creative', { saturation: v })} />
                <h5 className="ke-subhead">Shadow tint</h5>
                <Slide label="Hue" value={C.shadowTint.hue} min={0} max={360} neutral={30} onStart={begin} onChange={(v) => set('creative', { shadowTint: { ...C.shadowTint, hue: v } })} track="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" />
                <Slide label="Amount" value={C.shadowTint.amount} min={0} max={100} neutral={0} onStart={begin} onChange={(v) => set('creative', { shadowTint: { ...C.shadowTint, amount: v } })} />
                <h5 className="ke-subhead">Highlight tint</h5>
                <Slide label="Hue" value={C.highlightTint.hue} min={0} max={360} neutral={210} onStart={begin} onChange={(v) => set('creative', { highlightTint: { ...C.highlightTint, hue: v } })} track="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" />
                <Slide label="Amount" value={C.highlightTint.amount} min={0} max={100} neutral={0} onStart={begin} onChange={(v) => set('creative', { highlightTint: { ...C.highlightTint, amount: v } })} />
                <Slide label="Tint balance" value={C.tintBalance} min={-100} max={100} neutral={0} onStart={begin} onChange={(v) => set('creative', { tintBalance: v })} />
            </Section>

            <Section title="Curves" changed={changed('curves')}>
                <div className="ke-seg ke-seg--text">
                    {(['master', 'red', 'green', 'blue'] as Curve[]).map((c) => (
                        <button key={c} className={curve === c ? 'is-active' : ''} onClick={() => setCurve(c)}>
                            {c === 'master' ? 'Luma' : c[0].toUpperCase() + c.slice(1)}
                            {color.curves[c].length ? ' •' : ''}
                        </button>
                    ))}
                </div>
                <CurveEditor points={color.curves[curve]} channel={curve} onStart={begin} onChange={(p) => set('curves', { [curve]: p } as Partial<ColorSettings['curves']>)} />
                <div className="ke-inline">
                    <button className="ke-btn ke-btn--sm" onClick={() => (begin(), set('curves', { [curve]: [[0.25, 0.2], [0.75, 0.8]] } as Partial<ColorSettings['curves']>))}>
                        S-curve
                    </button>
                    <button className="ke-btn ke-btn--sm" onClick={() => (begin(), set('curves', { [curve]: [[0, 0.08], [1, 0.94]] } as Partial<ColorSettings['curves']>))}>
                        Matte
                    </button>
                    <button className="ke-btn ke-btn--sm" onClick={() => (begin(), set('curves', { [curve]: [] } as Partial<ColorSettings['curves']>))}>
                        Reset curve
                    </button>
                </div>
                <p className="ke-note">Click to add a point, drag to move, double-click a point to remove it.</p>
            </Section>

            <Section title="Colour wheels" changed={changed('wheels')}>
                <div className="ke-wheels">
                    {(['shadows', 'midtones', 'highlights'] as const).map((w) => (
                        <WheelPad key={w} label={w[0].toUpperCase() + w.slice(1)} wheel={color.wheels[w]} onStart={begin} onChange={(v) => set('wheels', { [w]: v } as Partial<ColorSettings['wheels']>)} />
                    ))}
                </div>
                <p className="ke-note">Wheel: push a colour into that tonal range. Slider: darker or brighter.</p>
            </Section>

            <Section title="HSL (per colour)" changed={changed('hsl')}>
                <div className="ke-bands">
                    {HSL_BANDS.map((b) => (
                        <button key={b.id} className={`ke-band ${band === b.id ? 'is-active' : ''} ${color.hsl[b.id] ? 'is-changed' : ''}`} style={{ background: BAND_COLOURS[b.id] }} title={b.id} onClick={() => setBand(b.id)} />
                    ))}
                </div>
                <Slide label="Hue" value={bandValue.hue} min={-100} max={100} neutral={0} onStart={begin} onChange={(v) => set('hsl', { [band]: { ...bandValue, hue: v } })} />
                <Slide label="Saturation" value={bandValue.saturation} min={-100} max={100} neutral={0} onStart={begin} onChange={(v) => set('hsl', { [band]: { ...bandValue, saturation: v } })} />
                <Slide label="Luminance" value={bandValue.luminance} min={-100} max={100} neutral={0} onStart={begin} onChange={(v) => set('hsl', { [band]: { ...bandValue, luminance: v } })} />
                <p className="ke-note">Example: orange luminance up and saturation down for softer skin; blue saturation up for richer skies.</p>
            </Section>

            <Section title="Vignette" changed={changed('vignette')}>
                <Slide label="Amount" value={V.amount} min={-100} max={100} neutral={0} onStart={begin} onChange={(v) => set('vignette', { amount: v })} />
                <Slide label="Midpoint" value={V.midpoint} min={0} max={100} neutral={50} onStart={begin} onChange={(v) => set('vignette', { midpoint: v })} />
                <Slide label="Roundness" value={V.roundness} min={-100} max={100} neutral={0} onStart={begin} onChange={(v) => set('vignette', { roundness: v })} />
                <Slide label="Feather" value={V.feather} min={0} max={100} neutral={50} onStart={begin} onChange={(v) => set('vignette', { feather: v })} />
            </Section>

            <div className="ke-stack">
                <button className="ke-btn ke-btn--sm" onClick={() => {
                    const blob = new Blob([lutToCube(buildLut(color, luts), 'KenganSocial SDR grade')], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'kengansocial-grade.cube'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
                    notify('Exported 33? SDR LUT. Vignette is spatial and is not included in the LUT.', 'info');
                }}>Export grade as .cube</button>
                <button className="ke-btn ke-btn--sm" onClick={() => {
                    const timeline = useTimelineStore.getState(); timeline.pushHistory();
                    for (const t of timeline.tracks) for (const e of t.elements) if (e.type === 'media') timeline.updateElement(t.id, e.id, { color, grade: undefined, filter: 'none' }, false);
                    notify('Grade applied to every video and image clip. Undo restores previous grades.', 'success');
                }}>Apply grade to entire timeline</button>
            </div>
            <p className="ke-note">SDR sRGB grading with RGB curves, tonal wheels, HSL and 3D LUTs. Convert log/HDR footage to SDR before importing.</p>
            <button className="ke-btn ke-btn--sm" onClick={applyToAll} title="Copy this grade to every clip from the same video">
                Apply to all clips of this video
            </button>
        </section>
    );
}
