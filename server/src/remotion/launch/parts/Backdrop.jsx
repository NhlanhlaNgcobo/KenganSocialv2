import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { alpha, clamp, lightness, mix } from './motion.js';

/**
 * Living background in the brand's colours: a drifting gradient mesh, a perspective grid that
 * glides underneath, a light sweep at every scene change, fine grain and a vignette.
 * Rendered once under all scenes, so it stays continuous through every transition.
 */

const GRAIN =
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.55'/></svg>\")";

/** Frame of the latest cut at or before `frame`. */
const lastOf = (list, frame) => list.reduce((acc, f) => (f <= frame ? f : acc), -1000);

export function Backdrop({ palette, intensity = 1, cuts = [], grid = true }) {
    const frame = useCurrentFrame();
    const { width, height, fps } = useVideoConfig();
    const t = frame / fps;
    const dark = lightness(palette.bg) < 0.5;
    const accent = palette.accent;
    const accent2 = palette.accent2 || mix(accent, palette.fg, 0.4);
    const unit = Math.max(width, height);
    // Colour on dark backgrounds glows; on light ones it stays a gentle tint.
    const a = (dark ? 0.34 : 0.16) * intensity * (palette.monochrome ? 0.7 : 1);
    const blob = (cx, cy, r, color, al) => `radial-gradient(${r}px ${r * 0.8}px at ${cx}px ${cy}px, ${alpha(color, al)}, transparent 70%)`;
    const base = dark ? `linear-gradient(160deg, ${mix(palette.bg, accent, 0.06)}, ${palette.bg} 55%, ${mix(palette.bg, accent2, 0.08)})` : `linear-gradient(160deg, ${mix(palette.bg, accent, 0.05)}, ${palette.bg} 50%, ${mix(palette.bg, accent2, 0.07)})`;

    // Light sweep: a soft diagonal band that crosses the frame right after each cut.
    const since = frame - lastOf(cuts, frame);
    const sweep = interpolate(since, [0, fps * 0.9], [-0.4, 1.4], clamp);
    const sweepOn = since >= 0 && since < fps * 0.9;
    const line = dark ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.05)';

    return (
        <AbsoluteFill style={{ background: palette.bg, overflow: 'hidden' }}>
            <AbsoluteFill style={{ background: base }} />
            <AbsoluteFill
                style={{
                    background: [
                        blob(width * (0.18 + 0.1 * Math.sin(t * 0.45)), height * (0.2 + 0.08 * Math.cos(t * 0.38)), unit * 0.6, accent, a),
                        blob(width * (0.86 + 0.07 * Math.cos(t * 0.33)), height * (0.78 + 0.08 * Math.sin(t * 0.41)), unit * 0.55, accent2, a * 0.85),
                        blob(width * (0.62 + 0.14 * Math.sin(t * 0.22)), height * (0.06 + 0.06 * Math.sin(t * 0.57)), unit * 0.38, dark ? '#ffffff' : accent, dark ? 0.06 : a * 0.5),
                        blob(width * (0.35 + 0.12 * Math.cos(t * 0.29)), height * (0.95 + 0.04 * Math.cos(t * 0.5)), unit * 0.45, accent, a * 0.6),
                    ].join(', '),
                }}
            />
            {grid ? (
                <div
                    style={{
                        position: 'absolute',
                        left: '-50%',
                        right: '-50%',
                        top: '52%',
                        height: '120%',
                        transform: 'perspective(900px) rotateX(68deg)',
                        transformOrigin: 'top center',
                        backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
                        backgroundSize: `${unit * 0.06}px ${unit * 0.06}px`,
                        backgroundPosition: `0 ${(frame * unit * 0.0016) % (unit * 0.06)}px`,
                        WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 30%, black 60%, transparent)',
                        maskImage: 'linear-gradient(to bottom, transparent, black 30%, black 60%, transparent)',
                        opacity: 0.9,
                    }}
                />
            ) : null}
            {sweepOn ? (
                <AbsoluteFill
                    style={{
                        background: `linear-gradient(105deg, transparent ${sweep * 100 - 18}%, ${dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.5)'} ${sweep * 100}%, transparent ${sweep * 100 + 18}%)`,
                    }}
                />
            ) : null}
            <AbsoluteFill style={{ backgroundImage: GRAIN, opacity: dark ? 0.08 : 0.05, mixBlendMode: dark ? 'screen' : 'multiply' }} />
            <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 50%, ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.07)'} 100%)` }} />
        </AbsoluteFill>
    );
}
