import React, { useEffect, useState } from 'react';
import {
    AbsoluteFill,
    Audio,
    Easing,
    Img,
    Sequence,
    continueRender,
    delayRender,
    interpolate,
    spring,
    useCurrentFrame,
    useVideoConfig,
} from 'remotion';

/**
 * Launch video composition. Scene structure and tone behaviour follow /brag-slim
 * (github.com/latent-spaces/brag, MIT). Every frame is a pure function of the frame number.
 */

const TRANSITIONS = {
    default: 'slide',
    polished: 'fade',
    'yc-parody': 'cut',
    chaotic: 'flash',
    deadpan: 'fade',
    cinematic: 'wipe',
    'app-store': 'slide',
};

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

function useGoogleFont(family) {
    const [handle] = useState(() => delayRender(`font ${family}`, { timeoutInMilliseconds: 15000 }));
    useEffect(() => {
        const name = String(family || '').split(',')[0].replace(/["']/g, '').trim();
        const generic = ['ui-sans-serif', 'system-ui', 'sans-serif', 'serif', '-apple-system', 'monospace', ''];
        if (generic.includes(name)) {
            continueRender(handle);
            return;
        }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@400;500;600;700;800;900&display=block`;
        const done = () => document.fonts.ready.then(() => continueRender(handle));
        link.onload = done;
        link.onerror = () => continueRender(handle); // not a Google font: system fallback
        document.head.appendChild(link);
    }, [family, handle]);
}

/** Scene-level enter/exit: returns style for the scene container. Old content leaves, then new arrives. */
function sceneMotion(frame, duration, transition, fps) {
    const inLen = transition === 'fade' ? Math.round(fps * 0.6) : Math.round(fps * 0.35);
    const outLen = transition === 'cut' || transition === 'flash' ? 0 : Math.round(fps * 0.25);
    if (transition === 'cut') return {};
    const enter = interpolate(frame, [0, inLen], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
    const exit = outLen ? interpolate(frame, [duration - outLen, duration], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) }) : 0;
    const opacity = enter * (1 - exit);
    switch (transition) {
        case 'slide':
            return { opacity, transform: `translateY(${(1 - enter) * 40 - exit * 30}px)` };
        case 'flash':
            return { transform: `scale(${1 + (1 - enter) * 0.12})` };
        case 'wipe':
            return { opacity: 1 - exit, clipPath: `inset(0 ${(1 - enter) * 100}% 0 0)` };
        default:
            return { opacity };
    }
}

/** Word-by-word reveal for text the viewer should read. */
function Words({ text, delay = 0, stagger = 3, style, calm }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const words = String(text || '').split(' ').filter(Boolean);
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: style?.textAlign === 'left' ? 'flex-start' : 'center', columnGap: '0.28em', ...style }}>
            {words.map((w, i) => {
                const local = frame - delay - (calm ? 0 : i * stagger);
                const p = calm
                    ? interpolate(local, [0, fps * 0.5], [0, 1], clamp)
                    : spring({ frame: local, fps, config: { damping: 200, stiffness: 180, mass: 0.6 } });
                return (
                    <span key={i} style={{ display: 'inline-block', opacity: p, transform: `translateY(${(1 - p) * 0.35}em)` }}>
                        {w}
                    </span>
                );
            })}
        </div>
    );
}

function BrowserFrame({ src, host, width, palette, progress, cursor }) {
    const height = width * 0.62;
    const bar = Math.max(22, width * 0.035);
    return (
        <div
            style={{
                width,
                height,
                borderRadius: width * 0.018,
                overflow: 'hidden',
                background: '#fff',
                boxShadow: '0 30px 80px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.08)',
                position: 'relative',
                transform: `scale(${1 + progress * 0.03})`,
            }}
        >
            <div style={{ height: bar, background: '#f1f1f3', display: 'flex', alignItems: 'center', gap: bar * 0.25, padding: `0 ${bar * 0.5}px` }}>
                {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
                    <span key={c} style={{ width: bar * 0.34, height: bar * 0.34, borderRadius: '50%', background: c }} />
                ))}
                <span style={{ marginLeft: bar * 0.5, fontSize: bar * 0.42, color: '#6b6b76', fontFamily: 'system-ui, sans-serif' }}>{host}</span>
            </div>
            <Img
                src={src}
                style={{
                    width: '100%',
                    height: height - bar,
                    objectFit: 'cover',
                    objectPosition: `50% ${progress * 35}%`,
                    display: 'block',
                }}
            />
            {cursor ? <Cursor {...cursor} accent={palette.accent} /> : null}
        </div>
    );
}

/** A pointer that glides to a spot and clicks — "things happen", per /brag. */
function Cursor({ x, y, clickAt, frame, size, accent }) {
    const p = interpolate(frame, [clickAt - 18, clickAt], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
    const cx = interpolate(p, [0, 1], [x + 18, x]);
    const cy = interpolate(p, [0, 1], [y + 14, y]);
    const ripple = interpolate(frame, [clickAt, clickAt + 14], [0, 1], clamp);
    const press = frame >= clickAt && frame < clickAt + 4 ? 0.85 : 1;
    return (
        <>
            {ripple > 0 && ripple < 1 ? (
                <div
                    style={{
                        position: 'absolute',
                        left: `${x}%`,
                        top: `${y}%`,
                        width: size * 2.4,
                        height: size * 2.4,
                        marginLeft: -size * 1.2,
                        marginTop: -size * 1.2,
                        borderRadius: '50%',
                        border: `${size * 0.12}px solid ${accent}`,
                        opacity: 1 - ripple,
                        transform: `scale(${0.3 + ripple})`,
                    }}
                />
            ) : null}
            <svg
                viewBox="0 0 24 24"
                width={size}
                height={size}
                style={{ position: 'absolute', left: `${cx}%`, top: `${cy}%`, transform: `scale(${press})`, filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.35))' }}
            >
                <path d="M4 2l15 9.5-6.6 1.4L9.4 20z" fill="#111" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
        </>
    );
}

function Scene({ scene, index, props }) {
    const frame = useCurrentFrame();
    const { fps, width, height } = useVideoConfig();
    const { palette, tone, productName, iconData, host } = props;
    const transition = TRANSITIONS[tone] || 'slide';
    const durationFrames = Math.round(scene.duration * fps);
    const vertical = height > width;
    const unit = Math.min(width, height);
    const calm = tone === 'polished' || tone === 'deadpan';
    const upper = tone === 'chaotic';
    const progress = interpolate(frame, [0, durationFrames], [0, 1], clamp);

    // Beside a screenshot the headline gets a narrow column, so it steps down a size.
    const split = scene.screenshotData != null && scene.type !== 'hook' && scene.type !== 'outro';
    const words = scene.headline.split(' ').length;
    const headlineSize = split
        ? unit * (vertical ? 0.075 : words > 5 ? 0.058 : 0.068)
        : {
              hook: unit * (tone === 'cinematic' ? 0.17 : words > 5 ? 0.12 : 0.15),
              reveal: unit * 0.13,
              feature: unit * 0.1,
              showcase: unit * 0.09,
              outro: unit * 0.13,
          }[scene.type];

    const headline = (
        <Words
            text={upper ? scene.headline.toUpperCase() : scene.headline}
            delay={transition === 'cut' ? 0 : 4}
            calm={calm}
            stagger={tone === 'chaotic' ? 1 : 3}
            style={{
                fontSize: headlineSize,
                fontWeight: tone === 'deadpan' || tone === 'polished' ? 600 : 800,
                lineHeight: 1.02,
                letterSpacing: '-0.035em',
                color: palette.fg,
                maxWidth: split ? undefined : width * (vertical ? 0.88 : 0.8),
                textAlign: scene.screenshot != null && !vertical && scene.type !== 'hook' && scene.type !== 'outro' ? 'left' : 'center',
            }}
        />
    );

    const sub = scene.subline ? (
        <Words
            text={scene.subline}
            delay={12}
            calm
            style={{
                fontSize: unit * 0.036,
                fontWeight: 500,
                lineHeight: 1.3,
                color: palette.fg,
                opacity: 0.78,
                marginTop: unit * 0.03,
                maxWidth: vertical ? width * 0.86 : width * 0.62,
                textAlign: scene.screenshot != null && !vertical && scene.type !== 'outro' ? 'left' : 'center',
            }}
        />
    ) : null;

    const eyebrow = scene.eyebrow ? (
        <div
            style={{
                fontSize: unit * 0.026,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: palette.accent,
                marginBottom: unit * 0.02,
                opacity: interpolate(frame, [0, 10], [0, 1], clamp),
            }}
        >
            {scene.eyebrow}
        </div>
    ) : null;

    let body;
    if ((scene.type === 'feature' || scene.type === 'showcase' || scene.type === 'reveal') && scene.screenshotData) {
        const frameWidth = vertical ? width * 0.86 : width * (scene.type === 'showcase' ? 0.62 : 0.54);
        const clickAt = Math.round(durationFrames * 0.55);
        body = (
            <div
                style={{
                    display: 'flex',
                    flexDirection: vertical ? 'column' : 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: unit * 0.06,
                    width: '100%',
                    height: '100%',
                    padding: unit * 0.07,
                }}
            >
                <div style={{ flex: vertical ? '0 0 auto' : '1 1 0', display: 'flex', flexDirection: 'column', alignItems: vertical ? 'center' : 'flex-start' }}>
                    {eyebrow}
                    {headline}
                    {sub}
                </div>
                <div style={{ transform: `translateY(${interpolate(frame, [0, 18], [30, 0], clamp)}px)`, opacity: interpolate(frame, [2, 14], [0, 1], clamp) }}>
                    <BrowserFrame
                        src={scene.screenshotData}
                        host={host}
                        width={frameWidth}
                        palette={palette}
                        progress={progress}
                        cursor={scene.type !== 'reveal' ? { x: 58, y: 48, clickAt, frame, size: unit * 0.045 } : null}
                    />
                </div>
            </div>
        );
    } else if (scene.type === 'outro') {
        const clickAt = Math.round(durationFrames * 0.6);
        const pulse = interpolate(frame, [clickAt, clickAt + 4, clickAt + 10], [1, 0.94, 1], clamp);
        body = (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: unit * 0.08 }}>
                {iconData ? (
                    <Img src={iconData} style={{ width: unit * 0.1, height: unit * 0.1, borderRadius: unit * 0.022, marginBottom: unit * 0.04, opacity: interpolate(frame, [0, 10], [0, 1], clamp) }} />
                ) : null}
                {headline}
                {sub}
                {scene.cta ? (
                    <div
                        style={{
                            marginTop: unit * 0.06,
                            padding: `${unit * 0.022}px ${unit * 0.05}px`,
                            borderRadius: unit * 0.1,
                            background: palette.accent,
                            color: palette.accentText,
                            fontSize: unit * 0.034,
                            fontWeight: 700,
                            opacity: interpolate(frame, [14, 22], [0, 1], clamp),
                            transform: `scale(${pulse * interpolate(frame, [14, 24], [0.9, 1], clamp)})`,
                        }}
                    >
                        {scene.cta}
                    </div>
                ) : null}
            </div>
        );
    } else {
        // Hook / reveal / feature without a screenshot: typography carries it.
        const bar = scene.type === 'reveal' ? interpolate(frame, [10, 26], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) }) : 0;
        body = (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: unit * 0.09 }}>
                {scene.type === 'feature' && !scene.eyebrow ? (
                    <div style={{ fontSize: unit * 0.03, fontWeight: 700, color: palette.accent, marginBottom: unit * 0.02 }}>{String(index).padStart(2, '0')}</div>
                ) : (
                    eyebrow
                )}
                {headline}
                {scene.type === 'reveal' ? <div style={{ height: unit * 0.008, width: unit * 0.18 * bar, background: palette.accent, marginTop: unit * 0.03, borderRadius: 99 }} /> : null}
                {sub}
            </div>
        );
    }

    return <AbsoluteFill style={{ ...sceneMotion(frame, durationFrames, transition, fps) }}>{body}</AbsoluteFill>;
}

function Flash({ at }) {
    const frame = useCurrentFrame();
    const o = interpolate(frame - at, [0, 1, 4], [0, 0.85, 0], clamp);
    return o > 0 ? <AbsoluteFill style={{ background: '#fff', opacity: o }} /> : null;
}

export const LaunchVideo = (props) => {
    const { fps } = useVideoConfig();
    const frame = useCurrentFrame();
    useGoogleFont(props.fontFamily);
    const total = props.scenes.reduce((sum, s) => sum + Math.round(s.duration * fps), 0);
    let start = 0;

    return (
        <AbsoluteFill style={{ background: props.palette.bg, fontFamily: `${props.fontFamily}, Inter, system-ui, sans-serif` }}>
            {props.music ? (
                <Audio
                    src={props.music}
                    volume={(f) => interpolate(f, [0, fps * 0.5, total - fps * 1.2, total], [0, 0.55, 0.55, 0], clamp)}
                />
            ) : null}
            {props.scenes.map((scene, i) => {
                const from = start;
                const len = Math.round(scene.duration * fps);
                start += len;
                return (
                    <Sequence key={i} from={from} durationInFrames={len}>
                        <Scene scene={scene} index={i} props={props} />
                    </Sequence>
                );
            })}
            {props.tone === 'chaotic'
                ? props.scenes.slice(1).map((_, i) => {
                      const at = props.scenes.slice(0, i + 1).reduce((s, sc) => s + Math.round(sc.duration * fps), 0);
                      return <Flash key={i} at={at} />;
                  })
                : null}
            {/* Subtle progress line keeps motion alive between beats. */}
            <div style={{ position: 'absolute', left: 0, bottom: 0, height: 4, width: `${(frame / total) * 100}%`, background: props.palette.accent, opacity: 0.6 }} />
        </AbsoluteFill>
    );
};
