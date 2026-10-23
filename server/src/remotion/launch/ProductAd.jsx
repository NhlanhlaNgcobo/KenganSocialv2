import React from 'react';
import { AbsoluteFill, Audio, Easing, Img, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { familyFor, useFonts } from './LaunchVideo.jsx';
import { AdCaptions } from './parts/AdCaptions.jsx';
import { DISPLAY_FONT } from './parts/Decor.jsx';
import { alpha, beatPulse, clamp, mix } from './parts/motion.js';

/**
 * Product ads: the creator's product photos staged in 3D. Each preset is a camera and lighting
 * style over one shared timeline: an intro on the hero photo, one segment per angle (or selling
 * point), then an end card with the offer and call to action. Angle changes land on the music's
 * beat. Every frame is a pure function of the frame number.
 */

const easeOut = Easing.out(Easing.cubic);
const easeIn = Easing.in(Easing.cubic);
const smooth = Easing.bezier(0.65, 0, 0.35, 1);
const lerp = (f, a, b, out, easing = easeOut) => interpolate(f, [a, b], out, { ...clamp, easing });

/** How angles change, per preset, and how long the change takes (frames). */
const TRANSITION = { turntable: ['flip', 16], float: ['flip', 18], orbit: ['dissolve', 16], reveal: ['dip', 20], showcase: ['whip', 10] };

/**
 * Segments: intro (hero photo), one per angle or selling point, end card (hero photo).
 * Inner boundaries snap to a beat when one is close.
 */
export function timeline({ seconds, photos, points, preset, beats = [], fps = 30 }) {
    const total = Math.round(seconds * fps);
    const endStart = total - Math.round(Math.max(2.6 * fps, total * 0.22));
    const introEnd = Math.round(Math.min(2.2 * fps, total * 0.2));
    const middle = endStart - introEnd;
    const wanted = preset === 'showcase' ? Math.max(photos, points, Math.round(middle / (1.7 * fps))) : Math.max(photos, points, 1);
    const count = Math.max(1, Math.min(wanted, Math.floor(middle / (1.2 * fps)), 8));
    const cuts = [introEnd];
    for (let i = 1; i < count; i++) cuts.push(introEnd + Math.round((middle * i) / count));
    cuts.push(endStart);
    const snapped = cuts.map((c, i) => {
        if (i === 0 || i === cuts.length - 1) return c;
        const near = beats.map((b) => Math.round(b * fps)).filter((b) => Math.abs(b - c) <= 0.35 * fps && b > cuts[i - 1] + fps && b < cuts[i + 1] - fps);
        return near.length ? near.reduce((a, b) => (Math.abs(b - c) < Math.abs(a - c) ? b : a)) : c;
    });
    const segments = [{ kind: 'intro', from: 0, to: snapped[0], photo: 0, point: -1 }];
    for (let i = 0; i < count; i++) {
        segments.push({ kind: 'angle', from: snapped[i], to: snapped[i + 1], photo: photos > 1 ? (i + 1) % photos : 0, point: i < points ? i : -1 });
    }
    segments.push({ kind: 'end', from: endStart, to: total, photo: 0, point: -1 });
    return { total, endStart, introEnd, segments };
}

/** Preset motion inside a segment: the slow camera move while an angle is held. */
function holdMotion(preset, seg, f, fps, index) {
    const p = Math.max(0, Math.min(1, (f - seg.from) / Math.max(1, seg.to - seg.from)));
    const t = f / fps;
    switch (preset) {
        case 'turntable':
            return { rotY: interpolate(p, [0, 1], [-22, 22], { easing: smooth }), rotX: 7, scale: 1, x: 0, y: 0, rotZ: 0 };
        case 'orbit': {
            const push = seg.kind === 'angle' && index % 2 === 1 ? interpolate(p, [0, 1], [1, 1.28], { easing: smooth }) : 1;
            return { rotY: 30 * Math.sin(2 * Math.PI * (p * 0.7 + index * 0.27)), rotX: 11 + 4 * Math.cos(2 * Math.PI * p), scale: push, x: 0, y: 0, rotZ: 0 };
        }
        case 'float':
            return { rotY: 20 * Math.sin((2 * Math.PI * t) / 5.2), rotX: 4, rotZ: 3 * Math.sin((2 * Math.PI * t) / 4.1), scale: 1, x: 0, y: 2.4 * Math.sin((2 * Math.PI * t) / 3.1) };
        case 'reveal':
            return { rotY: interpolate(p, [0, 1], [-14, 14]), rotX: 5, scale: interpolate(p, [0, 1], [1, 1.07]), x: 0, y: 0, rotZ: 0 };
        default: // showcase
            return { rotY: 10 * Math.sin((2 * Math.PI * t) / 2.4), rotX: 4, scale: 1, x: 0, y: 0, rotZ: 0 };
    }
}

/** The intro's entrance, applied on top of the hold motion. */
function entrance(preset, f, fps) {
    const s = spring({ frame: f - 4, fps, config: { damping: 15, stiffness: 90, mass: 0.9 } });
    switch (preset) {
        case 'turntable':
            return { rotY: (1 - s) * -160, y: (1 - s) * 18, opacity: lerp(f, 2, 14, [0, 1]), brightness: 1 };
        case 'orbit':
            return { rotY: (1 - s) * 70, scale: 0.6 + 0.4 * s, opacity: lerp(f, 0, 12, [0, 1]), brightness: 1 };
        case 'float':
            return { y: (1 - s) * -45, rotZ: (1 - s) * -14, opacity: lerp(f, 0, 10, [0, 1]), brightness: 1 };
        case 'reveal':
            return { opacity: 1, brightness: lerp(f, 6, 2 * fps, [0.04, 1], easeIn), scale: 0.92 + 0.08 * s };
        default:
            return { rotY: (1 - s) * 80, x: (1 - s) * 60, opacity: lerp(f, 0, 6, [0, 1]), brightness: 1 };
    }
}

/** One or two product layers at a boundary, with the preset's transition applied. */
function layersAt(f, tl, preset, fps) {
    const [kind, len] = TRANSITION[preset];
    const half = len / 2;
    const segs = tl.segments;
    const i = segs.findIndex((s) => f >= s.from && f < s.to);
    const index = i < 0 ? segs.length - 1 : i;
    const layer = (n, extra = {}) => ({ seg: segs[n], index: n, opacity: 1, brightness: 1, blur: 0, rotY: 0, x: 0, scale: 1, ...extra });
    const prevBoundary = segs[index].from;
    const nextBoundary = segs[index].to;
    // Close to the next boundary: the current layer leaves (and the next arrives, for overlapping kinds).
    if (index < segs.length - 1 && f >= nextBoundary - half) {
        const k = (f - (nextBoundary - half)) / half; // 0..1
        if (kind === 'flip') return [layer(index, { rotY: 90 * easeIn(k) })];
        if (kind === 'dip') return [layer(index, { brightness: 1 - easeIn(k) })];
        if (kind === 'whip') return [layer(index, { x: -130 * easeIn(k), rotY: -55 * easeIn(k), blur: 10 * k })];
        const both = (f - (nextBoundary - half)) / len;
        return [layer(index, { opacity: 1 - both, blur: 9 * both, scale: 1 + 0.06 * both }), layer(index + 1, { opacity: both, blur: 9 * (1 - both), scale: 0.94 + 0.06 * both })];
    }
    if (index > 0 && f < prevBoundary + half) {
        const k = (f - prevBoundary) / half;
        if (kind === 'flip') return [layer(index, { rotY: -90 * (1 - easeOut(k)) })];
        if (kind === 'dip') return [layer(index, { brightness: easeOut(k) })];
        if (kind === 'whip') {
            const s = spring({ frame: f - prevBoundary, fps, config: { damping: 13, stiffness: 170, mass: 0.6 } });
            return [layer(index, { x: 130 * (1 - s), rotY: 55 * (1 - s) })];
        }
        const both = 0.5 + (f - prevBoundary) / len;
        return [layer(index - 1, { opacity: 1 - both, blur: 9 * both, scale: 1 + 0.06 * both }), layer(index, { opacity: both, blur: 9 * (1 - both), scale: 0.94 + 0.06 * both })];
    }
    return [layer(index)];
}

/** Where the product sits: the main stage, moving to a smaller spot for the end card. */
function stage(width, height, endProgress) {
    const vertical = height > width * 1.2;
    const landscape = width > height * 1.2;
    const main = landscape
        ? { cx: 0.33, cy: 0.5, w: 0.44, h: 0.7 }
        : vertical
          ? { cx: 0.5, cy: 0.45, w: 0.8, h: 0.44 }
          : { cx: 0.5, cy: 0.46, w: 0.62, h: 0.52 };
    const end = landscape ? { cx: 0.3, cy: 0.5, w: 0.34, h: 0.56 } : vertical ? { cx: 0.5, cy: 0.3, w: 0.62, h: 0.3 } : { cx: 0.5, cy: 0.31, w: 0.46, h: 0.34 };
    const box = Object.fromEntries(Object.keys(main).map((k) => [k, main[k] + (end[k] - main[k]) * endProgress]));
    return { ...box, vertical, landscape };
}

function ProductLayer({ photo, layer, motion, entry, box, width, height, preset, fps, frame }) {
    const w = box.w * width;
    const h = box.h * height;
    const rotY = motion.rotY + layer.rotY + (entry?.rotY || 0);
    const turn = Math.abs(Math.cos((rotY * Math.PI) / 180));
    const shade = (0.72 + 0.28 * turn) * layer.brightness * (entry?.brightness ?? 1);
    const scale = motion.scale * layer.scale * (entry?.scale || 1);
    const x = (motion.x + layer.x + (entry?.x || 0)) / 100;
    const y = (motion.y + (entry?.y || 0)) / 100;
    const opacity = layer.opacity * (entry?.opacity ?? 1);
    const sweep = ((frame / fps) * 0.45 + layer.index * 0.37) % 1.6;
    const floor = preset === 'turntable' || preset === 'reveal';
    const card = !photo.cutout;
    const image = (
        <Img
            src={photo.src}
            style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                ...(card ? { objectFit: 'cover', borderRadius: Math.min(w, h) * 0.06 } : {}),
            }}
        />
    );
    return (
        <div
            style={{
                position: 'absolute',
                left: box.cx * width - w / 2 + x * width,
                top: box.cy * height - h / 2 + y * height,
                width: w,
                height: h,
                perspective: Math.max(width, height) * 1.6,
                opacity,
                filter: layer.blur ? `blur(${layer.blur}px)` : undefined,
            }}
        >
            {/* Contact shadow: narrower as the product turns edge-on. */}
            <div
                style={{
                    position: 'absolute',
                    left: '50%',
                    bottom: -h * 0.04,
                    width: w * (0.35 + 0.4 * turn) * scale,
                    height: h * 0.07,
                    transform: `translate(-50%, ${preset === 'float' ? -motion.y * 0.4 : 0}%)`,
                    borderRadius: '50%',
                    background: 'radial-gradient(closest-side, rgba(0,0,0,.55), transparent)',
                    opacity: (preset === 'float' ? 0.55 - motion.y * 0.05 : 0.8) * shade,
                }}
            />
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    transformStyle: 'preserve-3d',
                    transform: `rotateX(${motion.rotX}deg) rotateY(${rotY}deg) rotateZ(${motion.rotZ + (entry?.rotZ || 0)}deg) scale(${scale})`,
                    filter: `brightness(${shade})${card ? '' : ` drop-shadow(0 ${h * 0.03}px ${h * 0.04}px rgba(0,0,0,.45))`}`,
                }}
            >
                <div style={{ position: 'absolute', inset: 0, ...(card ? { borderRadius: Math.min(w, h) * 0.06, overflow: 'hidden', boxShadow: `0 ${h * 0.05}px ${h * 0.12}px rgba(0,0,0,.5)` } : {}) }}>
                    {image}
                    {/* Light sweep, clipped to the product's own shape. */}
                    <div
                        style={{
                            position: 'absolute',
                            inset: 0,
                            background: `linear-gradient(105deg, transparent ${(sweep - 0.3) * 100}%, rgba(255,255,255,.42) ${sweep * 100}%, transparent ${(sweep + 0.3) * 100}%)`,
                            mixBlendMode: 'soft-light',
                            ...(card
                                ? {}
                                : { WebkitMaskImage: `url(${photo.src})`, WebkitMaskSize: 'contain', WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'center' }),
                        }}
                    />
                </div>
                {floor ? (
                    <div
                        style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            top: '100%',
                            height: '100%',
                            transform: 'scaleY(-1)',
                            opacity: preset === 'reveal' ? 0.14 : 0.22,
                            WebkitMaskImage: 'linear-gradient(to top, rgba(0,0,0,.9), transparent 45%)',
                        }}
                    >
                        {image}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

/** Deterministic 0..1 noise for particle positions. */
const rand = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
};

function Background({ preset, palette, frame, fps, width, height, box, floorTop, segIndex, introEnd }) {
    const t = frame / fps;
    const bg = palette.bg;
    const deep = mix(bg, '#000000', 0.55);
    const glow = alpha(palette.accent, 0.3);
    const cx = `${box.cx * 100}%`;
    const cy = `${box.cy * 100}%`;
    if (preset === 'reveal') {
        const r = lerp(frame, 0, introEnd + 10, [8, 46], easeOut);
        const sx = box.cx * 100 + 6 * Math.sin(t * 0.6);
        return (
            <AbsoluteFill style={{ background: mix(bg, '#000000', 0.88) }}>
                <AbsoluteFill style={{ background: `radial-gradient(ellipse ${r}% ${r * 1.25}% at ${sx}% ${box.cy * 100 - 4}%, rgba(255,255,255,.2), ${alpha(palette.accent, 0.08)} 45%, transparent 75%)` }} />
                {Array.from({ length: 26 }, (_, i) => {
                    const px = (box.cx + (rand(i) - 0.5) * 0.5) * 100;
                    const py = ((rand(i + 50) + t * 0.02 * (0.5 + rand(i + 9))) % 1) * 100;
                    return <div key={i} style={{ position: 'absolute', left: `${px}%`, top: `${100 - py}%`, width: 3, height: 3, borderRadius: '50%', background: '#fff', opacity: 0.1 + 0.25 * rand(i + 3) }} />;
                })}
                <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: height * 0.07, background: '#000' }} />
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: height * 0.07, background: '#000' }} />
            </AbsoluteFill>
        );
    }
    if (preset === 'orbit') {
        const shift = (t * 40) % 80;
        return (
            <AbsoluteFill style={{ background: `radial-gradient(circle at ${cx} ${cy}, ${mix(bg, palette.accent, 0.18)}, ${deep} 70%)` }}>
                <div
                    style={{
                        position: 'absolute',
                        left: '-50%',
                        right: '-50%',
                        top: '58%',
                        height: '80%',
                        transform: `perspective(${height}px) rotateX(72deg)`,
                        transformOrigin: 'top',
                        backgroundImage: `linear-gradient(${alpha(palette.fg, 0.12)} 2px, transparent 2px), linear-gradient(90deg, ${alpha(palette.fg, 0.12)} 2px, transparent 2px)`,
                        backgroundSize: '80px 80px',
                        backgroundPosition: `0 ${shift}px`,
                        WebkitMaskImage: 'linear-gradient(to bottom, #000, transparent 70%)',
                    }}
                />
                <AbsoluteFill style={{ background: 'radial-gradient(circle, transparent 55%, rgba(0,0,0,.55))' }} />
            </AbsoluteFill>
        );
    }
    if (preset === 'float') {
        return (
            <AbsoluteFill style={{ background: `linear-gradient(160deg, ${mix(bg, palette.accent, 0.12)}, ${deep})` }}>
                {[0, 1].map((i) => (
                    <div
                        key={i}
                        style={{
                            position: 'absolute',
                            width: width * 0.7,
                            height: width * 0.7,
                            left: `${(i ? 60 : 5) + 8 * Math.sin(t / (3 + i))}%`,
                            top: `${(i ? 55 : 10) + 6 * Math.cos(t / (4 + i))}%`,
                            borderRadius: '50%',
                            background: `radial-gradient(circle, ${alpha(i ? mix(palette.accent, palette.fg, 0.35) : palette.accent, i ? 0.14 : 0.22)}, transparent 65%)`,
                        }}
                    />
                ))}
                <div style={{ position: 'absolute', left: cx, top: cy, width: width * 0.9, height: width * 0.9, transform: 'translate(-50%,-50%)', borderRadius: '50%', background: `radial-gradient(circle, ${glow}, transparent 62%)` }} />
                {Array.from({ length: 30 }, (_, i) => {
                    const py = (rand(i + 20) + t * 0.03 * (0.4 + rand(i))) % 1;
                    return <div key={i} style={{ position: 'absolute', left: `${rand(i) * 100}%`, top: `${(1 - py) * 100}%`, width: 4 + 6 * rand(i + 7), height: 4 + 6 * rand(i + 7), borderRadius: '50%', background: alpha(palette.fg, 0.18) }} />;
                })}
            </AbsoluteFill>
        );
    }
    if (preset === 'showcase') {
        const tint = segIndex % 2 === 1 ? mix(bg, palette.accent, 0.28) : deep;
        return (
            <AbsoluteFill style={{ background: tint }}>
                <div
                    style={{
                        position: 'absolute',
                        left: '-30%',
                        width: '160%',
                        top: `${box.cy * 100 - 12}%`,
                        height: '24%',
                        transform: `rotate(-12deg) translateX(${((t * 6) % 10) - 5}%)`,
                        background: alpha(palette.accent, 0.22),
                    }}
                />
                <div style={{ position: 'absolute', left: cx, top: cy, width: width, height: width, transform: 'translate(-50%,-50%)', borderRadius: '50%', background: `radial-gradient(circle, ${glow}, transparent 60%)` }} />
            </AbsoluteFill>
        );
    }
    // turntable: studio sweep with a horizon and a glow behind the product.
    return (
        <AbsoluteFill style={{ background: `linear-gradient(to bottom, ${mix(bg, palette.fg, 0.06)}, ${deep})` }}>
            <div style={{ position: 'absolute', left: cx, top: cy, width: width * 1.1, height: width * 1.1, transform: 'translate(-50%,-50%)', borderRadius: '50%', background: `radial-gradient(circle, ${glow}, transparent 60%)` }} />
            <div style={{ position: 'absolute', left: 0, right: 0, top: `${floorTop * 100}%`, bottom: 0, background: `linear-gradient(to bottom, ${alpha(palette.fg, 0.07)}, transparent)` }} />
        </AbsoluteFill>
    );
}

/** Name, tagline, the segment's selling point and the end card. */
function Copy({ props, tl, frame, fps, width, height, box, font }) {
    const { palette, preset } = props;
    const u = Math.min(width, height) / 100;
    const seg = tl.segments.find((s) => frame >= s.from && frame < s.to) || tl.segments.at(-1);
    const endIn = lerp(frame, tl.endStart, tl.endStart + 14, [0, 1]);
    const textColumn = box.landscape ? { left: '60%', right: '6%', textAlign: 'left' } : { left: '7%', right: '7%', textAlign: 'center' };
    const reveal = preset === 'reveal';
    const nameStyle = {
        fontFamily: reveal ? font : DISPLAY_FONT,
        fontWeight: 800,
        textTransform: reveal ? 'uppercase' : 'none',
        letterSpacing: reveal ? u * 0.9 : 0,
        lineHeight: 1,
        color: palette.fg,
    };

    // Intro: the name, word by word, then the tagline.
    const introOut = lerp(frame, tl.introEnd - 8, tl.introEnd + 4, [1, 0], easeIn);
    const words = props.name.split(/\s+/);
    const introTop = box.landscape ? '34%' : box.vertical ? '9%' : '7%';
    const intro =
        frame < tl.introEnd + 4 ? (
            <div style={{ position: 'absolute', top: introTop, ...textColumn, opacity: introOut }}>
                <div style={{ ...nameStyle, fontSize: u * (reveal ? 7 : box.landscape ? 10 : 12) }}>
                    {words.map((wd, i) => {
                        const s = spring({ frame: frame - 6 - i * 4, fps, config: { damping: 16, stiffness: 140 } });
                        return (
                            <span key={i} style={{ display: 'inline-block', marginRight: '0.25em', transform: `translateY(${(1 - s) * 60}%)`, opacity: s }}>
                                {wd}
                            </span>
                        );
                    })}
                </div>
                {props.tagline ? (
                    <div style={{ marginTop: u * 2, fontFamily: font, fontSize: u * 3.6, fontWeight: 500, color: alpha(palette.fg, 0.82), opacity: lerp(frame, 18, 30, [0, 1]) }}>{props.tagline}</div>
                ) : null}
            </div>
        ) : null;

    // Angle segments: the product name as a small label, and the segment's selling point.
    let point = null;
    if (seg.kind === 'angle') {
        const local = frame - seg.from;
        const out = lerp(frame, seg.to - 8, seg.to, [1, 0], easeIn);
        const label = (
            <div style={{ position: 'absolute', top: box.landscape ? '12%' : box.vertical ? '8%' : '6%', ...textColumn, fontFamily: font, fontWeight: 700, letterSpacing: u * 0.5, textTransform: 'uppercase', fontSize: u * 2.4, color: alpha(palette.fg, 0.7) }}>
                {props.name}
            </div>
        );
        const text = seg.point >= 0 ? props.points[seg.point] : '';
        const s = spring({ frame: local - 6, fps, config: { damping: 14, stiffness: 150 } });
        const pointTop = box.landscape ? '44%' : box.vertical ? '72%' : '76%';
        point = (
            <>
                {label}
                {text ? (
                    preset === 'showcase' ? (
                        <div style={{ position: 'absolute', top: pointTop, ...textColumn, opacity: out }}>
                            <div style={{ fontFamily: DISPLAY_FONT, fontSize: u * (box.landscape ? 6.5 : 8), lineHeight: 1.02, color: palette.fg, transform: `scale(${0.7 + 0.3 * s})`, opacity: s, textTransform: 'uppercase' }}>{text}</div>
                        </div>
                    ) : (
                        <div style={{ position: 'absolute', top: pointTop, ...textColumn, opacity: out }}>
                            <span
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: u * 1.4,
                                    padding: `${u * 1.5}px ${u * 2.6}px`,
                                    borderRadius: 999,
                                    background: alpha(palette.bg, 0.62),
                                    border: `2px solid ${alpha(palette.fg, 0.16)}`,
                                    fontFamily: font,
                                    fontWeight: 600,
                                    fontSize: u * 3.6,
                                    color: palette.fg,
                                    transform: `translateY(${(1 - s) * 40}px)`,
                                    opacity: s,
                                }}
                            >
                                <span style={{ width: u * 1.4, height: u * 1.4, borderRadius: '50%', background: palette.accent, flexShrink: 0 }} />
                                {text}
                            </span>
                        </div>
                    )
                ) : null}
            </>
        );
    }

    // End card: name, offer, call to action and website.
    const endTop = box.landscape ? '30%' : box.vertical ? '52%' : '58%';
    const end =
        frame >= tl.endStart ? (
            <div style={{ position: 'absolute', top: endTop, ...textColumn, opacity: endIn, transform: `translateY(${(1 - endIn) * 30}px)` }}>
                <div style={{ ...nameStyle, fontSize: u * (box.landscape ? 8 : 10) }}>{props.name}</div>
                {props.offer ? (
                    <div style={{ display: 'inline-block', marginTop: u * 2.4, padding: `${u * 1}px ${u * 2.4}px`, borderRadius: u * 1.2, border: `3px solid ${palette.accent}`, color: palette.fg, fontFamily: font, fontWeight: 700, fontSize: u * 3.8 }}>
                        {props.offer}
                    </div>
                ) : null}
                <div style={{ marginTop: u * 3 }}>
                    <span
                        style={{
                            display: 'inline-block',
                            padding: `${u * 1.8}px ${u * 4.2}px`,
                            borderRadius: 999,
                            background: palette.accent,
                            color: palette.accentText,
                            fontFamily: font,
                            fontWeight: 800,
                            fontSize: u * 4.2,
                            transform: `scale(${1 + 0.04 * Math.sin((frame - tl.endStart) / 5) * endIn})`,
                        }}
                    >
                        {props.cta}
                    </span>
                </div>
                {props.website ? <div style={{ marginTop: u * 2.4, fontFamily: font, fontSize: u * 3, color: alpha(palette.fg, 0.75) }}>{props.website}</div> : null}
            </div>
        ) : null;

    return (
        <>
            {intro}
            {point}
            {end}
        </>
    );
}

/** Whooshes on angle changes, a hit on the end card, pops on selling points. */
function SoundCues({ props, tl }) {
    if (!props.sfxOn || !props.sfx) return null;
    const cues = [];
    const add = (name, frame, volume) => props.sfx[name] && frame >= 0 && cues.push({ name, frame: Math.round(frame), volume });
    add(props.preset === 'reveal' ? 'riser' : 'whoosh', props.preset === 'reveal' ? 0 : 2, 0.45);
    tl.segments.slice(1).forEach((s) => {
        if (s.kind === 'end') add('impact', s.from, 0.7);
        else add('whoosh', s.from - 8, 0.4);
        if (s.point >= 0) add('pop', s.from + 8, 0.35);
    });
    return cues.map((c, i) => (
        <Sequence key={i} from={c.frame} layout="none">
            <Audio src={props.sfx[c.name]} volume={c.volume} />
        </Sequence>
    ));
}

export function ProductAd(props) {
    useFonts(props.fontFamily);
    const frame = useCurrentFrame();
    const { fps, width, height } = useVideoConfig();
    const font = `"${familyFor(props.fontFamily)}", Inter, sans-serif`;
    const tl = timeline({ seconds: props.seconds, photos: props.photos.length, points: props.points.length, preset: props.preset, beats: props.beats, fps });
    const endProgress = lerp(frame, tl.endStart - 10, tl.endStart + 14, [0, 1], smooth);
    const box = stage(width, height, endProgress);
    const floor = stage(width, height, 0); // the studio floor stays put when the product moves for the end card
    const layers = layersAt(frame, tl, props.preset, fps);
    const pulse = props.preset === 'showcase' || props.preset === 'turntable' ? beatPulse(frame / fps, props.beats) * 0.025 : 0;
    const total = tl.total;
    const musicLevel = props.narration ? 0.28 : 0.85;
    const current = layers.at(-1).index;

    return (
        <AbsoluteFill style={{ background: props.palette.bg, overflow: 'hidden' }}>
            <Background preset={props.preset} palette={props.palette} frame={frame} fps={fps} width={width} height={height} box={box} floorTop={floor.cy + floor.h / 2} segIndex={current} introEnd={tl.introEnd} />
            {layers.map((layer) => {
                const motion = holdMotion(props.preset, layer.seg, frame, fps, layer.index);
                motion.scale *= 1 + pulse;
                const entry = layer.seg.kind === 'intro' ? entrance(props.preset, frame, fps) : null;
                return (
                    <ProductLayer
                        key={layer.index}
                        photo={props.photos[layer.seg.photo] || props.photos[0]}
                        layer={layer}
                        motion={motion}
                        entry={entry}
                        box={box}
                        width={width}
                        height={height}
                        preset={props.preset}
                        fps={fps}
                        frame={frame}
                    />
                );
            })}
            <Copy props={props} tl={tl} frame={frame} fps={fps} width={width} height={height} box={box} font={font} />
            {props.music ? <Audio src={props.music} volume={(f) => interpolate(f, [0, 6, total - 12, total], [0, musicLevel, musicLevel, 0], clamp)} /> : null}
            {props.narration ? <Audio src={props.narration} volume={1} /> : null}
            <SoundCues props={props} tl={tl} />
            {props.narration ? <AdCaptions captions={props.captions} /> : null}
        </AbsoluteFill>
    );
}
