import { useEffect, useState } from 'react';
import { CAPTION_TEMPLATES } from '../../components/clips/shorts-options';
import '../../components/clips/caption-fonts.css';
import LoopVideo from './LoopVideo';

/** Cycles through the real caption templates, lighting up one word at a time like the render does. */

const WORDS = ['One', 'video.', 'Ten', 'shorts.'];
const TEMPLATES = CAPTION_TEMPLATES.filter((t) => t.id !== 'none');
const WORD_MS = 520;

export default function CaptionShowcase() {
    const [tick, setTick] = useState(0);
    const [paused, setPaused] = useState(false);

    useEffect(() => {
        if (paused) return undefined;
        const timer = setInterval(() => setTick((t) => t + 1), WORD_MS);
        return () => clearInterval(timer);
    }, [paused]);

    const template = TEMPLATES[Math.floor(tick / WORDS.length) % TEMPLATES.length];
    const active = tick % WORDS.length;
    const words = template.single ? [WORDS[active]] : WORDS;

    const style = {
        fontFamily: template.font,
        fontWeight: template.weight,
        color: template.color,
        textTransform: template.upper ? 'uppercase' : 'none',
        WebkitTextStroke: template.stroke ? `0.06em ${template.stroke}` : undefined,
        paintOrder: 'stroke fill',
        textShadow: template.glow ? `0 0 0.25em ${template.glow}, 0 0 0.5em ${template.glow}` : template.shadow ? '0 0.08em 0.16em rgba(0,0,0,0.7)' : undefined,
        background: template.box,
    };

    return (
        <div className="lp-captions" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
            <div className="lp-captions__stage">
                <LoopVideo name="captions-bg" className="lp-captions__video" />
                <span className={`lp-captions__text ${template.box ? 'has-box' : ''}`} style={style} key={template.id}>
                    {words.map((w, i) => {
                        const on = template.single || i === active;
                        const color = on && template.active ? template.active : template.fill && i < active ? template.active : undefined;
                        return (
                            <span key={`${w}-${i}`} className={on ? 'is-on' : ''} style={color ? { color } : undefined}>
                                {w}
                            </span>
                        );
                    })}
                </span>
            </div>
            <div className="lp-captions__names" role="tablist" aria-label="Caption templates">
                {TEMPLATES.map((t, i) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={t.id === template.id}
                        className={t.id === template.id ? 'is-active' : ''}
                        onClick={() => setTick(i * WORDS.length)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
