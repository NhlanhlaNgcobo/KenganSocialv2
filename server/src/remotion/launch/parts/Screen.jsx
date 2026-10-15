import React from 'react';
import { Easing, Img, interpolate, useCurrentFrame } from 'remotion';
import { clamp, ease } from './motion.js';

/**
 * A captured page in a browser window that "does things": the camera pushes in on the real
 * element (a button, link, field or heading found on the page), a spotlight isolates it, a
 * cursor glides over and clicks, fields fill with typed text, and pages scroll.
 * Element boxes are in percent of the captured viewport, so they line up with the image.
 */

/** When things happen inside a screen scene, as frame numbers (shared with the audio layer). */
export function screenTimings(durationFrames, action) {
    const at = (f) => Math.round(durationFrames * f);
    return {
        cursorFrom: at(0.14),
        cursorTo: at(0.42),
        click: action === 'click' || action === 'type' ? at(0.48) : null,
        zoomFrom: at(action === 'scroll' ? 0.72 : 0.22),
        zoomTo: at(action === 'scroll' ? 0.9 : 0.58),
        typeFrom: at(0.52),
        typeTo: at(0.86),
        scrollFrom: at(0.2),
        scrollTo: at(0.7),
    };
}

function Cursor({ x, y, size, pressed }) {
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: `translate(-12%, -8%) scale(${pressed ? 0.82 : 1})`, filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.4))', zIndex: 6 }}
        >
            <path d="M4 2l15 9.5-6.6 1.4L9.4 20z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
    );
}

export function Screen({ src, nextSrc, host, width, aspect, palette, target, action = 'look', typed = '', durationFrames, tilt = false, zoom = 1.5, chrome = true }) {
    const frame = useCurrentFrame();
    const T = screenTimings(durationFrames, action);
    const bar = chrome ? Math.max(22, width * 0.034) : 0;
    const contentH = width / aspect;
    const height = contentH + bar;
    const radius = width * 0.016;

    const cx = target ? target.x + target.w / 2 : 50;
    const cy = target ? target.y + target.h / 2 : 45;

    // Camera push towards the target (or a gentle drift when there is none).
    const zoomP = ease(frame, T.zoomFrom, T.zoomTo, [0, 1], Easing.inOut(Easing.cubic));
    const scale = target ? 1 + (zoom - 1) * zoomP : 1 + 0.05 * ease(frame, 0, durationFrames, [0, 1], Easing.linear);
    // Keep the zoom origin away from the edges so the frame never shows empty space.
    const ox = Math.min(85, Math.max(15, cx));
    const oy = Math.min(85, Math.max(15, cy));

    // Spotlight on the target.
    const spot = target ? ease(frame, T.zoomFrom + 4, T.zoomFrom + 16) * (action === 'scroll' ? 0 : 1) : 0;

    // Cursor path: from the lower right towards the target.
    const move = ease(frame, T.cursorFrom, T.cursorTo, [0, 1], Easing.inOut(Easing.cubic));
    const showCursor = target && action !== 'look' && action !== 'scroll';
    const curX = interpolate(move, [0, 1], [Math.min(92, cx + 30), cx]);
    const curY = interpolate(move, [0, 1], [Math.min(95, cy + 28), cy]);
    const pressed = T.click != null && frame >= T.click && frame < T.click + 5;
    const ripple = T.click != null ? interpolate(frame, [T.click, T.click + 16], [0, 1], clamp) : 0;

    // Typing.
    const typedChars = action === 'type' ? Math.floor(interpolate(frame, [T.typeFrom, T.typeTo], [0, typed.length], clamp)) : 0;

    // Scrolling between two captures of the same page.
    const scrollP = action === 'scroll' && nextSrc ? ease(frame, T.scrollFrom, T.scrollTo, [0, 1], Easing.inOut(Easing.cubic)) : 0;

    const pad = 0.6; // % around the target box
    const enterTilt = tilt ? interpolate(frame, [0, 22], [1, 0.35], { ...clamp, easing: Easing.out(Easing.cubic) }) : 0;

    return (
        <div style={{ perspective: width * 2.2 }}>
            <div
                style={{
                    width,
                    height,
                    borderRadius: radius,
                    overflow: 'hidden',
                    background: '#fff',
                    position: 'relative',
                    transform: tilt ? `rotateX(${enterTilt * 10}deg) rotateY(${-enterTilt * 16}deg)` : undefined,
                    boxShadow: `0 ${width * 0.03}px ${width * 0.08}px rgba(0,0,0,0.38), 0 0 0 1px rgba(255,255,255,0.12), 0 0 ${width * 0.06}px ${palette.accent}33`,
                }}
            >
                {chrome ? (
                    <div style={{ height: bar, background: '#f1f1f4', display: 'flex', alignItems: 'center', gap: bar * 0.26, padding: `0 ${bar * 0.5}px`, position: 'relative', zIndex: 7 }}>
                        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
                            <span key={c} style={{ width: bar * 0.34, height: bar * 0.34, borderRadius: '50%', background: c }} />
                        ))}
                        <span
                            style={{
                                marginLeft: bar * 0.5,
                                padding: `${bar * 0.08}px ${bar * 0.6}px`,
                                borderRadius: bar,
                                background: '#fff',
                                fontSize: bar * 0.42,
                                color: '#55555f',
                                fontFamily: 'system-ui, sans-serif',
                            }}
                        >
                            {host}
                        </span>
                    </div>
                ) : null}
                <div style={{ position: 'relative', width, height: contentH, overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', inset: 0, transform: `scale(${scale})`, transformOrigin: `${ox}% ${oy}%` }}>
                        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: nextSrc && action === 'scroll' ? contentH * 2 : contentH, transform: `translateY(${-scrollP * contentH}px)` }}>
                            <Img src={src} style={{ display: 'block', width, height: contentH, objectFit: 'fill' }} />
                            {nextSrc && action === 'scroll' ? <Img src={nextSrc} style={{ display: 'block', width, height: contentH, objectFit: 'fill' }} /> : null}
                        </div>

                        {target && spot > 0 ? (
                            <div
                                style={{
                                    position: 'absolute',
                                    left: `${target.x - pad}%`,
                                    top: `${target.y - pad}%`,
                                    width: `${target.w + pad * 2}%`,
                                    height: `${target.h + pad * 2}%`,
                                    borderRadius: width * 0.008,
                                    boxShadow: `0 0 0 ${width * 2}px rgba(8,6,16,${0.45 * spot}), 0 0 0 ${Math.max(2, width * 0.0025)}px ${palette.accent}, 0 0 ${width * 0.03}px ${palette.accent}`,
                                    opacity: spot,
                                    zIndex: 4,
                                }}
                            />
                        ) : null}

                        {action === 'type' && target ? (
                            <div
                                style={{
                                    position: 'absolute',
                                    left: `${target.x}%`,
                                    top: `${target.y}%`,
                                    width: `${target.w}%`,
                                    height: `${target.h}%`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: `0 ${width * 0.008}px`,
                                    background: frame >= T.typeFrom ? '#ffffff' : 'transparent',
                                    borderRadius: width * 0.004,
                                    color: '#111',
                                    fontFamily: 'system-ui, sans-serif',
                                    fontSize: Math.max(10, (target.h / 100) * contentH * 0.42),
                                    zIndex: 5,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                }}
                            >
                                {frame >= T.typeFrom ? typed.slice(0, typedChars) : ''}
                                {frame >= T.typeFrom && Math.floor(frame / 8) % 2 === 0 ? <span style={{ width: 2, height: '60%', background: '#111', marginLeft: 2 }} /> : null}
                            </div>
                        ) : null}

                        {showCursor && ripple > 0 && ripple < 1 ? (
                            <div
                                style={{
                                    position: 'absolute',
                                    left: `${cx}%`,
                                    top: `${cy}%`,
                                    width: width * 0.06,
                                    height: width * 0.06,
                                    marginLeft: -width * 0.03,
                                    marginTop: -width * 0.03,
                                    borderRadius: '50%',
                                    border: `${width * 0.004}px solid ${palette.accent}`,
                                    opacity: 1 - ripple,
                                    transform: `scale(${0.3 + ripple * 1.2})`,
                                    zIndex: 5,
                                }}
                            />
                        ) : null}
                        {showCursor && frame >= T.cursorFrom - 4 ? <Cursor x={curX} y={curY} size={width * 0.032 / Math.max(1, scale * 0.8)} pressed={pressed} /> : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
