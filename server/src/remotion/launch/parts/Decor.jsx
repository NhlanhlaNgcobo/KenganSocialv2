import React from 'react';
import { Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { alpha, clamp, ease, expoOut, pop } from './motion.js';
import { useBeat } from './time.js';

/** Decorative pieces shared by the scenes: glows, the brand mark, rings, big numerals. */

export const DISPLAY_FONT = 'KS Display';

export function Glow({ color, size, x = '50%', y = '50%', strength = 1 }) {
    const frame = useCurrentFrame();
    const beat = useBeat();
    const p = ease(frame, 0, 20);
    return (
        <div
            style={{
                position: 'absolute',
                left: x,
                top: y,
                width: size,
                height: size,
                marginLeft: -size / 2,
                marginTop: -size / 2,
                borderRadius: '50%',
                background: `radial-gradient(circle, ${alpha(color, 0.38)}, transparent 62%)`,
                transform: `scale(${0.6 + p * 0.4 + Math.sin(frame / 14) * 0.03 + beat * 0.04})`,
                opacity: p * strength,
            }}
        />
    );
}

/** The product's icon, or a monogram tile when there is none. */
export function BrandMark({ iconData, name, size, palette, delay = 0, spin = true }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const p = pop(frame, fps, delay, { damping: 11, stiffness: 140, mass: 0.8 });
    const style = {
        width: size,
        height: size,
        borderRadius: size * 0.24,
        transform: `scale(${p}) rotate(${spin ? (1 - p) * -18 : 0}deg)`,
        boxShadow: `0 ${size * 0.12}px ${size * 0.4}px rgba(0,0,0,0.35), 0 0 ${size * 0.5}px ${alpha(palette.accent, 0.35)}`,
        flex: 'none',
    };
    if (iconData) return <Img src={iconData} style={{ ...style, objectFit: 'cover' }} />;
    const letter = String(name || '?').trim().charAt(0).toUpperCase();
    return (
        <div
            style={{
                ...style,
                display: 'grid',
                placeItems: 'center',
                background: `linear-gradient(140deg, ${palette.accent}, ${palette.accent2 || palette.accent})`,
                color: palette.accentText,
                fontSize: size * 0.56,
                fontWeight: 900,
                letterSpacing: '-0.04em',
            }}
        >
            {letter}
        </div>
    );
}

/** Thin rings that ripple out from the centre of a reveal. */
export function Rings({ color, size, count = 3, delay = 0, x = '50%', y = '50%' }) {
    const frame = useCurrentFrame();
    return (
        <>
            {Array.from({ length: count }, (_, i) => {
                const p = ease(frame, delay + i * 6, delay + i * 6 + 40, [0, 1], expoOut);
                return (
                    <div
                        key={i}
                        style={{
                            position: 'absolute',
                            left: x,
                            top: y,
                            width: size,
                            height: size,
                            marginLeft: -size / 2,
                            marginTop: -size / 2,
                            borderRadius: '50%',
                            border: `${Math.max(1, size * 0.003)}px solid ${alpha(color, 0.5 * (1 - p * 0.7))}`,
                            transform: `scale(${0.2 + p * (0.7 + i * 0.35)})`,
                            opacity: p > 0 ? 1 - p * 0.6 : 0,
                        }}
                    />
                );
            })}
        </>
    );
}

/** A huge outlined numeral behind a scene ("01"), drifting slowly for parallax. */
export function Numeral({ value, size, color, x, y, delay = 0 }) {
    const frame = useCurrentFrame();
    const p = ease(frame, delay, delay + 20, [0, 1], expoOut);
    return (
        <div
            style={{
                position: 'absolute',
                left: x,
                top: y,
                fontFamily: DISPLAY_FONT,
                fontSize: size,
                lineHeight: 0.8,
                color: 'transparent',
                WebkitTextStroke: `${Math.max(2, size * 0.006)}px ${alpha(color, 0.28)}`,
                transform: `translateY(${(1 - p) * size * 0.25 - frame * 0.25}px)`,
                opacity: p,
                letterSpacing: '0.02em',
            }}
        >
            {value}
        </div>
    );
}

/** Counts a figure up ("20,000+" → 0 … 20,000+), keeping its prefix, suffix and separators. */
export function CountUp({ value, size, color, delay = 4, duration = 30, font = DISPLAY_FONT }) {
    const frame = useCurrentFrame();
    const beat = useBeat();
    const m = String(value).match(/^(\D*?)(\d[\d,. ]*\d|\d)(.*)$/);
    const p = ease(frame, delay, delay + duration, [0, 1], expoOut);
    let shown = String(value);
    if (m) {
        const digits = m[2].replace(/[, ]/g, '');
        const decimals = digits.includes('.') ? digits.split('.')[1].length : 0;
        const n = parseFloat(digits) * p;
        const body = n.toFixed(decimals);
        const withSep = /,/.test(m[2]) ? Number(body).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : body;
        shown = `${m[1]}${withSep}${m[3]}`;
    }
    const scale = 0.9 + 0.1 * p + (p >= 1 ? beat * 0.03 : 0);
    return (
        <div style={{ fontFamily: font, fontSize: size, lineHeight: 0.9, color, transform: `scale(${scale})`, letterSpacing: '0.01em', opacity: interpolate(frame, [delay, delay + 6], [0, 1], clamp) }}>
            {shown}
        </div>
    );
}
