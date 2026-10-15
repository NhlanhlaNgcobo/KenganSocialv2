import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { interpolate } from 'remotion';
import { clamp, ease, pop } from './motion.js';

/**
 * Kinetic headline: words spring up out of a blur, one after another, and one key word gets
 * an accent marker that wipes in behind it.
 */

/** The word worth highlighting: the longest one that isn't filler. */
export function keyWordIndex(text) {
    const filler = /^(the|a|an|and|or|to|of|in|on|for|with|your|you|is|it|that|this|at|by|from|be|are|we|our|my)$/i;
    const list = String(text || '').split(' ');
    let best = -1;
    list.forEach((w, i) => {
        const clean = w.replace(/[^\p{L}\p{N}]/gu, '');
        if (filler.test(clean)) return;
        if (best < 0 || clean.length >= list[best].replace(/[^\p{L}\p{N}]/gu, '').length) best = i;
    });
    return best;
}

export function Kinetic({ text, size, color, accent, accentText, delay = 0, stagger = 3, align = 'center', weight = 800, calm = false, highlight = true, maxWidth }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const words = String(text || '').split(' ').filter(Boolean);
    const key = highlight ? keyWordIndex(text) : -1;

    return (
        <div
            style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: align === 'left' ? 'flex-start' : 'center',
                columnGap: '0.26em',
                rowGap: '0.04em',
                fontSize: size,
                fontWeight: weight,
                lineHeight: 1.04,
                letterSpacing: '-0.035em',
                color,
                textAlign: align,
                maxWidth,
            }}
        >
            {words.map((w, i) => {
                const local = frame - delay - (calm ? i * 1 : i * stagger);
                const p = calm ? ease(local, 0, fps * 0.45) : pop(local, fps, 0, { damping: 13, stiffness: 170, mass: 0.6 });
                const marked = i === key;
                const mark = marked ? ease(frame, delay + words.length * stagger + 4, delay + words.length * stagger + 14) : 0;
                return (
                    <span
                        key={i}
                        style={{
                            position: 'relative',
                            isolation: 'isolate',
                            display: 'inline-block',
                            opacity: interpolate(p, [0, 0.4], [0, 1], clamp),
                            transform: `translateY(${(1 - p) * 0.45}em) scale(${0.85 + 0.15 * p})`,
                            filter: `blur(${(1 - Math.min(1, p)) * 8}px)`,
                            color: marked && mark > 0.5 ? accentText : undefined,
                            transition: 'none',
                        }}
                    >
                        {marked ? (
                            <span
                                style={{
                                    position: 'absolute',
                                    left: '-0.12em',
                                    right: '-0.12em',
                                    top: '0.08em',
                                    bottom: '0.02em',
                                    background: accent,
                                    borderRadius: '0.14em',
                                    transform: `scaleX(${mark})`,
                                    transformOrigin: 'left center',
                                    zIndex: -1,
                                }}
                            />
                        ) : null}
                        {w}
                    </span>
                );
            })}
        </div>
    );
}

/** Supporting line: fades up as one block, softer than the headline. */
export function Subline({ text, size, color, delay = 10, align = 'center', maxWidth }) {
    const frame = useCurrentFrame();
    const p = ease(frame, delay, delay + 12);
    if (!text) return null;
    return (
        <div style={{ fontSize: size, fontWeight: 500, lineHeight: 1.32, color, opacity: p * 0.82, transform: `translateY(${(1 - p) * 14}px)`, textAlign: align, maxWidth, marginTop: size * 0.7 }}>
            {text}
        </div>
    );
}

export function Eyebrow({ text, size, accent, delay = 0 }) {
    const frame = useCurrentFrame();
    const p = ease(frame, delay, delay + 10);
    if (!text) return null;
    return (
        <div
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: size * 0.5,
                padding: `${size * 0.35}px ${size * 0.8}px`,
                marginBottom: size * 1.1,
                borderRadius: 999,
                border: `${Math.max(1, size * 0.06)}px solid ${accent}`,
                color: accent,
                fontSize: size,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                opacity: p,
                transform: `translateY(${(1 - p) * 10}px)`,
            }}
        >
            <span style={{ width: size * 0.45, height: size * 0.45, borderRadius: '50%', background: accent }} />
            {text}
        </div>
    );
}
