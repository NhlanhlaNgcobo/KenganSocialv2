/**
 * Plays a template's structure: its slot timing, the transitions between slots (the same CSS the
 * editor uses), camera moves, text timing and beat hits. Assigned media show their thumbnails;
 * empty slots show their label. The full-quality preview is the editor itself after "Use template".
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { transitionStyles } from '../../lib/fx';
import { applyParams, resolveTiming } from '../../lib/template-schema.js';
import type { KenganTemplate } from '../../lib/template-build';
import type { TransitionType } from '../../types';

const SLOT_COLOURS = ['#3b6fd8', '#db2777', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16'];
const RATIO_CSS: Record<string, string> = { '9:16': '9 / 16', '1:1': '1 / 1', '16:9': '16 / 9' };

function cameraCss(camera: string, p: number) {
    const a = 0.12 * p;
    switch (camera) {
        case 'zoom-in':
        case 'push-in':
        case 'detail-approach':
            return `scale(${1 + a})`;
        case 'zoom-out':
        case 'pull-out':
        case 'detail-release':
            return `scale(${1.12 - a})`;
        case 'pan-left':
            return `scale(1.12) translateX(${(0.5 - p) * 8}%)`;
        case 'pan-right':
            return `scale(1.12) translateX(${(p - 0.5) * 8}%)`;
        case 'tilt-up':
        case 'diagonal-rise':
            return `scale(1.12) translateY(${(0.5 - p) * 8}%)`;
        case 'tilt-down':
        case 'diagonal-fall':
            return `scale(1.12) translateY(${(p - 0.5) * 8}%)`;
        default:
            return undefined;
    }
}

export function TemplatePreview({ template, thumbs, params, compact = false, playing = true }: { template: KenganTemplate; thumbs?: (string | undefined)[]; params?: Record<string, string | number>; compact?: boolean; playing?: boolean }) {
    const resolved = useMemo(() => {
        const { template: t, pace } = applyParams(template, params || {}) as { template: KenganTemplate; pace: number };
        return { t, timing: resolveTiming(t, { pace }) };
    }, [template, params]);
    const { t, timing } = resolved;
    const [time, setTime] = useState(0);
    const start = useRef<number | null>(null);

    useEffect(() => {
        if (!playing) return undefined;
        let raf = 0;
        start.current = null;
        const tick = (now: number) => {
            if (start.current === null) start.current = now - time * 1000;
            setTime((((now - start.current) / 1000) % Math.max(0.5, timing.duration)) || 0);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playing, timing.duration]);

    const index = Math.max(0, timing.slots.findIndex((s) => time >= s.start && time < s.start + s.length));
    const slotLayer = (i: number, style?: React.CSSProperties) => {
        const slot = t.slots[i];
        const at = timing.slots[i];
        const p = Math.min(1, Math.max(0, (time - at.start) / at.length));
        const thumb = thumbs?.[i];
        return (
            <i key={`slot-${i}`} className="ke-tplp__slot" style={{ background: thumb ? `url(${thumb}) center / cover` : SLOT_COLOURS[i % SLOT_COLOURS.length], ...style }}>
                <b style={{ transform: cameraCss(slot.camera, p) }} />
                {!thumb && !compact ? <span>{slot.label}</span> : null}
            </i>
        );
    };

    // A transition centred on the cut into slot k covers [cut − d/2, cut + d/2].
    let layers: React.ReactNode[] = [slotLayer(index)];
    let wash: React.CSSProperties | undefined;
    for (let k = 1; k < t.slots.length; k += 1) {
        const tr = t.slots[k].transitionIn;
        if (!tr) continue;
        const cut = timing.slots[k].start;
        const d = Math.min(tr.duration, timing.slots[k].length * 0.8);
        if (time >= cut - d / 2 && time < cut + d / 2) {
            const s = transitionStyles(tr.type as TransitionType, (time - (cut - d / 2)) / d);
            layers = [slotLayer(k - 1, s.a), slotLayer(k, s.b)];
            wash = s.wash;
            break;
        }
    }
    const activeTexts = t.texts.filter((x, i) => x.content.trim() && time >= timing.texts[i].start && time < timing.texts[i].start + timing.texts[i].length);
    const beatHit = t.timing.unit === 'beats' && ((time * t.timing.bpm) / 60) % 1 < 0.12;
    const canvasW = t.canvas.ratio === '16:9' ? 1920 : 1080;

    return (
        <div className={`ke-tplp ${compact ? 'is-compact' : ''}`} style={{ aspectRatio: RATIO_CSS[t.canvas.ratio], background: t.canvas.background }}>
            {layers}
            {wash ? <i className="ke-tplp__wash" style={wash} /> : null}
            {activeTexts.map((x) => (
                <span
                    key={x.id}
                    className="ke-tplp__text"
                    style={{
                        left: `${50 + (x.style.x / canvasW) * 100}%`,
                        top: `${50 + (x.style.y / (canvasW * (t.canvas.ratio === '9:16' ? 16 / 9 : t.canvas.ratio === '16:9' ? 9 / 16 : 1))) * 100}%`,
                        fontSize: `${(x.style.fontSize / canvasW) * 100}cqw`,
                        color: x.style.color,
                        background: x.style.backgroundColor,
                        fontWeight: x.style.fontWeight,
                    }}
                >
                    {x.content}
                </span>
            ))}
            {t.timing.unit === 'beats' ? <i className={`ke-tplp__beat ${beatHit ? 'is-hit' : ''}`} /> : null}
            {!compact ? (
                <div className="ke-tplp__bar">
                    {timing.slots.map((s, i) => (
                        <i key={i} style={{ flex: s.length }} className={i === index ? 'is-on' : ''} />
                    ))}
                    <em style={{ left: `${(time / Math.max(0.01, timing.duration)) * 100}%` }} />
                </div>
            ) : null}
        </div>
    );
}
