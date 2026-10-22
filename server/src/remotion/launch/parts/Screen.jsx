import React from 'react';
import { Img, interpolate, useCurrentFrame } from 'remotion';
import { alpha, clamp, ease, expoOut, lightness, smooth } from './motion.js';

/**
 * A captured page inside a device (browser window, or a phone for tall captures) that "does
 * things": the camera pans and zooms onto the real element (button, link, field or heading found
 * on the page) and back out, a spotlight isolates it, a callout names it, a cursor travels to it
 * and clicks with a ripple, fields fill with typed text, pages scroll or change after a click.
 * Element boxes are in percent of the captured viewport, so they line up with the image.
 */

/**
 * When things happen inside a screen, as frame numbers (shared with the audio layer).
 * @param {object} opts  { settle: true → zoom back out before the end, page: true → a new page loads after the click }
 */
export function screenTimings(durationFrames, action, opts = {}) {
    const at = (f) => Math.round(durationFrames * f);
    const page = !!opts.page && action === 'click';
    const t = {
        cursorFrom: at(0.1),
        cursorTo: at(action === 'type' ? 0.3 : 0.4),
        click: action === 'click' || action === 'type' ? at(action === 'type' ? 0.33 : 0.44) : null,
        zoomFrom: at(action === 'scroll' ? 0.66 : 0.12),
        zoomTo: at(action === 'scroll' ? 0.82 : 0.4),
        zoomOutFrom: null,
        zoomOutTo: null,
        typeFrom: at(0.4),
        typeTo: at(0.74),
        scrollFrom: at(0.12),
        scrollTo: at(0.58),
        pageFrom: null,
        pageTo: null,
    };
    if (page) {
        t.zoomOutFrom = at(0.58);
        t.zoomOutTo = at(0.74);
        t.pageFrom = at(0.66);
        t.pageTo = at(0.84);
    } else if (opts.settle) {
        t.zoomOutFrom = at(action === 'type' ? 0.82 : 0.8);
        t.zoomOutTo = at(0.95);
    }
    return t;
}

function Cursor({ x, y, size, pressed }) {
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: `translate(-14%, -8%) scale(${pressed ? 0.8 : 1})`, filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.45))', zIndex: 9 }}
        >
            <path d="M4 2l15 9.5-6.6 1.4L9.4 20z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
    );
}

function Lock({ size, color }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} style={{ flex: 'none' }}>
            <rect x="5" y="10" width="14" height="11" rx="2.5" fill={color} />
            <path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke={color} strokeWidth="2.2" fill="none" />
        </svg>
    );
}

/** Zoom level that makes the target fill a good part of the frame. */
function zoomFor(target, max) {
    if (!target) return 1;
    return Math.max(1.25, Math.min(max, 46 / Math.max(target.w, 1), 34 / Math.max(target.h, 1)));
}

/** Outer size of a device that fits a box (width × height) for a capture of the given aspect. */
export function fitDevice(maxW, maxH, aspect) {
    const phone = aspect < 0.8;
    // Height per unit of width: phone = bezel (4.5% each side) around the capture; browser = capture + title bar.
    const perW = phone ? 0.91 / aspect + 0.09 : 1 / aspect + 0.032;
    const width = Math.min(maxW, maxH / perW);
    return { width, height: width * perW, phone };
}

export function Screen({
    src,
    nextSrc,
    afterSrc,
    host,
    path = '',
    afterPath = '',
    width,
    aspect,
    palette,
    target,
    action = 'look',
    typed = '',
    durationFrames,
    zoom = 2.2,
    settle = false,
    tilt = null,
    callout = '',
    calloutSize = 22,
    cursorStart = null,
    spotlight = true,
}) {
    const frame = useCurrentFrame();
    const page = !!afterSrc && action === 'click';
    const T = screenTimings(durationFrames, action, { settle, page });
    const dark = lightness(palette.bg) < 0.5;
    const phone = aspect < 0.8;
    const bezel = phone ? width * 0.045 : 0;
    const innerW = width - bezel * 2;
    const bar = phone ? 0 : Math.max(22, width * 0.032);
    const contentH = innerW / aspect;
    const height = contentH + bar + bezel * 2;
    const radius = phone ? width * 0.13 : width * 0.013;

    // --- Camera: pan + zoom onto the target, keeping the image edge-to-edge -------------------
    const z = zoomFor(target, zoom);
    const zin = ease(frame, T.zoomFrom, T.zoomTo, [0, 1], smooth);
    const zout = T.zoomOutFrom != null ? ease(frame, T.zoomOutFrom, T.zoomOutTo, [0, 1], smooth) : 0;
    const zp = target ? Math.max(0, zin - zout) : 0;
    const zz = 1 + (z - 1) * zp + (target ? 0 : 0.06 * ease(frame, 0, durationFrames, [0, 1], (x) => x));
    const tcx = target ? target.x + target.w / 2 : 50;
    const tcy = target ? target.y + target.h / 2 : 50;
    const ccx = Math.min(100 - 50 / z, Math.max(50 / z, tcx));
    const ccy = Math.min(100 - 50 / z, Math.max(50 / z, tcy));
    const Fx = 50 + (ccx - 50) * zp;
    const Fy = 50 + (ccy - 50) * zp;
    const mapX = (q) => 50 + (q - Fx) * zz;
    const mapY = (q) => 50 + (q - Fy) * zz;
    const camera = `translate(${50 - Fx * zz}%, ${50 - Fy * zz}%) scale(${zz})`;

    // --- Spotlight and callout -------------------------------------------------------------------
    const spotIn = ease(frame, T.zoomFrom + 6, T.zoomTo);
    const spotOut = T.zoomOutFrom != null ? ease(frame, T.zoomOutFrom - 4, T.zoomOutFrom + 6) : 0;
    const spot = target && spotlight && action !== 'scroll' ? Math.max(0, spotIn - spotOut) : 0;
    const pad = 0.8;

    // --- Cursor ----------------------------------------------------------------------------------
    const showCursor = !!target && (action === 'click' || action === 'type');
    const move = ease(frame, T.cursorFrom, T.cursorTo, [0, 1], smooth);
    const start = cursorStart || { x: Math.min(90, tcx + 26), y: Math.min(92, tcy + 30) };
    const endX = mapX(tcx);
    const endY = mapY(tcy);
    // A gentle arc, like a hand moving a mouse.
    const arc = Math.sin(move * Math.PI) * 6;
    const curX = start.x + (endX - start.x) * move + arc * 0.4;
    const curY = start.y + (endY - start.y) * move - arc;
    const pressed = T.click != null && frame >= T.click && frame < T.click + 5;
    const ripple = T.click != null ? interpolate(frame, [T.click, T.click + 20], [0, 1], clamp) : 0;
    const cursorFade = page ? 1 - ease(frame, T.pageFrom, T.pageFrom + 6) : 1;

    // --- Typing, scrolling, page change ----------------------------------------------------------
    const typedChars = action === 'type' ? Math.floor(interpolate(frame, [T.typeFrom, T.typeTo], [0, typed.length], clamp)) : 0;
    const scrollP = action === 'scroll' && nextSrc ? ease(frame, T.scrollFrom, T.scrollTo, [0, 1], smooth) : 0;
    const pageP = page ? ease(frame, T.pageFrom + 4, T.pageTo, [0, 1], expoOut) : 0;
    const loadBar = page ? interpolate(frame, [T.click + 2, T.pageFrom + 6], [0, 1], clamp) : 0;
    const shownPath = page && pageP > 0.4 ? afterPath : path;

    // --- Device pose: tilted in 3D, settling, with a slow drift ---------------------------------
    const enter = ease(frame, 0, 26, [0, 1], expoOut);
    const pose = tilt || { rx: 0, ry: 0, rz: 0 };
    const rx = (pose.rx || 0) * (0.45 + 0.55 * (1 - enter)) + (pose.rx ? 4 * (1 - enter) : 0) + Math.sin(frame / 40) * (pose.rx || pose.ry ? 0.8 : 0);
    const ry = (pose.ry || 0) * (0.5 + 0.5 * (1 - enter)) + Math.cos(frame / 47) * (pose.rx || pose.ry ? 1.2 : 0);
    const rz = (pose.rz || 0) * (1 - enter * 0.6);

    const chromeBg = dark ? '#1b1b1f' : '#f2f2f5';
    const chromeFg = dark ? 'rgba(255,255,255,0.62)' : '#55555f';
    const glare = 0.5 + Math.sin(frame / 55) * 0.2;

    const calloutLeft = mapX(target ? target.x + target.w : 50) < 62;
    const calloutX = target ? (calloutLeft ? mapX(target.x + target.w) + 2 : mapX(target.x) - 2) : 0;
    const calloutY = target ? Math.min(90, Math.max(10, mapY(tcy))) : 0;
    const calloutP = callout ? Math.max(0, ease(frame, T.zoomTo - 4, T.zoomTo + 10, [0, 1], expoOut) - spotOut) : 0;

    return (
        <div style={{ perspective: width * 2.4, width, height, position: 'relative' }}>
            {/* Soft contact shadow and brand glow under the device */}
            <div
                style={{
                    position: 'absolute',
                    left: '6%',
                    right: '6%',
                    bottom: -height * 0.06,
                    height: height * 0.16,
                    borderRadius: '50%',
                    background: `radial-gradient(ellipse at center, rgba(0,0,0,${dark ? 0.55 : 0.28}), transparent 70%)`,
                    filter: `blur(${width * 0.02}px)`,
                    transform: `translateY(${(1 - enter) * height * 0.1}px)`,
                }}
            />
            <div
                style={{
                    width,
                    height,
                    position: 'relative',
                    borderRadius: radius,
                    overflow: 'hidden',
                    background: phone ? '#0b0b0d' : chromeBg,
                    padding: bezel,
                    boxSizing: 'border-box',
                    transform: `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`,
                    transformStyle: 'preserve-3d',
                    boxShadow: `0 ${width * 0.04}px ${width * 0.09}px rgba(0,0,0,${dark ? 0.55 : 0.22}), 0 0 0 1px ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}, 0 0 ${width * 0.08}px ${alpha(palette.accent, dark ? 0.22 : 0.12)}`,
                }}
            >
                {!phone ? (
                    <div style={{ height: bar, display: 'flex', alignItems: 'center', gap: bar * 0.26, padding: `0 ${bar * 0.55}px`, position: 'relative', zIndex: 8, borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
                        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
                            <span key={c} style={{ width: bar * 0.32, height: bar * 0.32, borderRadius: '50%', background: c, flex: 'none' }} />
                        ))}
                        <span
                            style={{
                                margin: '0 auto',
                                display: 'flex',
                                alignItems: 'center',
                                gap: bar * 0.22,
                                minWidth: width * 0.3,
                                justifyContent: 'center',
                                padding: `${bar * 0.1}px ${bar * 0.7}px`,
                                borderRadius: bar,
                                background: dark ? 'rgba(255,255,255,0.07)' : '#ffffff',
                                fontSize: bar * 0.42,
                                color: chromeFg,
                                fontFamily: 'system-ui, sans-serif',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            <Lock size={bar * 0.36} color={chromeFg} />
                            {host}
                            <span style={{ opacity: 0.6 }}>{shownPath && shownPath !== '/' ? shownPath.slice(0, 32) : ''}</span>
                        </span>
                        <span style={{ width: bar * 1.6 }} />
                        {loadBar > 0 && loadBar < 1 ? <span style={{ position: 'absolute', left: 0, bottom: -1, height: Math.max(2, bar * 0.08), width: `${loadBar * 100}%`, background: palette.accent }} /> : null}
                    </div>
                ) : null}
                <div style={{ position: 'relative', width: innerW, height: contentH, overflow: 'hidden', borderRadius: phone ? width * 0.09 : 0, background: '#fff' }}>
                    <div style={{ position: 'absolute', inset: 0, transform: camera, transformOrigin: '0 0' }}>
                        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: nextSrc && action === 'scroll' ? contentH * 2 : contentH, transform: `translateY(${-scrollP * contentH}px)` }}>
                            <Img src={src} style={{ display: 'block', width: innerW, height: contentH, objectFit: 'fill' }} />
                            {nextSrc && action === 'scroll' ? <Img src={nextSrc} style={{ display: 'block', width: innerW, height: contentH, objectFit: 'fill' }} /> : null}
                        </div>

                        {target && spot > 0 ? (
                            <div
                                style={{
                                    position: 'absolute',
                                    left: `${target.x - pad}%`,
                                    top: `${target.y - pad}%`,
                                    width: `${target.w + pad * 2}%`,
                                    height: `${target.h + pad * 2}%`,
                                    borderRadius: innerW * 0.006,
                                    // A section is lifted out with a soft dim; a control also gets a glowing ring.
                                    boxShadow:
                                        target.kind === 'region'
                                            ? `0 0 0 ${innerW * 2}px rgba(6,6,10,${0.38 * spot})`
                                            : `0 0 0 ${innerW * 2}px rgba(6,6,10,${0.5 * spot}), 0 0 0 ${Math.max(1.5, (innerW * 0.0028) / zz)}px ${palette.accent}, 0 0 ${(innerW * 0.03) / zz}px ${alpha(palette.accent, 0.9)}`,
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
                                    padding: `0 ${innerW * 0.008}px`,
                                    background: frame >= T.typeFrom ? '#ffffff' : 'transparent',
                                    borderRadius: innerW * 0.004,
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
                    </div>

                    {/* The next page after a click: fades and settles in over the old one. */}
                    {page && pageP > 0 ? (
                        <Img src={afterSrc} style={{ position: 'absolute', inset: 0, width: innerW, height: contentH, objectFit: 'fill', opacity: pageP, transform: `scale(${1.04 - 0.04 * pageP})`, zIndex: 6 }} />
                    ) : null}

                    {/* Overlays in screen space: same size at any zoom. */}
                    {showCursor && ripple > 0 && ripple < 1
                        ? [0, 0.25].map((d) => {
                              const r = Math.max(0, Math.min(1, (ripple - d) / (1 - d)));
                              return r > 0 ? (
                                  <div
                                      key={d}
                                      style={{
                                          position: 'absolute',
                                          left: `${endX}%`,
                                          top: `${endY}%`,
                                          width: innerW * 0.07,
                                          height: innerW * 0.07,
                                          marginLeft: -innerW * 0.035,
                                          marginTop: -innerW * 0.035,
                                          borderRadius: '50%',
                                          border: `${innerW * 0.004}px solid ${palette.accent}`,
                                          background: alpha(palette.accent, 0.18 * (1 - r)),
                                          opacity: 1 - r,
                                          transform: `scale(${0.2 + r * 1.3})`,
                                          zIndex: 8,
                                      }}
                                  />
                              ) : null;
                          })
                        : null}
                    {showCursor && frame >= T.cursorFrom - 6 && cursorFade > 0 ? (
                        <div style={{ position: 'absolute', inset: 0, opacity: Math.min(cursorFade, ease(frame, T.cursorFrom - 6, T.cursorFrom)), zIndex: 9 }}>
                            <Cursor x={curX} y={curY} size={innerW * 0.036} pressed={pressed} />
                        </div>
                    ) : null}
                    {callout && calloutP > 0 ? (
                        <div
                            style={{
                                position: 'absolute',
                                top: `${calloutY}%`,
                                ...(calloutLeft ? { left: `${calloutX}%` } : { right: `${100 - calloutX}%` }),
                                transform: `translateY(-50%) translateX(${(1 - calloutP) * (calloutLeft ? -20 : 20)}px) scale(${0.8 + 0.2 * calloutP})`,
                                transformOrigin: calloutLeft ? 'left center' : 'right center',
                                opacity: calloutP,
                                display: 'flex',
                                flexDirection: calloutLeft ? 'row' : 'row-reverse',
                                alignItems: 'center',
                                zIndex: 10,
                            }}
                        >
                            <span style={{ width: calloutSize * 1.4, height: Math.max(2, calloutSize * 0.12), background: palette.accent }} />
                            <span
                                style={{
                                    padding: `${calloutSize * 0.45}px ${calloutSize * 0.8}px`,
                                    borderRadius: calloutSize * 0.5,
                                    background: palette.accent,
                                    color: palette.accentText,
                                    fontSize: calloutSize,
                                    fontWeight: 800,
                                    whiteSpace: 'nowrap',
                                    boxShadow: `0 ${calloutSize * 0.3}px ${calloutSize}px rgba(0,0,0,0.35)`,
                                }}
                            >
                                {callout}
                            </span>
                        </div>
                    ) : null}
                </div>
                {phone ? <div style={{ position: 'absolute', top: bezel + width * 0.03, left: '50%', width: width * 0.26, height: width * 0.065, marginLeft: -width * 0.13, borderRadius: 99, background: '#000', zIndex: 11 }} /> : null}
                {/* Glass glare */}
                <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(${115 + ry * 2}deg, rgba(255,255,255,${0.1 * glare}) 0%, transparent 28%, transparent 70%, rgba(255,255,255,${0.04 * glare}) 100%)`, pointerEvents: 'none', zIndex: 12 }} />
            </div>
        </div>
    );
}
