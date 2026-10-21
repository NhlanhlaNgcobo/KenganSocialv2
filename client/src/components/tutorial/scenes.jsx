/**
 * Building blocks for tutorial scenes: small animated mock-ups of KenganSocial screens. Timing is
 * set with CSS variables (--d delay, --t duration); see GuidedTutorial.css. Every element's resting
 * style is its final state, so with reduced motion the finished picture shows without animation.
 */
import { Check, MousePointer2 } from 'lucide-react';

const delay = (d, extra = {}) => ({ '--d': `${d}s`, ...extra });

/** A fake app window. */
export function Window({ title, children, wide = false }) {
    return (
        <div className={`gt-window ${wide ? 'gt-window--wide' : ''}`}>
            <div className="gt-window__bar">
                <i />
                <i />
                <i />
                <span>{title}</span>
            </div>
            <div className="gt-window__body">{children}</div>
        </div>
    );
}

/** Appears with a short rise after `d` seconds. */
export function In({ d = 0, className = '', children, style }) {
    return (
        <div className={`gt-in ${className}`} style={{ ...delay(d), ...style }}>
            {children}
        </div>
    );
}

/** Pops in (scale) after `d` seconds. */
export function Pop({ d = 0, className = '', children, style }) {
    return (
        <div className={`gt-pop ${className}`} style={{ ...delay(d), ...style }}>
            {children}
        </div>
    );
}

/** A bar that grows to `value` (0-100) after `d` seconds. */
export function Bar({ d = 0, value, tone = 'accent' }) {
    return (
        <div className="gt-bar">
            <span className={`gt-bar__fill gt-bar__fill--${tone}`} style={delay(d, { '--w': `${value}%` })} />
        </div>
    );
}

/** A tick that draws itself after `d` seconds, with a label. */
export function Tick({ d = 0, children }) {
    return (
        <div className="gt-tick gt-in" style={delay(d)}>
            <span className="gt-tick__box" style={delay(d + 0.15)}>
                <Check size={12} strokeWidth={3} />
            </span>
            <span>{children}</span>
        </div>
    );
}

/** A button that gets "pressed" (highlight pulse) at `d` seconds. */
export function Press({ d = 0, className = '', children }) {
    return (
        <span className={`gt-press ${className}`} style={delay(d)}>
            {children}
        </span>
    );
}

/**
 * A mouse pointer gliding from (x1, y1) to (x2, y2) (percent of the stage) between `d` and
 * `d + t` seconds, then clicking.
 */
export function Cursor({ from, to, d = 0.4, t = 1.2 }) {
    const vars = { '--x1': `${from[0]}%`, '--y1': `${from[1]}%`, '--x2': `${to[0]}%`, '--y2': `${to[1]}%`, '--d': `${d}s`, '--t': `${t}s` };
    return (
        <>
            <span className="gt-cursor" style={vars}>
                <MousePointer2 size={22} fill="currentColor" />
            </span>
            <span className="gt-ripple" style={{ ...vars, '--d': `${d + t}s` }} />
        </>
    );
}

/** Text that types itself out after `d` seconds. */
export function Typed({ d = 0, text, className = '' }) {
    return (
        <span className={`gt-typed ${className}`} style={delay(d, { '--n': text.length })}>
            {text}
        </span>
    );
}
