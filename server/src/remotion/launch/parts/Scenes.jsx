import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { Eyebrow, Kinetic, Subline } from './Kinetic.jsx';
import { clamp, ease, lightness, pop } from './motion.js';
import { Screen } from './Screen.jsx';

/**
 * Scene layouts. Launch videos: hook, reveal, feature/showcase (with or without a live
 * screen), outro. Tutorials: intro, step, outro.
 */

function useLayout() {
    const { width, height } = useVideoConfig();
    return { width, height, unit: Math.min(width, height), vertical: height > width, square: width === height };
}

/** What the screen should do in a launch scene: click a real call to action, else spotlight the headline. */
function launchAction(target) {
    if (!target) return 'look';
    return target.kind === 'button' || target.kind === 'link' ? 'click' : 'look';
}

function Glow({ color, size, x = '50%', y = '50%', strength = 1 }) {
    const frame = useCurrentFrame();
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
                background: `radial-gradient(circle, ${color}66, transparent 65%)`,
                transform: `scale(${0.6 + p * 0.4 + Math.sin(frame / 12) * 0.03})`,
                opacity: p * strength,
                filter: 'blur(10px)',
            }}
        />
    );
}

export function HookScene({ scene, props }) {
    const { width, unit, vertical } = useLayout();
    const { palette, tone } = props;
    const words = scene.headline.split(' ').length;
    const size = unit * (tone === 'cinematic' ? 0.16 : words > 6 ? 0.11 : words > 4 ? 0.13 : 0.155);
    const frame = useCurrentFrame();
    const shake = tone === 'chaotic' ? Math.sin(frame * 2.3) * unit * 0.004 * Math.max(0, 1 - frame / 20) : 0;
    return (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: unit * 0.08, transform: `translate(${shake}px, ${-shake}px)` }}>
            <Glow color={palette.accent} size={unit * 1.1} strength={0.9} />
            <Eyebrow text={scene.eyebrow} size={unit * 0.024} accent={palette.accent} />
            <Kinetic
                text={tone === 'chaotic' ? scene.headline.toUpperCase() : scene.headline}
                size={size}
                color={palette.fg}
                accent={palette.accent}
                accentText={palette.accentText}
                stagger={tone === 'chaotic' ? 1 : 3}
                calm={tone === 'polished' || tone === 'deadpan'}
                maxWidth={width * (vertical ? 0.9 : 0.82)}
            />
            <Subline text={scene.subline} size={unit * 0.034} color={palette.fg} delay={14} maxWidth={width * 0.7} />
        </AbsoluteFill>
    );
}

export function RevealScene({ scene, props }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const { width, unit, vertical } = useLayout();
    const { palette, iconData, productName } = props;
    const iconP = pop(frame, fps, 2, { damping: 10, stiffness: 140, mass: 0.8 });
    const line = ease(frame, 14, 30);
    return (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: unit * 0.08 }}>
            <Glow color={palette.accent} size={unit * 0.9} y="42%" />
            {iconData ? (
                <Img
                    src={iconData}
                    style={{
                        width: unit * 0.13,
                        height: unit * 0.13,
                        borderRadius: unit * 0.03,
                        marginBottom: unit * 0.04,
                        transform: `scale(${iconP}) rotate(${(1 - iconP) * -12}deg)`,
                        boxShadow: `0 ${unit * 0.02}px ${unit * 0.06}px rgba(0,0,0,0.35)`,
                    }}
                />
            ) : null}
            <Eyebrow text={scene.eyebrow || 'Meet'} size={unit * 0.022} accent={palette.accent} delay={4} />
            <Kinetic text={scene.headline || productName} size={unit * 0.12} color={palette.fg} accent={palette.accent} accentText={palette.accentText} delay={6} highlight={false} maxWidth={width * 0.86} />
            <div style={{ height: unit * 0.008, width: unit * 0.22 * line, background: palette.accent, borderRadius: 99, marginTop: unit * 0.03, boxShadow: `0 0 ${unit * 0.03}px ${palette.accent}` }} />
            <Subline text={scene.subline} size={unit * 0.036} color={palette.fg} delay={16} maxWidth={width * (vertical ? 0.86 : 0.6)} />
        </AbsoluteFill>
    );
}

export function ScreenScene({ scene, props, durationFrames }) {
    const { width, height, unit, vertical } = useLayout();
    const { palette, host, shotAspect } = props;
    const frame = useCurrentFrame();
    const action = launchAction(scene.target);
    const screenW = vertical ? width * 0.78 : props.square ? width * 0.62 : width * (scene.type === 'showcase' ? 0.6 : 0.54);
    const maxH = vertical ? height * 0.6 : height * 0.78;
    const fitW = Math.min(screenW, (maxH - Math.max(22, screenW * 0.034)) * shotAspect);
    const rise = ease(frame, 0, 18);
    const left = !vertical && !props.square;
    return (
        <AbsoluteFill
            style={{
                flexDirection: left ? 'row' : 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: unit * 0.06,
                padding: unit * 0.07,
            }}
        >
            <div style={{ flex: left ? '1 1 0' : '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: left ? 'flex-start' : 'center', minWidth: 0 }}>
                <Eyebrow text={scene.eyebrow} size={unit * 0.022} accent={palette.accent} />
                <Kinetic
                    text={scene.headline}
                    size={unit * (vertical ? 0.075 : scene.headline.split(' ').length > 5 ? 0.06 : 0.072)}
                    color={palette.fg}
                    accent={palette.accent}
                    accentText={palette.accentText}
                    align={left ? 'left' : 'center'}
                />
                <Subline text={scene.subline} size={unit * 0.032} color={palette.fg} delay={12} align={left ? 'left' : 'center'} maxWidth={left ? width * 0.36 : width * 0.86} />
            </div>
            <div style={{ transform: `translateY(${(1 - rise) * unit * 0.08}px) scale(${0.94 + rise * 0.06})`, opacity: rise }}>
                <Screen
                    src={scene.screenshotData}
                    host={host}
                    width={fitW}
                    aspect={shotAspect}
                    palette={palette}
                    target={scene.target}
                    action={action}
                    durationFrames={durationFrames}
                    tilt
                    zoom={action === 'click' ? 1.55 : 1.3}
                />
            </div>
        </AbsoluteFill>
    );
}

export function CardScene({ scene, index, props }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const { width, unit, vertical } = useLayout();
    const { palette } = props;
    const dark = lightness(palette.bg) < 0.5;
    const p = pop(frame, fps, 0, { damping: 16, stiffness: 120, mass: 0.8 });
    return (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: unit * 0.08 }}>
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: `${unit * 0.07}px ${unit * 0.08}px`,
                    borderRadius: unit * 0.04,
                    background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.65)',
                    border: `1px solid ${dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)'}`,
                    boxShadow: `0 ${unit * 0.03}px ${unit * 0.08}px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.15)`,
                    maxWidth: width * (vertical ? 0.9 : 0.74),
                    transform: `scale(${0.9 + p * 0.1}) rotate(${(1 - p) * 2}deg)`,
                    opacity: Math.min(1, p * 1.5),
                }}
            >
                <div
                    style={{
                        width: unit * 0.09,
                        height: unit * 0.09,
                        borderRadius: unit * 0.025,
                        display: 'grid',
                        placeItems: 'center',
                        marginBottom: unit * 0.035,
                        background: palette.accent,
                        color: palette.accentText,
                        fontSize: unit * 0.04,
                        fontWeight: 800,
                        boxShadow: `0 0 ${unit * 0.05}px ${palette.accent}88`,
                    }}
                >
                    {String(index).padStart(2, '0')}
                </div>
                <Eyebrow text={scene.eyebrow} size={unit * 0.02} accent={palette.accent} delay={4} />
                <Kinetic text={scene.headline} size={unit * 0.085} color={palette.fg} accent={palette.accent} accentText={palette.accentText} delay={6} />
                <Subline text={scene.subline} size={unit * 0.032} color={palette.fg} delay={14} maxWidth={width * 0.6} />
            </div>
        </AbsoluteFill>
    );
}

export function OutroScene({ scene, props, durationFrames }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const { width, unit } = useLayout();
    const { palette, iconData, host } = props;
    const clickAt = Math.round(durationFrames * 0.55);
    const btn = pop(frame, fps, 14);
    const press = interpolate(frame, [clickAt, clickAt + 3, clickAt + 9], [1, 0.92, 1], clamp);
    const cur = ease(frame, clickAt - 16, clickAt);
    const iconP = pop(frame, fps, 0, { damping: 10, stiffness: 150, mass: 0.7 });
    const ring = interpolate(frame, [clickAt, clickAt + 18], [0, 1], clamp);
    return (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: unit * 0.08 }}>
            <Glow color={palette.accent} size={unit * 1.2} strength={1} />
            {iconData ? (
                <Img src={iconData} style={{ width: unit * 0.11, height: unit * 0.11, borderRadius: unit * 0.026, marginBottom: unit * 0.035, transform: `scale(${iconP})` }} />
            ) : null}
            <Kinetic text={scene.headline} size={unit * 0.11} color={palette.fg} accent={palette.accent} accentText={palette.accentText} maxWidth={width * 0.84} />
            {scene.cta ? (
                <div style={{ position: 'relative', marginTop: unit * 0.06 }}>
                    <div
                        style={{
                            padding: `${unit * 0.026}px ${unit * 0.065}px`,
                            borderRadius: 999,
                            background: palette.accent,
                            color: palette.accentText,
                            fontSize: unit * 0.04,
                            fontWeight: 800,
                            transform: `scale(${btn * press})`,
                            boxShadow: `0 ${unit * 0.015}px ${unit * 0.05}px ${palette.accent}99`,
                        }}
                    >
                        {scene.cta} →
                    </div>
                    {ring > 0 && ring < 1 ? (
                        <div style={{ position: 'absolute', inset: -unit * 0.02, borderRadius: 999, border: `${unit * 0.005}px solid ${palette.accent}`, opacity: 1 - ring, transform: `scale(${1 + ring * 0.35})` }} />
                    ) : null}
                    <svg
                        viewBox="0 0 24 24"
                        width={unit * 0.05}
                        height={unit * 0.05}
                        style={{
                            position: 'absolute',
                            left: `${interpolate(cur, [0, 1], [130, 62])}%`,
                            top: `${interpolate(cur, [0, 1], [160, 55])}%`,
                            opacity: cur,
                            transform: `scale(${frame >= clickAt && frame < clickAt + 4 ? 0.82 : 1})`,
                            filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.4))',
                        }}
                    >
                        <path d="M4 2l15 9.5-6.6 1.4L9.4 20z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
                    </svg>
                </div>
            ) : null}
            {host || scene.subline ? (
                <div
                    style={{
                        marginTop: unit * 0.05,
                        padding: `${unit * 0.012}px ${unit * 0.03}px`,
                        borderRadius: 999,
                        border: `1px solid ${palette.fg}33`,
                        color: palette.fg,
                        opacity: 0.8 * ease(frame, 20, 32),
                        fontSize: unit * 0.028,
                        fontWeight: 600,
                        letterSpacing: '0.02em',
                    }}
                >
                    {host || scene.subline}
                </div>
            ) : null}
        </AbsoluteFill>
    );
}

// ---------------------
// Tutorials
// ---------------------

export function TutorialIntro({ scene, props }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const { width, unit } = useLayout();
    const { palette, totalSteps, iconData } = props;
    return (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: unit * 0.08 }}>
            <Glow color={palette.accent} size={unit * 1.1} />
            {iconData ? <Img src={iconData} style={{ width: unit * 0.1, height: unit * 0.1, borderRadius: unit * 0.024, marginBottom: unit * 0.03, transform: `scale(${pop(frame, fps, 0)})` }} /> : null}
            <Eyebrow text={scene.eyebrow || 'Tutorial'} size={unit * 0.024} accent={palette.accent} />
            <Kinetic text={scene.headline} size={unit * 0.1} color={palette.fg} accent={palette.accent} accentText={palette.accentText} maxWidth={width * 0.86} />
            <Subline text={scene.subline} size={unit * 0.034} color={palette.fg} delay={14} maxWidth={width * 0.66} />
            <div style={{ display: 'flex', gap: unit * 0.014, marginTop: unit * 0.05 }}>
                {Array.from({ length: totalSteps }, (_, i) => {
                    const p = pop(frame, fps, 18 + i * 3);
                    return (
                        <div
                            key={i}
                            style={{
                                width: unit * 0.052,
                                height: unit * 0.052,
                                borderRadius: '50%',
                                display: 'grid',
                                placeItems: 'center',
                                fontSize: unit * 0.022,
                                fontWeight: 800,
                                color: palette.accentText,
                                background: palette.accent,
                                transform: `scale(${p})`,
                            }}
                        >
                            {i + 1}
                        </div>
                    );
                })}
            </div>
        </AbsoluteFill>
    );
}

export function TutorialStep({ scene, props, durationFrames }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const { width, height, unit, vertical } = useLayout();
    const { palette, host, shotAspect, totalSteps } = props;
    const dark = lightness(palette.bg) < 0.5;
    const bar = (w) => Math.max(22, w * 0.034);
    const wanted = vertical ? width * 0.8 : width * 0.66;
    const maxH = vertical ? height * 0.66 : height * 0.7;
    const screenW = Math.min(wanted, (maxH - bar(wanted)) * shotAspect);
    const card = pop(frame, fps, 6, { damping: 18, stiffness: 140, mass: 0.8 });
    const rise = ease(frame, 0, 14);
    return (
        <AbsoluteFill style={{ alignItems: 'center', paddingTop: unit * (vertical ? 0.07 : 0.045) }}>
            {/* Step header: "Step 2 of 5" and progress dots */}
            <div style={{ display: 'flex', alignItems: 'center', gap: unit * 0.018, marginBottom: unit * 0.025, opacity: ease(frame, 0, 10) }}>
                <div style={{ padding: `${unit * 0.008}px ${unit * 0.022}px`, borderRadius: 999, background: palette.accent, color: palette.accentText, fontWeight: 800, fontSize: unit * 0.022, letterSpacing: '0.06em' }}>
                    STEP {scene.step} / {totalSteps}
                </div>
                <div style={{ display: 'flex', gap: unit * 0.008 }}>
                    {Array.from({ length: totalSteps }, (_, i) => (
                        <span
                            key={i}
                            style={{
                                width: i + 1 === scene.step ? unit * 0.04 : unit * 0.012,
                                height: unit * 0.012,
                                borderRadius: 99,
                                background: i + 1 <= scene.step ? palette.accent : `${palette.fg}33`,
                            }}
                        />
                    ))}
                </div>
            </div>
            <div style={{ transform: `translateY(${(1 - rise) * unit * 0.04}px)`, opacity: rise }}>
                <Screen
                    src={scene.screenshotData}
                    nextSrc={scene.nextShotData}
                    host={host}
                    width={screenW}
                    aspect={shotAspect}
                    palette={palette}
                    target={scene.target}
                    action={scene.action}
                    typed={scene.typed}
                    durationFrames={durationFrames}
                    zoom={scene.action === 'type' ? 1.9 : scene.action === 'click' ? 1.7 : 1.35}
                />
            </div>
            {/* Caption card overlapping the bottom of the screen */}
            <div
                style={{
                    position: 'absolute',
                    left: '50%',
                    bottom: unit * (vertical ? 0.07 : 0.04),
                    width: vertical ? width * 0.88 : Math.min(width * 0.62, screenW * 0.92),
                    transform: `translateX(-50%) translateY(${(1 - card) * unit * 0.06}px)`,
                    opacity: Math.min(1, card * 1.4),
                    padding: `${unit * 0.026}px ${unit * 0.035}px`,
                    borderRadius: unit * 0.03,
                    background: dark ? 'rgba(14,12,22,0.82)' : 'rgba(255,255,255,0.9)',
                    border: `1px solid ${dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)'}`,
                    boxShadow: `0 ${unit * 0.02}px ${unit * 0.06}px rgba(0,0,0,0.35)`,
                    display: 'flex',
                    gap: unit * 0.025,
                    alignItems: 'center',
                }}
            >
                <div
                    style={{
                        flex: 'none',
                        width: unit * 0.065,
                        height: unit * 0.065,
                        borderRadius: unit * 0.018,
                        display: 'grid',
                        placeItems: 'center',
                        background: palette.accent,
                        color: palette.accentText,
                        fontSize: unit * 0.032,
                        fontWeight: 900,
                    }}
                >
                    {scene.step}
                </div>
                <div style={{ minWidth: 0 }}>
                    <Kinetic text={scene.headline} size={unit * 0.04} color={dark ? '#ffffff' : '#111114'} accent={palette.accent} accentText={palette.accentText} align="left" calm highlight={false} weight={800} delay={8} />
                    {scene.subline ? (
                        <div style={{ marginTop: unit * 0.008, fontSize: unit * 0.024, lineHeight: 1.35, color: dark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)', opacity: ease(frame, 14, 24) }}>{scene.subline}</div>
                    ) : null}
                </div>
            </div>
        </AbsoluteFill>
    );
}
