import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { BrandMark, DISPLAY_FONT, Glow } from './Decor.jsx';
import { Eyebrow, fitSize, Kinetic, Subline } from './Kinetic.jsx';
import { alpha, clamp, ease, expoOut, pop } from './motion.js';
import { useLayout } from './Scenes.jsx';
import { fitDevice, Screen } from './Screen.jsx';

/**
 * Tutorial scenes: a title card that previews the steps, one scene per step (numbered caption
 * with progress, the real screen with cursor, zoom, callout and page changes), and a recap.
 */

const pad2 = (n) => String(n).padStart(2, '0');
const stepsOf = (props) => props.scenes.filter((s) => s.type === 'step');

function StepList({ steps, size, palette, dark, delay = 14, done = -1, checkFrom = null, width }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: size * 0.55, width }}>
            {steps.map((s, i) => {
                const p = pop(frame, fps, delay + i * 4, { damping: 16, stiffness: 140, mass: 0.7 });
                const checked = checkFrom != null && frame >= checkFrom + i * 6;
                const c = checkFrom != null ? ease(frame, checkFrom + i * 6, checkFrom + i * 6 + 8) : 0;
                return (
                    <div
                        key={i}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: size * 0.7,
                            padding: `${size * 0.55}px ${size * 0.8}px`,
                            borderRadius: size * 0.7,
                            background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.8)',
                            border: `1px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.07)'}`,
                            boxShadow: `0 ${size * 0.3}px ${size}px rgba(0,0,0,${dark ? 0.3 : 0.08})`,
                            opacity: Math.min(1, p * 1.4) * (done >= 0 && i > done ? 0.5 : 1),
                            transform: `translateX(${(1 - p) * size * 4}px)`,
                        }}
                    >
                        <div
                            style={{
                                flex: 'none',
                                width: size * 1.7,
                                height: size * 1.7,
                                borderRadius: '50%',
                                display: 'grid',
                                placeItems: 'center',
                                background: checked ? palette.accent : 'transparent',
                                border: `${Math.max(1.5, size * 0.08)}px solid ${palette.accent}`,
                                color: checked ? palette.accentText : palette.fg,
                                fontSize: size * 0.8,
                                fontWeight: 800,
                                transform: `scale(${1 + c * 0.15 - (c >= 1 ? 0.15 : 0)})`,
                            }}
                        >
                            {checked ? (
                                <svg viewBox="0 0 24 24" width={size} height={size}>
                                    <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke={palette.accentText} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="24" strokeDashoffset={24 * (1 - c)} />
                                </svg>
                            ) : (
                                i + 1
                            )}
                        </div>
                        <div style={{ fontSize: size, fontWeight: 700, color: palette.fg, lineHeight: 1.2, letterSpacing: '-0.01em' }}>{s.headline}</div>
                    </div>
                );
            })}
        </div>
    );
}

export function TutorialIntro({ scene, props }) {
    const L = useLayout(props);
    const { palette, iconData, productName } = props;
    const steps = stepsOf(props);
    const colW = L.vertical ? L.width * 0.84 : L.width * 0.44;
    const size = fitSize(scene.headline, colW, { maxSize: L.unit * 0.11, minSize: L.unit * 0.06, maxLines: 3 });
    const listSize = L.unit * (L.vertical ? 0.03 : 0.026);
    return (
        <AbsoluteFill style={{ flexDirection: L.vertical ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: L.unit * 0.08, padding: L.unit * 0.08 }}>
            <Glow color={palette.accent} size={L.unit * 1.2} x="30%" y="45%" />
            <div style={{ width: colW, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <BrandMark iconData={iconData} name={productName} size={L.unit * 0.1} palette={palette} />
                <div style={{ height: L.unit * 0.04 }} />
                <Eyebrow text={scene.eyebrow ? `${scene.eyebrow} · ${steps.length} steps` : `${steps.length} steps`} size={L.unit * 0.024} accent={palette.accent} color={palette.fg} align="left" delay={4} />
                <Kinetic text={scene.headline} size={size} color={palette.fg} accent={palette.accent} accentText={palette.accentText} align="left" variant="rise" delay={6} maxWidth={colW} />
                <Subline text={scene.subline} size={L.unit * 0.032} color={palette.fg} delay={16} align="left" maxWidth={colW} />
            </div>
            <StepList steps={steps} size={listSize} palette={palette} dark={L.dark} delay={18} width={L.vertical ? L.width * 0.84 : L.width * 0.36} />
        </AbsoluteFill>
    );
}

function Progress({ step, total, palette, width, height, delay = 0 }) {
    const frame = useCurrentFrame();
    const fill = ease(frame, delay + 4, delay + 22, [0, 1], expoOut);
    return (
        <div style={{ display: 'flex', gap: height * 0.8, width }}>
            {Array.from({ length: total }, (_, i) => (
                <div key={i} style={{ flex: 1, height, borderRadius: 99, background: alpha(palette.fg, 0.16), overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${i + 1 < step ? 100 : i + 1 === step ? fill * 100 : 0}%`, background: palette.accent, borderRadius: 99 }} />
                </div>
            ))}
        </div>
    );
}

function calloutText(scene) {
    if (scene.action === 'type') return 'Type here';
    if (scene.action !== 'click' || !scene.target) return '';
    const words = String(scene.target.text || '').split(' ');
    return words.length <= 4 && words.join(' ').length <= 26 ? `Click “${words.join(' ')}”` : 'Click here';
}

export function TutorialStep({ scene, index, props, durationFrames }) {
    const frame = useCurrentFrame();
    const L = useLayout(props);
    const { palette, host, shotAspect, totalSteps } = props;
    const next = props.scenes[index + 1];
    const prev = props.scenes[index - 1];
    // A click that leads to another page shows that page loading inside the same window.
    const afterSrc = scene.action === 'click' && next?.type === 'step' && next.path !== scene.path ? next.screenshotData : null;
    // The cursor continues from where it was on the same page.
    const cursorStart = prev?.type === 'step' && prev.target && prev.path === scene.path ? { x: prev.target.x + prev.target.w / 2, y: prev.target.y + prev.target.h / 2 } : null;
    const screen = (width, tilt) => (
        <Screen
            src={scene.screenshotData}
            nextSrc={scene.nextShotData}
            afterSrc={afterSrc}
            host={host}
            path={scene.path}
            afterPath={next?.path}
            width={width}
            aspect={shotAspect}
            palette={palette}
            target={scene.target}
            action={scene.action}
            typed={scene.typed}
            durationFrames={durationFrames}
            zoom={scene.action === 'type' ? 2.2 : scene.action === 'click' ? 2.2 : 1.7}
            settle
            tilt={tilt}
            callout={calloutText(scene)}
            calloutSize={L.unit * 0.022}
            cursorStart={cursorStart}
        />
    );
    const rise = ease(frame, 0, 20, [0, 1], expoOut);
    const numeral = pop(frame, 30, 0, { damping: 12, stiffness: 150, mass: 0.7 });

    const caption = (colW, headMax, compact) => (
        <div style={{ width: colW, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: L.unit * 0.02, marginBottom: L.unit * 0.022 }}>
                <div style={{ fontFamily: DISPLAY_FONT, fontSize: L.unit * (compact ? 0.09 : 0.16), lineHeight: 0.82, color: palette.accent, transform: `scale(${numeral})`, transformOrigin: 'left bottom' }}>{pad2(scene.step)}</div>
                <div style={{ fontSize: L.unit * 0.021, fontWeight: 800, letterSpacing: '0.16em', color: alpha(palette.fg, 0.6), paddingBottom: L.unit * 0.008 }}>STEP {scene.step} OF {totalSteps}</div>
            </div>
            <Progress step={scene.step} total={totalSteps} palette={palette} width={colW} height={Math.max(4, L.unit * 0.007)} />
            <div style={{ height: L.unit * 0.035 }} />
            <Kinetic
                text={scene.headline}
                size={fitSize(scene.headline, colW, { maxSize: headMax, minSize: L.unit * 0.045, maxLines: 3 })}
                color={palette.fg}
                accent={palette.accent}
                accentText={palette.accentText}
                align="left"
                variant="rise"
                mark="none"
                delay={6}
                maxWidth={colW}
            />
            <Subline text={scene.subline} size={L.unit * (compact ? 0.03 : 0.031)} color={palette.fg} delay={14} align="left" maxWidth={colW} marginTop={L.unit * 0.02} />
        </div>
    );

    if (L.vertical || L.square) {
        const dev = fitDevice(L.width * (L.vertical ? 0.86 : 0.84), L.height * (L.vertical ? 0.6 : 0.58), shotAspect);
        return (
            <AbsoluteFill style={{ alignItems: 'center', paddingTop: L.height * (L.vertical ? 0.06 : 0.05) }}>
                {caption(L.width * 0.86, L.unit * (L.vertical ? 0.08 : 0.06), true)}
                <div style={{ position: 'absolute', bottom: L.height * 0.04, left: (L.width - dev.width) / 2, opacity: rise, transform: `translateY(${(1 - rise) * L.unit * 0.08}px)` }}>{screen(dev.width, { rx: 4 })}</div>
            </AbsoluteFill>
        );
    }

    const colW = L.width * 0.27;
    const dev = fitDevice(L.width * 0.62, L.height * 0.84, shotAspect);
    return (
        <AbsoluteFill style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${L.width * 0.04}px 0 ${L.width * 0.05}px` }}>
            {caption(colW, L.unit * 0.075, false)}
            <div style={{ opacity: rise, transform: `translateX(${(1 - rise) * L.unit * 0.1}px)` }}>{screen(dev.width, { rx: 2, ry: -6 })}</div>
        </AbsoluteFill>
    );
}

export function TutorialOutro({ scene, props, durationFrames }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const L = useLayout(props);
    const { palette, host, iconData, productName } = props;
    const steps = stepsOf(props);
    const colW = L.vertical ? L.width * 0.84 : L.width * 0.4;
    const btn = pop(frame, fps, 24);
    const clickAt = Math.round(durationFrames * 0.7);
    const press = interpolate(frame, [clickAt, clickAt + 3, clickAt + 9], [1, 0.9, 1], clamp);
    return (
        <AbsoluteFill style={{ flexDirection: L.vertical ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: L.unit * 0.08, padding: L.unit * 0.08 }}>
            <Glow color={palette.accent} size={L.unit * 1.2} x="70%" y="50%" />
            <StepList steps={steps} size={L.unit * (L.vertical ? 0.03 : 0.026)} palette={palette} dark={L.dark} delay={0} checkFrom={8} width={L.vertical ? L.width * 0.84 : L.width * 0.36} />
            <div style={{ width: colW, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <BrandMark iconData={iconData} name={productName} size={L.unit * 0.09} palette={palette} delay={6} />
                <div style={{ height: L.unit * 0.035 }} />
                <Kinetic text={scene.headline} size={fitSize(scene.headline, colW, { maxSize: L.unit * 0.1, minSize: L.unit * 0.055, maxLines: 3 })} color={palette.fg} accent={palette.accent} accentText={palette.accentText} align="left" variant="rise" delay={10} maxWidth={colW} />
                {scene.cta ? (
                    <div
                        style={{
                            marginTop: L.unit * 0.045,
                            padding: `${L.unit * 0.022}px ${L.unit * 0.05}px`,
                            borderRadius: 999,
                            background: palette.accent,
                            color: palette.accentText,
                            fontSize: L.unit * 0.036,
                            fontWeight: 800,
                            transform: `scale(${btn * press})`,
                            transformOrigin: 'left center',
                            boxShadow: `0 ${L.unit * 0.015}px ${L.unit * 0.05}px ${alpha(palette.accent, 0.5)}`,
                        }}
                    >
                        {scene.cta} →
                    </div>
                ) : null}
                {host ? <div style={{ marginTop: L.unit * 0.03, fontSize: L.unit * 0.03, fontWeight: 700, color: alpha(palette.fg, 0.7), opacity: ease(frame, 28, 40) }}>{host}</div> : null}
            </div>
        </AbsoluteFill>
    );
}
