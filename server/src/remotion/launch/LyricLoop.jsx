import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

/**
 * Seamless looping backgrounds for lyric videos (rendered once by scripts/build-lyric-loops.mjs
 * and shipped in client/public/lyric-loops). Every motion completes a whole number of cycles in
 * LOOP_FRAMES, so the last frame flows straight into the first and the clip can repeat for the
 * length of any song.
 */
export const LOOP_SECONDS = 8;

export const LOOP_PRESETS = {
    aurora: { name: 'Aurora', colors: ['#06121f', '#1de9b6', '#7c4dff', '#00b0ff'] },
    'neon-grid': { name: 'Neon grid', colors: ['#0b0420', '#ff2bd6', '#22d3ee', '#ffb86b'] },
    particles: { name: 'Rising particles', colors: ['#05060a', '#ffd27a', '#ff8a5c', '#ffffff'] },
    bokeh: { name: 'Bokeh night', colors: ['#0a0710', '#ff6b9a', '#ffc46b', '#7aa2ff'] },
    waves: { name: 'Ocean waves', colors: ['#031427', '#0ea5e9', '#22d3ee', '#a5f3fc'] },
    warp: { name: 'Star warp', colors: ['#000005', '#ffffff', '#93c5fd', '#c4b5fd'] },
    liquid: { name: 'Liquid sunset', colors: ['#1a0714', '#ff5e62', '#ff9966', '#c471ed'] },
    vinyl: { name: 'Vinyl glow', colors: ['#0c0c10', '#e11d48', '#f59e0b', '#f5f5f5'] },
};

const TAU = Math.PI * 2;
/** Deterministic 0..1 noise. */
const rand = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
};
const glow = (color, a) => {
    const v = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
    return `${color}${v}`;
};

function Aurora({ p, w, h, c }) {
    const ribbons = [0, 1, 2, 3, 4];
    return (
        <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 120%, ${glow(c[3], 0.35)}, ${c[0]} 70%)` }}>
            {ribbons.map((i) => {
                const y = 0.22 + i * 0.13 + 0.05 * Math.sin(TAU * (p + i * 0.21));
                const skew = 12 * Math.sin(TAU * (2 * p + i * 0.3));
                return (
                    <div
                        key={i}
                        style={{
                            position: 'absolute',
                            left: '-25%',
                            width: '150%',
                            top: `${y * 100}%`,
                            height: h * 0.18,
                            transform: `skewY(${skew}deg) translateX(${8 * Math.sin(TAU * (p + i * 0.17))}%)`,
                            background: `linear-gradient(90deg, transparent, ${glow(c[1 + (i % 3)], 0.55)}, ${glow(c[1 + ((i + 1) % 3)], 0.4)}, transparent)`,
                            filter: `blur(${Math.round(Math.min(w, h) * 0.04)}px)`,
                            opacity: 0.55 + 0.35 * Math.sin(TAU * (p + i * 0.4)) ** 2,
                            mixBlendMode: 'screen',
                        }}
                    />
                );
            })}
        </AbsoluteFill>
    );
}

function NeonGrid({ p, w, h, c }) {
    const cell = Math.round(Math.min(w, h) / 9);
    // The grid scrolls exactly two cells per loop.
    const offset = (p * cell * 2) % cell;
    return (
        <AbsoluteFill style={{ background: `linear-gradient(to bottom, ${c[0]} 0%, #1b0a3a 48%, ${c[0]} 100%)` }}>
            <div
                style={{
                    position: 'absolute',
                    left: '50%',
                    top: '30%',
                    width: Math.min(w, h) * 0.55,
                    height: Math.min(w, h) * 0.55,
                    transform: `translate(-50%, -50%) scale(${1 + 0.03 * Math.sin(TAU * 4 * p)})`,
                    borderRadius: '50%',
                    background: `linear-gradient(to bottom, ${c[3]}, ${c[1]})`,
                    boxShadow: `0 0 ${Math.min(w, h) * 0.12}px ${glow(c[1], 0.6)}`,
                    WebkitMaskImage: 'repeating-linear-gradient(to bottom, #000 0 9%, transparent 9% 12%)',
                }}
            />
            <div
                style={{
                    position: 'absolute',
                    left: '-60%',
                    width: '220%',
                    top: '52%',
                    height: '70%',
                    transform: `perspective(${h * 0.6}px) rotateX(68deg)`,
                    transformOrigin: 'top',
                    backgroundImage: `linear-gradient(${c[2]} 3px, transparent 3px), linear-gradient(90deg, ${c[2]} 3px, transparent 3px)`,
                    backgroundSize: `${cell}px ${cell}px`,
                    backgroundPosition: `0 ${offset}px`,
                    filter: `drop-shadow(0 0 8px ${c[2]})`,
                    WebkitMaskImage: 'linear-gradient(to bottom, transparent, #000 25%)',
                }}
            />
            <AbsoluteFill style={{ background: `linear-gradient(to bottom, transparent 45%, ${glow(c[1], 0.25)} 52%, transparent 60%)` }} />
        </AbsoluteFill>
    );
}

function Particles({ p, w, h, c }) {
    return (
        <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 100%, #2a1608, ${c[0]} 65%)` }}>
            {Array.from({ length: 90 }, (_, i) => {
                const speed = 1 + Math.floor(rand(i) * 2); // 1 or 2 full trips per loop
                const y = 1.1 - ((p * speed + rand(i + 9)) % 1) * 1.25;
                const x = rand(i + 3) + 0.03 * Math.sin(TAU * (p * 2 + rand(i)));
                const size = Math.min(w, h) * (0.004 + rand(i + 5) * 0.012);
                return (
                    <div
                        key={i}
                        style={{
                            position: 'absolute',
                            left: `${x * 100}%`,
                            top: `${y * 100}%`,
                            width: size,
                            height: size,
                            borderRadius: '50%',
                            background: c[1 + (i % 3)],
                            boxShadow: `0 0 ${size * 3}px ${c[1 + (i % 3)]}`,
                            opacity: 0.35 + 0.65 * Math.sin(TAU * (p * speed + rand(i + 1))) ** 2,
                        }}
                    />
                );
            })}
        </AbsoluteFill>
    );
}

function Bokeh({ p, w, h, c }) {
    const base = Math.min(w, h);
    return (
        <AbsoluteFill style={{ background: `linear-gradient(160deg, ${c[0]}, #1d1028)` }}>
            {Array.from({ length: 26 }, (_, i) => {
                const r = base * (0.04 + rand(i) * 0.12);
                const cx = rand(i + 2) * w + 0.04 * w * Math.cos(TAU * (p + rand(i + 4)));
                const cy = rand(i + 6) * h + 0.04 * h * Math.sin(TAU * (p + rand(i + 4)));
                return (
                    <div
                        key={i}
                        style={{
                            position: 'absolute',
                            left: cx - r,
                            top: cy - r,
                            width: r * 2,
                            height: r * 2,
                            borderRadius: '50%',
                            background: `radial-gradient(circle, ${glow(c[1 + (i % 3)], 0.55)}, ${glow(c[1 + (i % 3)], 0.12)} 65%, transparent 70%)`,
                            filter: `blur(${2 + rand(i + 8) * 6}px)`,
                            opacity: 0.4 + 0.6 * Math.sin(TAU * (p + rand(i + 7))) ** 2,
                        }}
                    />
                );
            })}
        </AbsoluteFill>
    );
}

function Waves({ p, w, h, c }) {
    const layers = [0, 1, 2, 3];
    return (
        <AbsoluteFill style={{ background: `linear-gradient(to bottom, ${c[0]}, #062a4a)` }}>
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', inset: 0 }}>
                {layers.map((i) => {
                    const amp = h * (0.03 + i * 0.012);
                    const base = h * (0.5 + i * 0.12);
                    const cycles = 2 + i; // waves across the frame
                    const shift = TAU * (p * (i % 2 ? 1 : 2)); // whole cycles per loop
                    let d = `M 0 ${h}`;
                    for (let x = 0; x <= w; x += w / 60) d += ` L ${x} ${base + amp * Math.sin((x / w) * TAU * cycles + shift)}`;
                    d += ` L ${w} ${h} Z`;
                    return <path key={i} d={d} fill={glow(c[1 + (i % 3)], 0.22 + i * 0.12)} />;
                })}
            </svg>
            <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 20%, ${glow(c[3], 0.25)}, transparent 55%)` }} />
        </AbsoluteFill>
    );
}

function Warp({ p, w, h, c }) {
    const max = Math.hypot(w, h) / 2;
    return (
        <AbsoluteFill style={{ background: `radial-gradient(circle, #0b1030, ${c[0]} 70%)` }}>
            {Array.from({ length: 160 }, (_, i) => {
                const angle = rand(i) * TAU;
                // Each star travels centre → edge exactly once (or twice) per loop.
                const t = (p * (1 + (i % 2)) + rand(i + 1)) % 1;
                const dist = max * t ** 2.2;
                const len = 2 + dist * 0.06;
                return (
                    <div
                        key={i}
                        style={{
                            position: 'absolute',
                            left: w / 2 + Math.cos(angle) * dist,
                            top: h / 2 + Math.sin(angle) * dist,
                            width: len,
                            height: 2 + t * 2,
                            transform: `rotate(${angle}rad)`,
                            transformOrigin: 'left center',
                            borderRadius: 2,
                            background: c[1 + (i % 3)],
                            opacity: Math.min(1, t * 3) * (1 - t ** 6),
                        }}
                    />
                );
            })}
        </AbsoluteFill>
    );
}

function Liquid({ p, w, h, c }) {
    const base = Math.max(w, h);
    const blobs = [
        { fx: 1, fy: 2, ph: 0, color: c[1] },
        { fx: 2, fy: 1, ph: 0.3, color: c[2] },
        { fx: 1, fy: 1, ph: 0.6, color: c[3] },
        { fx: 2, fy: 3, ph: 0.15, color: c[1] },
    ];
    return (
        <AbsoluteFill style={{ background: c[0], overflow: 'hidden' }}>
            <AbsoluteFill style={{ filter: `blur(${Math.round(base * 0.06)}px) saturate(1.3)` }}>
                {blobs.map((b, i) => {
                    const x = 0.5 + 0.3 * Math.sin(TAU * (b.fx * p + b.ph));
                    const y = 0.5 + 0.3 * Math.cos(TAU * (b.fy * p + b.ph));
                    const r = base * (0.28 + 0.06 * Math.sin(TAU * (p + b.ph)));
                    return <div key={i} style={{ position: 'absolute', left: x * w - r, top: y * h - r, width: r * 2, height: r * 2, borderRadius: '50%', background: b.color, opacity: 0.85 }} />;
                })}
            </AbsoluteFill>
            <AbsoluteFill style={{ background: 'radial-gradient(circle, transparent 40%, rgba(0,0,0,0.45))' }} />
        </AbsoluteFill>
    );
}

function Vinyl({ p, w, h, c }) {
    const size = Math.min(w, h) * 0.78;
    return (
        <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 50%, ${glow(c[1], 0.35)}, ${c[0]} 60%)`, alignItems: 'center', justifyContent: 'center' }}>
            <div
                style={{
                    width: size,
                    height: size,
                    borderRadius: '50%',
                    transform: `rotate(${p * 360 * 4}deg)`, // four turns per loop
                    background: `repeating-radial-gradient(circle, #111 0 2px, #1c1c22 2px 4px)`,
                    boxShadow: `0 0 ${size * 0.15}px ${glow(c[1], 0.5)}, inset 0 0 ${size * 0.08}px #000`,
                    position: 'relative',
                }}
            >
                <div style={{ position: 'absolute', inset: '33%', borderRadius: '50%', background: `conic-gradient(${c[1]}, ${c[2]}, ${c[1]})` }} />
                <div style={{ position: 'absolute', inset: '48.5%', borderRadius: '50%', background: c[0] }} />
                <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'conic-gradient(from 20deg, transparent 0 10%, rgba(255,255,255,0.12) 13%, transparent 16% 60%, rgba(255,255,255,0.08) 63%, transparent 66%)' }} />
            </div>
            <AbsoluteFill style={{ background: `radial-gradient(circle, transparent 55%, ${glow(c[2], 0.12 + 0.08 * Math.sin(TAU * 4 * p) ** 2)})` }} />
        </AbsoluteFill>
    );
}

const SCENES = { aurora: Aurora, 'neon-grid': NeonGrid, particles: Particles, bokeh: Bokeh, waves: Waves, warp: Warp, liquid: Liquid, vinyl: Vinyl };

export function LyricLoop({ preset = 'aurora' }) {
    const frame = useCurrentFrame();
    const { width, height, durationInFrames } = useVideoConfig();
    const p = frame / durationInFrames; // 0 → 1 across the loop; frame N wraps to frame 0
    const Scene = SCENES[preset] || Aurora;
    return (
        <AbsoluteFill style={{ overflow: 'hidden' }}>
            <Scene p={p} w={width} h={height} c={(LOOP_PRESETS[preset] || LOOP_PRESETS.aurora).colors} />
        </AbsoluteFill>
    );
}
