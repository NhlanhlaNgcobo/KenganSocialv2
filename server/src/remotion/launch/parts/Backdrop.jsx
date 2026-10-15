import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { lightness } from './motion.js';

/**
 * Living background: three slow light blobs in the brand colours, a fine grain and a vignette.
 * Keeps every frame moving even when the text holds still.
 */

const GRAIN =
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.55'/></svg>\")";

export function Backdrop({ palette, intensity = 1 }) {
    const frame = useCurrentFrame();
    const { width, height, fps } = useVideoConfig();
    const t = frame / fps;
    const dark = lightness(palette.bg) < 0.5;
    const blob = (cx, cy, r, color, alpha) =>
        `radial-gradient(${r}px ${r}px at ${cx}px ${cy}px, ${color}${Math.round(alpha * 255)
            .toString(16)
            .padStart(2, '0')}, transparent 70%)`;
    const toHex = (c) => {
        if (/^#[0-9a-f]{6}$/i.test(c)) return c;
        const m = String(c).match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/);
        if (m) return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
        return dark ? '#8b5cf6' : '#6d28d9';
    };
    const accent = toHex(palette.accent);
    const unit = Math.max(width, height);
    const a = 0.32 * intensity * (dark ? 1 : 0.7);

    return (
        <AbsoluteFill style={{ background: palette.bg, overflow: 'hidden' }}>
            <AbsoluteFill
                style={{
                    background: [
                        blob(width * (0.2 + 0.08 * Math.sin(t * 0.5)), height * (0.18 + 0.06 * Math.cos(t * 0.4)), unit * 0.55, accent, a),
                        blob(width * (0.85 + 0.06 * Math.cos(t * 0.35)), height * (0.75 + 0.08 * Math.sin(t * 0.45)), unit * 0.5, accent, a * 0.75),
                        blob(width * (0.6 + 0.1 * Math.sin(t * 0.25)), height * (0.1 + 0.05 * Math.sin(t * 0.6)), unit * 0.35, dark ? '#ffffff' : '#000000', dark ? 0.05 : 0.04),
                    ].join(', '),
                }}
            />
            <AbsoluteFill style={{ backgroundImage: GRAIN, opacity: dark ? 0.08 : 0.05, mixBlendMode: dark ? 'screen' : 'multiply' }} />
            <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 55%, ${dark ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.08)'} 100%)` }} />
        </AbsoluteFill>
    );
}
