/**
 * Keyframe editor for the selected clip or text: per-property values at the playhead, add/remove
 * keyframes, easing per keyframe, previous/next navigation and one-click animation presets.
 * Values are evaluated with lib/keyframes.js, the same code the export uses.
 */
import { ChevronLeft, ChevronRight, Diamond, Trash2 } from 'lucide-react';
import { EASINGS, evaluateTrack, keyframeTimes, removeKeyframe, setKeyframe } from '../../lib/keyframes.js';
import { getElementLength } from '../../lib/time';
import { beatAnimation, type BeatAnimation } from '../../lib/beat-sync';
import { getTransform } from '../../lib/transform';
import { usePlaybackStore } from '../../stores/playback-store';
import { useProjectStore } from '../../stores/project-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';
import type { AnimatableProperty, EasingId, Keyframe, Keyframes, MediaElement, TextElement, TimelineTrack } from '../../types';

type Element = MediaElement | TextElement;

const PROPS: { key: AnimatableProperty; label: string; min: number; max: number; step: number; unit: string }[] = [
    { key: 'x', label: 'Position X', min: -2000, max: 2000, step: 1, unit: 'px' },
    { key: 'y', label: 'Position Y', min: -2000, max: 2000, step: 1, unit: 'px' },
    { key: 'scale', label: 'Scale', min: 0.1, max: 4, step: 0.01, unit: '×' },
    { key: 'rotation', label: 'Rotation', min: -360, max: 360, step: 1, unit: '°' },
    { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, unit: '' },
];

/** Static (un-keyframed) value of a property. Text scale and opacity keyframes multiply the style. */
function staticValue(el: Element, prop: AnimatableProperty): number {
    if (el.type === 'media') {
        const t = getTransform(el);
        return prop === 'x' ? t.x : prop === 'y' ? t.y : prop === 'scale' ? t.scale : prop === 'rotation' ? t.rotation : 1;
    }
    return prop === 'x' ? el.x : prop === 'y' ? el.y : prop === 'rotation' ? el.rotation : 1;
}

/** One-click animations, as keyframes relative to the element's length. */
type Preset = { id: string; label: string; group: 'In' | 'Out' | 'Loop'; build: (el: Element, len: number) => Keyframes };
const PRESETS: Preset[] = [
    { id: 'pop-in', label: 'Pop in', group: 'In', build: (el) => ({ scale: [k(0, 0.4 * baseScale(el), 'back-out'), k(0.35, baseScale(el))], opacity: [k(0, 0, 'ease-out'), k(0.2, 1)] }) },
    { id: 'slide-up-in', label: 'Slide up', group: 'In', build: (el) => ({ y: [k(0, staticValue(el, 'y') + 220, 'expo-out'), k(0.5, staticValue(el, 'y'))], opacity: [k(0, 0, 'ease-out'), k(0.3, 1)] }) },
    { id: 'slide-left-in', label: 'Slide in left', group: 'In', build: (el) => ({ x: [k(0, staticValue(el, 'x') - 900, 'expo-out'), k(0.5, staticValue(el, 'x'))] }) },
    { id: 'zoom-in-in', label: 'Zoom reveal', group: 'In', build: (el) => ({ scale: [k(0, baseScale(el) * 1.6, 'expo-out'), k(0.6, baseScale(el))], opacity: [k(0, 0, 'ease-out'), k(0.25, 1)] }) },
    { id: 'spin-in', label: 'Spin in', group: 'In', build: (el) => ({ rotation: [k(0, -180, 'back-out'), k(0.5, staticValue(el, 'rotation'))], scale: [k(0, 0.2 * baseScale(el), 'back-out'), k(0.5, baseScale(el))] }) },
    { id: 'drop-in', label: 'Drop bounce', group: 'In', build: (el) => ({ y: [k(0, staticValue(el, 'y') - 700, 'bounce-out'), k(0.8, staticValue(el, 'y'))] }) },
    { id: 'fade-out', label: 'Fade out', group: 'Out', build: (_el, len) => ({ opacity: [k(Math.max(0, len - 0.4), 1, 'ease-in'), k(len, 0)] }) },
    { id: 'zoom-out-out', label: 'Zoom away', group: 'Out', build: (el, len) => ({ scale: [k(Math.max(0, len - 0.5), baseScale(el), 'back-in'), k(len, baseScale(el) * 0.2)], opacity: [k(Math.max(0, len - 0.25), 1, 'ease-in'), k(len, 0)] }) },
    { id: 'slide-out-right', label: 'Slide out right', group: 'Out', build: (el, len) => ({ x: [k(Math.max(0, len - 0.45), staticValue(el, 'x'), 'expo-in-out'), k(len, staticValue(el, 'x') + 900)] }) },
    { id: 'pulse', label: 'Pulse', group: 'Loop', build: (el, len) => ({ scale: pulses(len, baseScale(el), 1.08, 0.6) }) },
    { id: 'wiggle', label: 'Wiggle', group: 'Loop', build: (el, len) => ({ rotation: wiggle(len, staticValue(el, 'rotation'), 4, 0.25) }) },
    { id: 'ken-burns', label: 'Slow push', group: 'Loop', build: (el, len) => ({ scale: [k(0, baseScale(el), 'linear'), k(len, baseScale(el) * 1.15)] }) },
];

const BEAT_PRESETS: { id: BeatAnimation; label: string; title: string }[] = [
    { id: 'pulse', label: 'Beat pulse', title: 'Punches in on every beat of the music' },
    { id: 'shake', label: 'Beat shake', title: 'A small rotation kick on every beat' },
    { id: 'flash', label: 'Beat flash', title: 'Dips the opacity on every beat' },
];

function k(t: number, v: number, ease: EasingId = 'ease-in-out'): Keyframe {
    return { t: Math.round(t * 1000) / 1000, v: Math.round(v * 10000) / 10000, ease };
}
const baseScale = (el: Element) => staticValue(el, 'scale');
function pulses(len: number, base: number, peak: number, period: number): Keyframe[] {
    const out: Keyframe[] = [];
    for (let t = 0; t <= len + 1e-6; t += period / 2) out.push(k(Math.min(t, len), out.length % 2 ? base * peak : base, 'ease-in-out'));
    return out.slice(0, 64);
}
function wiggle(len: number, base: number, amp: number, period: number): Keyframe[] {
    const out: Keyframe[] = [];
    let i = 0;
    for (let t = 0; t <= len + 1e-6 && out.length < 64; t += period, i += 1) out.push(k(Math.min(t, len), base + (i % 2 ? amp : -amp) * (i === 0 ? 0 : 1), 'ease-in-out'));
    return out;
}

export function KeyframePanel({ track, el }: { track: TimelineTrack; el: Element }) {
    const currentTime = usePlaybackStore((s) => s.currentTime);
    const seek = usePlaybackStore((s) => s.seek);
    const fps = useProjectStore((s) => s.fps);
    const length = getElementLength(el);
    const local = currentTime - el.startTime;
    const inside = local >= -1e-6 && local <= length + 1e-6;
    const tLocal = Math.min(length, Math.max(0, local));
    const kfs: Keyframes = el.keyframes || {};
    const times = keyframeTimes(kfs) as number[];
    const tol = 0.5 / fps;

    const write = (next: Keyframes, record = true) => {
        const cleaned = Object.fromEntries(Object.entries(next).filter(([, list]) => list && list.length)) as Keyframes;
        useTimelineStore.getState().updateElement(track.id, el.id, { keyframes: Object.keys(cleaned).length ? cleaned : undefined }, record);
    };

    const valueAt = (prop: AnimatableProperty) => {
        const v = evaluateTrack(kfs[prop], tLocal);
        return v === undefined ? staticValue(el, prop) : v;
    };

    const setValue = (prop: AnimatableProperty, v: number, record: boolean) => {
        if (kfs[prop]?.length) {
            write({ ...kfs, [prop]: setKeyframe(kfs[prop], tLocal, v, undefined, fps) }, record);
            return;
        }
        // Not animated yet: change the static value (opacity on video has no static value, so it keys).
        const store = useTimelineStore.getState();
        if (el.type === 'media') {
            if (prop === 'opacity') return write({ ...kfs, opacity: setKeyframe([], tLocal, v, undefined, fps) }, record);
            store.updateElement(track.id, el.id, { transform: { ...getTransform(el), [prop]: v } }, record);
        } else {
            if (prop === 'scale' || prop === 'opacity') return write({ ...kfs, [prop]: setKeyframe([], tLocal, v, undefined, fps) }, record);
            store.updateElement(track.id, el.id, { [prop]: v } as Partial<TextElement>, record);
        }
    };

    const toggleKey = (prop: AnimatableProperty) => {
        const list = kfs[prop] || [];
        const at = list.find((key) => Math.abs(key.t - tLocal) <= tol);
        write({ ...kfs, [prop]: at ? removeKeyframe(list, tLocal, fps) : setKeyframe(list, tLocal, valueAt(prop), undefined, fps) });
    };

    const keyAll = () => {
        const next: Keyframes = { ...kfs };
        for (const p of PROPS) next[p.key] = setKeyframe(kfs[p.key] || [], tLocal, valueAt(p.key), undefined, fps);
        write(next);
    };

    // Easing of the segment the playhead is in (or of the keyframe under it).
    const segmentKey = (prop: AnimatableProperty) => {
        const list = kfs[prop] || [];
        let found: Keyframe | undefined;
        for (const key of list) if (key.t <= tLocal + tol) found = key;
        return found;
    };
    const setEase = (prop: AnimatableProperty, ease: EasingId) => {
        const target = segmentKey(prop);
        if (!target) return;
        write({ ...kfs, [prop]: (kfs[prop] || []).map((key) => (key === target ? { ...key, ease } : key)) });
    };

    const jump = (dir: -1 | 1) => {
        const list = dir < 0 ? [...times].reverse().filter((t) => t < tLocal - tol) : times.filter((t) => t > tLocal + tol);
        if (list.length) seek(el.startTime + list[0]);
    };

    const applyPreset = (preset: Preset) => {
        const built = preset.build(el, length);
        // In and out presets combine; a loop replaces the properties it animates.
        write({ ...kfs, ...built });
    };

    const applyBeat = (kind: BeatAnimation) => {
        const built = beatAnimation(el, kind);
        if (!Object.keys(built).length) {
            useUiStore.getState().notify('No beats under this clip. Select the music, choose Detect beats, then try again.', 'error');
            return;
        }
        write({ ...kfs, ...built });
    };

    return (
        <section className="ke-props-section ke-kf">
            <div className="ke-kf__head">
                <h4>Keyframes</h4>
                <div className="ke-inline">
                    <button className="ke-icon-btn" title="Previous keyframe" disabled={!times.some((t) => t < tLocal - tol)} onClick={() => jump(-1)}>
                        <ChevronLeft size={14} />
                    </button>
                    <span className="ke-mono ke-kf__time">{tLocal.toFixed(2)}s</span>
                    <button className="ke-icon-btn" title="Next keyframe" disabled={!times.some((t) => t > tLocal + tol)} onClick={() => jump(1)}>
                        <ChevronRight size={14} />
                    </button>
                </div>
            </div>
            {!inside ? <p className="ke-note">Move the playhead over this {el.type === 'text' ? 'text' : 'clip'} to add keyframes.</p> : null}

            {PROPS.map((p) => {
                const animated = !!kfs[p.key]?.length;
                const onKey = (kfs[p.key] || []).some((key) => Math.abs(key.t - tLocal) <= tol);
                const v = valueAt(p.key);
                const seg = segmentKey(p.key);
                return (
                    <div key={p.key} className={`ke-kf__row ${animated ? 'is-animated' : ''}`}>
                        <button className={`ke-kf__diamond ${onKey ? 'is-on' : ''}`} title={onKey ? 'Remove keyframe' : 'Add keyframe at the playhead'} disabled={!inside} onClick={() => toggleKey(p.key)}>
                            <Diamond size={12} />
                        </button>
                        <span className="ke-kf__label">{p.label}</span>
                        <input
                            type="range"
                            min={p.min}
                            max={p.max}
                            step={p.step}
                            value={v}
                            disabled={!inside}
                            onPointerDown={() => useTimelineStore.getState().pushHistory()}
                            onChange={(e) => setValue(p.key, Number(e.target.value), false)}
                        />
                        <input className="ke-lumetri__num" type="number" step={p.step} value={p.step < 1 ? v.toFixed(2) : Math.round(v)} disabled={!inside} onChange={(e) => setValue(p.key, Number(e.target.value) || 0, true)} />
                        {animated ? (
                            <select className="ke-select ke-kf__ease" value={seg?.ease || 'ease-in-out'} onChange={(e) => setEase(p.key, e.target.value as EasingId)} title="Easing from this keyframe to the next">
                                {Object.entries(EASINGS).map(([id, e]) => (
                                    <option key={id} value={id}>
                                        {(e as { label: string }).label}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <span />
                        )}
                    </div>
                );
            })}

            <div className="ke-inline">
                <button className="ke-btn ke-btn--sm" disabled={!inside} onClick={keyAll}>
                    <Diamond size={12} /> Key all
                </button>
                {times.length ? (
                    <button className="ke-btn ke-btn--sm" onClick={() => write({})}>
                        <Trash2 size={12} /> Clear keyframes
                    </button>
                ) : null}
            </div>

            {(['In', 'Out', 'Loop'] as const).map((group) => (
                <div key={group}>
                    <h5 className="ke-subhead">Animate {group.toLowerCase()}</h5>
                    <div className="ke-chip-row">
                        {PRESETS.filter((p) => p.group === group).map((p) => (
                            <button key={p.id} className="ke-chip" onClick={() => applyPreset(p)}>
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>
            ))}
            <h5 className="ke-subhead">On the beat</h5>
            <div className="ke-chip-row">
                {BEAT_PRESETS.map((p) => (
                    <button key={p.id} className="ke-chip" onClick={() => applyBeat(p.id)} title={p.title}>
                        {p.label}
                    </button>
                ))}
            </div>
            <p className="ke-note">Once a property has keyframes, changing it adds or updates a keyframe at the playhead. Preview and export use the same curves.</p>
        </section>
    );
}
