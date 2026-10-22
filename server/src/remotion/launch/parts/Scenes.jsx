import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { BrandMark, CountUp, DISPLAY_FONT, Glow, Numeral, Rings } from './Decor.jsx';
import { Chips, Eyebrow, fitSize, Kinetic, Subline } from './Kinetic.jsx';
import { alpha, clamp, ease, expoOut, lightness, pop } from './motion.js';
import { fitDevice, Screen } from './Screen.jsx';
import { useBeat } from './time.js';

/**
 * Launch-video scenes: hook, reveal, feature (several layouts, with or without a live screen),
 * proof (a real figure from the site), outro. Each layout is chosen by the composition so
 * consecutive scenes never look alike.
 */

export function useLayout(props) {
    const { width, height } = useVideoConfig();
    const unit = Math.min(width, height);
    return { width, height, unit, vertical: height > width * 1.2, square: Math.abs(width - height) < 10, dark: lightness(props.palette.bg) < 0.5 };
}

const pad2 = (n) => String(n).padStart(2, '0');
const textVariant = (tone) => (tone === 'chaotic' ? 'punch' : tone === 'polished' || tone === 'deadpan' ? 'fade' : 'rise');
const quiet = (palette) => alpha(palette.fg, 0.5);

/** What the screen does in a launch scene: click a real call to action, else spotlight it. */
function launchAction(target) {
    if (!target) return 'look';
    return target.kind === 'button' || target.kind === 'link' ? 'click' : 'look';
}

function calloutFor(target) {
    if (!target || !['button', 'link', 'field'].includes(target.kind)) return '';
    const words = String(target.text || '').split(' ');
    return words.length <= 4 ? words.join(' ') : '';
}

// ---------------------------------------------------------------------------------------------
// Hook: the first two seconds. Big kinetic type; the product's own page glows faintly behind.
// ---------------------------------------------------------------------------------------------

export function HookScene({ scene, props }) {
    const frame = useCurrentFrame();
    const L = useLayout(props);
    const { palette, tone } = props;
    const text = tone === 'chaotic' ? scene.headline.toUpperCase() : scene.headline;
    const maxW = L.width * (L.vertical ? 0.86 : 0.8);
    const size = fitSize(text, maxW, { maxSize: L.unit * (L.vertical ? 0.13 : 0.15), minSize: L.unit * 0.06, maxLines: L.vertical ? 5 : 3 });
    const shake = tone === 'chaotic' ? Math.sin(frame * 2.3) * L.unit * 0.004 * Math.max(0, 1 - frame / 20) : 0;
    const rule = ease(frame, 10, 34, [0, 1], expoOut);
    return (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: L.unit * 0.08, transform: `translate(${shake}px, ${-shake}px)` }}>
            {scene.screenshotData ? (
                <AbsoluteFill style={{ opacity: 0.3 * ease(frame, 0, 20), WebkitMaskImage: 'radial-gradient(ellipse at center, black 20%, transparent 72%)', maskImage: 'radial-gradient(ellipse at center, black 20%, transparent 72%)' }}>
                    {/* The product's own page, out of focus: its colours and light, not a second layer of text. */}
                    <Img src={scene.screenshotData} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: `blur(${L.unit * 0.014}px) saturate(1.3)`, transform: `scale(${1.25 + frame * 0.0012}) rotate(-4deg)` }} />
                </AbsoluteFill>
            ) : null}
            <Glow color={palette.accent} size={L.unit * 1.2} strength={0.8} />
            <Eyebrow text={scene.eyebrow} size={L.unit * 0.026} accent={palette.accent} color={palette.fg} />
            <Kinetic
                text={text}
                size={size}
                color={palette.fg}
                secondColor={quiet(palette)}
                accent={palette.accent}
                accentText={palette.accentText}
                variant={textVariant(tone)}
                stagger={tone === 'chaotic' ? 2 : 3}
                maxWidth={maxW}
            />
            <div style={{ width: L.unit * 0.16 * rule, height: Math.max(3, L.unit * 0.006), marginTop: size * 0.45, borderRadius: 9, background: palette.accent, boxShadow: `0 0 ${L.unit * 0.03}px ${alpha(palette.accent, 0.8)}` }} />
            <Subline text={scene.subline} size={L.unit * 0.036} color={palette.fg} delay={16} maxWidth={L.width * 0.7} />
        </AbsoluteFill>
    );
}

// ---------------------------------------------------------------------------------------------
// Reveal: the product's name and mark. With a capture, the product rises into frame in 3D.
// ---------------------------------------------------------------------------------------------

function TrackingName({ text, size, color, delay = 4 }) {
    const frame = useCurrentFrame();
    const p = ease(frame, delay, delay + 26, [0, 1], expoOut);
    return (
        <div style={{ fontSize: size, fontWeight: 900, lineHeight: 1, color, letterSpacing: `${0.32 - 0.36 * p}em`, opacity: interpolate(p, [0, 0.4], [0, 1], clamp), whiteSpace: 'nowrap', marginRight: `${0.32 - 0.36 * p}em` }}>
            {text}
        </div>
    );
}

export function RevealScene({ scene, props, durationFrames }) {
    const frame = useCurrentFrame();
    const L = useLayout(props);
    const { palette, iconData, productName, host, shotAspect } = props;
    const name = scene.headline || productName;
    const nameSize = Math.min(L.unit * (L.vertical ? 0.14 : 0.13), (L.width * 0.8) / Math.max(4, name.length * 0.6));
    const line = ease(frame, 12, 34, [0, 1], expoOut);

    if (scene.screenshotData) {
        const dev = L.vertical ? fitDevice(L.width * 0.8, L.height * 0.58, shotAspect) : fitDevice(L.width * 0.7, L.height * 0.9, shotAspect);
        const rise = ease(frame, 2, 34, [0, 1], expoOut);
        const headSize = Math.min(nameSize * 0.8, L.unit * 0.1);
        return (
            <AbsoluteFill style={{ alignItems: 'center' }}>
                <Glow color={palette.accent} size={L.unit * 1.3} y="78%" strength={0.9} />
                <div style={{ marginTop: L.height * (L.vertical ? 0.1 : 0.08), display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: headSize * 0.32 }}>
                        <BrandMark iconData={iconData} name={name} size={headSize * 0.92} palette={palette} />
                        <TrackingName text={name} size={headSize} color={palette.fg} />
                    </div>
                    <Subline text={scene.subline} size={L.unit * (L.vertical ? 0.036 : 0.032)} color={palette.fg} delay={14} maxWidth={L.width * (L.vertical ? 0.84 : 0.6)} marginTop={L.unit * 0.025} />
                </div>
                <div style={{ position: 'absolute', top: L.height * (L.vertical ? 0.36 : 0.42), left: (L.width - dev.width) / 2, transform: `translateY(${(1 - rise) * L.height * 0.35}px)` }}>
                    <Screen src={scene.screenshotData} host={host} width={dev.width} aspect={shotAspect} palette={palette} durationFrames={durationFrames} tilt={{ rx: 26 }} />
                </div>
            </AbsoluteFill>
        );
    }

    return (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: L.unit * 0.08 }}>
            <Glow color={palette.accent} size={L.unit * 1.1} y="42%" />
            <Rings color={palette.accent} size={L.unit * 0.9} y="40%" delay={2} />
            <BrandMark iconData={iconData} name={name} size={L.unit * 0.15} palette={palette} delay={2} />
            <div style={{ height: L.unit * 0.05 }} />
            <TrackingName text={name} size={nameSize} color={palette.fg} delay={6} />
            <div style={{ height: Math.max(3, L.unit * 0.006), width: L.unit * 0.24 * line, background: palette.accent, borderRadius: 99, marginTop: L.unit * 0.035, boxShadow: `0 0 ${L.unit * 0.03}px ${palette.accent}` }} />
            <Subline text={scene.subline} size={L.unit * 0.04} color={palette.fg} delay={16} maxWidth={L.width * (L.vertical ? 0.86 : 0.62)} />
        </AbsoluteFill>
    );
}

// ---------------------------------------------------------------------------------------------
// Feature with a live screen: split (screen left or right) or full-bleed with a caption card.
// ---------------------------------------------------------------------------------------------

function FeatureText({ scene, props, n, total, align, maxW, maxSize, dark }) {
    const L = useLayout(props);
    const { palette, tone } = props;
    const size = fitSize(scene.headline, maxW, { maxSize, minSize: L.unit * 0.05, maxLines: 4 });
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'left' ? 'flex-start' : 'center', maxWidth: maxW }}>
            <Eyebrow text={scene.eyebrow || `${pad2(n)} / ${pad2(total)}`} size={L.unit * 0.022} accent={palette.accent} color={palette.fg} align={align} delay={2} />
            <Kinetic text={scene.headline} size={size} color={palette.fg} accent={palette.accent} accentText={palette.accentText} align={align} variant={n % 2 ? textVariant(tone) : 'slide'} delay={4} maxWidth={maxW} />
            <Subline text={scene.subline} size={L.unit * (L.vertical ? 0.036 : 0.031)} color={palette.fg} delay={14} align={align} maxWidth={maxW} />
            <Chips items={scene.points} size={L.unit * 0.03} palette={palette} align={align} delay={20} dark={dark} />
        </div>
    );
}

export function ScreenScene({ scene, props, durationFrames, variant = 'splitRight', n = 1, total = 1 }) {
    const L = useLayout(props);
    const { palette, host, shotAspect } = props;
    const frame = useCurrentFrame();
    const action = launchAction(scene.target);
    const shared = {
        src: scene.screenshotData,
        host,
        aspect: shotAspect,
        palette,
        target: scene.target,
        action,
        durationFrames,
        callout: calloutFor(scene.target),
        calloutSize: L.unit * 0.024,
        zoom: action === 'click' ? 2.3 : 1.9,
    };

    if (L.vertical || L.square) {
        const dev = fitDevice(L.width * (L.vertical ? 0.84 : 0.8), L.height * (L.vertical ? 0.56 : 0.56), shotAspect);
        const left = variant !== 'full' && n % 2 === 1;
        const rise = ease(frame, 0, 24, [0, 1], expoOut);
        return (
            <AbsoluteFill style={{ alignItems: left ? 'flex-start' : 'center', padding: `${L.height * (L.vertical ? 0.08 : 0.06)}px ${L.width * 0.08}px` }}>
                <FeatureText scene={scene} props={props} n={n} total={total} align={left ? 'left' : 'center'} maxW={L.width * 0.84} maxSize={L.unit * (L.vertical ? 0.1 : 0.075)} dark={L.dark} />
                <div style={{ position: 'absolute', bottom: L.height * (L.vertical ? 0.06 : 0.04), left: (L.width - dev.width) / 2, transform: `translateY(${(1 - rise) * L.height * 0.2}px)` }}>
                    <Screen {...shared} width={dev.width} tilt={{ rx: 10, ry: left ? -10 : 10 }} />
                </div>
            </AbsoluteFill>
        );
    }

    if (variant === 'full') {
        const dev = fitDevice(L.width * 0.8, L.height * 0.8, shotAspect);
        const card = pop(frame, 30, 8, { damping: 16, stiffness: 130, mass: 0.8 });
        const rise = ease(frame, 0, 24, [0, 1], expoOut);
        const cardW = L.width * 0.4;
        return (
            <AbsoluteFill>
                <div style={{ position: 'absolute', top: L.height * 0.06, left: L.width * 0.16, transform: `translateY(${(1 - rise) * L.height * 0.25}px) scale(${0.92 + 0.08 * rise})` }}>
                    <Screen {...shared} width={dev.width} tilt={{ rx: 12 }} />
                </div>
                <div
                    style={{
                        position: 'absolute',
                        left: L.width * 0.05,
                        bottom: L.height * 0.07,
                        width: cardW,
                        padding: `${L.unit * 0.04}px ${L.unit * 0.045}px`,
                        borderRadius: L.unit * 0.03,
                        background: alpha(palette.bg, 0.88),
                        border: `1px solid ${L.dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)'}`,
                        boxShadow: `0 ${L.unit * 0.03}px ${L.unit * 0.09}px rgba(0,0,0,${L.dark ? 0.55 : 0.18})`,
                        transform: `translateX(${(1 - card) * -L.width * 0.2}px)`,
                        opacity: Math.min(1, card * 1.5),
                        zIndex: 5,
                    }}
                >
                    <FeatureText scene={scene} props={props} n={n} total={total} align="left" maxW={cardW - L.unit * 0.09} maxSize={L.unit * 0.068} dark={L.dark} />
                </div>
            </AbsoluteFill>
        );
    }

    const right = variant !== 'splitLeft';
    const dev = fitDevice(L.width * 0.54, L.height * 0.78, shotAspect);
    const slide = ease(frame, 0, 26, [0, 1], expoOut);
    const drift = interpolate(frame, [0, durationFrames], [0, 1], clamp);
    const textW = L.width * 0.33;
    return (
        <AbsoluteFill style={{ flexDirection: right ? 'row' : 'row-reverse', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${L.width * 0.055}px` }}>
            <div style={{ transform: `translateX(${(right ? -1 : 1) * drift * L.unit * 0.015}px)` }}>
                <FeatureText scene={scene} props={props} n={n} total={total} align="left" maxW={textW} maxSize={L.unit * 0.085} dark={L.dark} />
            </div>
            <div style={{ transform: `translateX(${(right ? 1 : -1) * ((1 - slide) * L.width * 0.3 - drift * L.unit * 0.02)}px)` }}>
                <Screen {...shared} width={dev.width} tilt={{ rx: 6, ry: right ? -18 : 18 }} />
            </div>
        </AbsoluteFill>
    );
}

// ---------------------------------------------------------------------------------------------
// Feature without a screen: a statement with a big numeral, or the points as 3D cards.
// ---------------------------------------------------------------------------------------------

export function CardScene({ scene, props, variant = 'statement', n = 1, total = 1 }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const L = useLayout(props);
    const beat = useBeat();
    const { palette, tone } = props;
    const points = scene.points || [];

    if (variant === 'cards' && points.length >= 2) {
        const size = fitSize(scene.headline, L.width * 0.84, { maxSize: L.unit * 0.1, minSize: L.unit * 0.055, maxLines: 2 });
        const cardW = L.vertical ? L.width * 0.78 : Math.min(L.width * 0.3, (L.width * 0.86) / points.length - L.unit * 0.03);
        const mid = (points.length - 1) / 2;
        return (
            <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: L.unit * 0.07 }}>
                <Glow color={palette.accent} size={L.unit * 1.1} y="62%" strength={0.7} />
                <Eyebrow text={scene.eyebrow || `${pad2(n)} / ${pad2(total)}`} size={L.unit * 0.022} accent={palette.accent} color={palette.fg} delay={0} />
                <Kinetic text={scene.headline} size={size} color={palette.fg} accent={palette.accent} accentText={palette.accentText} variant={textVariant(tone)} maxWidth={L.width * 0.86} />
                <div style={{ display: 'flex', flexDirection: L.vertical ? 'column' : 'row', gap: L.unit * 0.03, marginTop: L.unit * 0.07, perspective: L.unit * 2 }}>
                    {points.map((pt, i) => {
                        const p = pop(frame, fps, 14 + i * 6, { damping: 14, stiffness: 120, mass: 0.9 });
                        return (
                            <div
                                key={i}
                                style={{
                                    width: cardW,
                                    padding: `${L.unit * 0.045}px ${L.unit * 0.045}px`,
                                    borderRadius: L.unit * 0.028,
                                    background: L.dark ? 'linear-gradient(160deg, rgba(255,255,255,0.1), rgba(255,255,255,0.03))' : 'linear-gradient(160deg, #ffffff, rgba(255,255,255,0.7))',
                                    border: `1px solid ${L.dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.08)'}`,
                                    boxShadow: `0 ${L.unit * 0.03}px ${L.unit * 0.07}px rgba(0,0,0,${L.dark ? 0.45 : 0.12})`,
                                    // Fanned like a hand of cards, each flipping up into place.
                                    transform: `rotateX(${(1 - p) * -70}deg) rotateZ(${L.vertical ? 0 : (i - mid) * 3 * p}deg) translateY(${(1 - p) * L.unit * 0.1 + (L.vertical ? 0 : Math.abs(i - mid) * L.unit * 0.02)}px) scale(${1 + (frame > 30 + i * 6 ? beat * 0.02 : 0)})`,
                                    transformOrigin: 'bottom center',
                                    opacity: Math.min(1, p * 1.6),
                                    display: 'flex',
                                    flexDirection: L.vertical ? 'row' : 'column',
                                    alignItems: L.vertical ? 'center' : 'flex-start',
                                    gap: L.unit * 0.02,
                                }}
                            >
                                <div style={{ fontFamily: DISPLAY_FONT, fontSize: L.unit * 0.08, lineHeight: 1, color: palette.accent }}>{pad2(i + 1)}</div>
                                <div style={{ fontSize: L.unit * 0.05, fontWeight: 800, lineHeight: 1.1, color: palette.fg, letterSpacing: '-0.025em' }}>{pt}</div>
                            </div>
                        );
                    })}
                </div>
            </AbsoluteFill>
        );
    }

    // Statement: a big headline beside a huge outlined numeral; mirrored on alternate beats.
    const flip = variant === 'statementRight' && !L.vertical;
    const align = flip ? 'right' : 'left';
    const maxW = L.width * (L.vertical ? 0.84 : 0.66);
    const size = fitSize(scene.headline, maxW, { maxSize: L.unit * (L.vertical ? 0.12 : 0.11), minSize: L.unit * 0.06, maxLines: L.vertical ? 5 : 3 });
    const bar = ease(frame, 4, 24, [0, 1], expoOut);
    return (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: flip ? 'flex-end' : 'flex-start', padding: `0 ${L.width * (L.vertical ? 0.08 : 0.09)}px` }}>
            <Numeral value={pad2(n)} size={L.unit * (L.vertical ? 0.7 : 0.95)} color={palette.fg} x={L.vertical ? '40%' : flip ? '3%' : '56%'} y={L.vertical ? '8%' : '4%'} />
            <Glow color={palette.accent} size={L.unit} x={flip ? '70%' : '30%'} y="50%" strength={0.7} />
            <div style={{ position: 'absolute', [flip ? 'right' : 'left']: 0, top: '22%', bottom: '22%', width: Math.max(4, L.unit * 0.008), background: palette.accent, transform: `scaleY(${bar})`, transformOrigin: 'top', boxShadow: `0 0 ${L.unit * 0.03}px ${palette.accent}` }} />
            <Eyebrow text={scene.eyebrow || `${pad2(n)} / ${pad2(total)}`} size={L.unit * 0.024} accent={palette.accent} color={palette.fg} align={align} />
            <Kinetic text={scene.headline} size={size} color={palette.fg} accent={palette.accent} accentText={palette.accentText} align={align} variant={n % 2 ? 'slide' : textVariant(tone)} maxWidth={maxW} />
            <Subline text={scene.subline} size={L.unit * 0.036} color={palette.fg} delay={14} align={align} maxWidth={maxW * 0.9} />
            <Chips items={points} size={L.unit * 0.038} palette={palette} align={align} delay={18} dark={L.dark} />
        </AbsoluteFill>
    );
}

// ---------------------------------------------------------------------------------------------
// Proof: one real figure from the site, counted up.
// ---------------------------------------------------------------------------------------------

export function ProofScene({ scene, props }) {
    const L = useLayout(props);
    const { palette, tone } = props;
    const stat = scene.stat || { value: '', label: scene.headline };
    const valueSize = Math.min(L.unit * 0.34, (L.width * 0.86) / Math.max(2, String(stat.value).length * 0.5));
    const label = stat.label || scene.headline;
    return (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: L.unit * 0.08 }}>
            <Rings color={palette.accent} size={L.unit * 1.1} count={4} delay={0} />
            <Glow color={palette.accent} size={L.unit * 1.2} strength={0.9} />
            <Eyebrow text={scene.eyebrow} size={L.unit * 0.024} accent={palette.accent} color={palette.fg} />
            <CountUp value={stat.value} size={valueSize} color={palette.fg} />
            <div style={{ height: L.unit * 0.03 }} />
            <Kinetic text={label} size={fitSize(label, L.width * 0.8, { maxSize: L.unit * 0.075, minSize: L.unit * 0.045, maxLines: 2 })} color={palette.fg} accent={palette.accent} accentText={palette.accentText} variant={textVariant(tone)} delay={14} maxWidth={L.width * 0.8} />
            <Subline text={scene.subline} size={L.unit * 0.032} color={palette.fg} delay={24} maxWidth={L.width * 0.66} />
        </AbsoluteFill>
    );
}

// ---------------------------------------------------------------------------------------------
// Outro: the brand colour floods the frame; mark, name, a real call to action, the address.
// ---------------------------------------------------------------------------------------------

export function OutroScene({ scene, props, durationFrames }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const L = useLayout(props);
    const beat = useBeat();
    const { palette, iconData, host, productName } = props;
    const flood = ease(frame, 0, 20, [0, 1], expoOut);
    const ink = palette.accentText;
    const clickAt = Math.round(durationFrames * 0.6);
    const btn = pop(frame, fps, 16);
    const press = interpolate(frame, [clickAt, clickAt + 3, clickAt + 9], [1, 0.9, 1], clamp);
    const cur = ease(frame, clickAt - 18, clickAt, [0, 1], expoOut);
    const ring = interpolate(frame, [clickAt, clickAt + 20], [0, 1], clamp);
    const name = scene.headline || productName;
    const nameSize = fitSize(name, L.width * 0.8, { maxSize: L.unit * 0.13, minSize: L.unit * 0.06, maxLines: 2 });
    const address = host || '';
    return (
        <AbsoluteFill>
            <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 40%, ${palette.accent}, ${palette.accent2 || palette.accent})`, clipPath: `circle(${flood * 75}% at 50% 50%)` }} />
            <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 120%, ${alpha('#000000', 0.18)}, transparent 60%)`, opacity: flood }} />
            <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: L.unit * 0.08 }}>
                <BrandMark iconData={iconData} name={name} size={L.unit * 0.13} palette={{ ...palette, accent: ink, accent2: ink, accentText: palette.accent }} delay={6} />
                <div style={{ height: L.unit * 0.04 }} />
                <Kinetic text={name} size={nameSize} color={ink} accent={ink} accentText={palette.accent} mark="none" variant="rise" delay={8} maxWidth={L.width * 0.84} />
                <Subline text={scene.subline && scene.subline !== address ? scene.subline : ''} size={L.unit * 0.034} color={ink} delay={16} maxWidth={L.width * 0.66} />
                {scene.cta ? (
                    <div style={{ position: 'relative', marginTop: L.unit * 0.055 }}>
                        <div
                            style={{
                                padding: `${L.unit * 0.026}px ${L.unit * 0.06}px`,
                                borderRadius: 999,
                                background: ink,
                                color: palette.accent,
                                fontSize: L.unit * 0.042,
                                fontWeight: 800,
                                letterSpacing: '-0.01em',
                                transform: `scale(${btn * press * (1 + (frame > clickAt + 10 ? beat * 0.03 : 0))})`,
                                boxShadow: `0 ${L.unit * 0.02}px ${L.unit * 0.06}px rgba(0,0,0,0.3)`,
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {scene.cta} →
                        </div>
                        {ring > 0 && ring < 1 ? <div style={{ position: 'absolute', inset: -L.unit * 0.02, borderRadius: 999, border: `${L.unit * 0.005}px solid ${ink}`, opacity: 1 - ring, transform: `scale(${1 + ring * 0.35})` }} /> : null}
                        <svg
                            viewBox="0 0 24 24"
                            width={L.unit * 0.05}
                            height={L.unit * 0.05}
                            style={{
                                position: 'absolute',
                                left: `${interpolate(cur, [0, 1], [140, 64])}%`,
                                top: `${interpolate(cur, [0, 1], [180, 56])}%`,
                                opacity: cur,
                                transform: `scale(${frame >= clickAt && frame < clickAt + 4 ? 0.82 : 1})`,
                                filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.4))',
                            }}
                        >
                            <path d="M4 2l15 9.5-6.6 1.4L9.4 20z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
                        </svg>
                    </div>
                ) : null}
                {address ? (
                    <div
                        style={{
                            marginTop: L.unit * 0.045,
                            padding: `${L.unit * 0.012}px ${L.unit * 0.032}px`,
                            borderRadius: 999,
                            border: `${Math.max(1.5, L.unit * 0.002)}px solid ${alpha(ink, 0.35)}`,
                            color: ink,
                            opacity: 0.9 * ease(frame, 22, 34),
                            fontSize: L.unit * 0.03,
                            fontWeight: 700,
                            letterSpacing: '0.02em',
                        }}
                    >
                        {address}
                    </div>
                ) : null}
            </AbsoluteFill>
        </AbsoluteFill>
    );
}
