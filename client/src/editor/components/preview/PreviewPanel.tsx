import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Expand, Loader2, Minimize, Pause, Play, Repeat, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { previewFont } from '../../constants';
import { formatTimecode, getElementEnd, getElementLength } from '../../lib/time';
import { animatedTransform, cssFromValues, cssTransform, getTransform } from '../../lib/transform';
import { overlayBox, snapBox, transformForBox } from '../../lib/overlay-layouts';
import { evaluateKeyframes, setKeyframe } from '../../lib/keyframes.js';
import { useMediaStore } from '../../stores/media-store';
import { usePlaybackStore } from '../../stores/playback-store';
import { getCanvasSize, useProjectStore } from '../../stores/project-store';
import { useTimelineStore } from '../../stores/timeline-store';
import type { AspectRatio, MediaElement, MediaItem, TextElement, TimelineElement, TimelineTrack } from '../../types';
import { previewFilter } from '../../lib/grade';
import { effectPreview, transitionStyles, transitionWindows, type TransitionWindow } from '../../lib/fx';
import { isNeutralColor, vignetteAt } from '../../lib/color-pipeline.js';
import { GradedCanvas, useLut, webgl2Available } from './GradedCanvas';
import type { ChromaKey, ColorSettings } from '../../types';
import { GuideTrackPlayer } from './GuideTrackPlayer';
import { LyricOverlay } from './LyricOverlay';
import { MediaLayer } from './MediaLayer';
import { useEnhanceStore } from '../../stores/enhance-store';
import { captionFrame } from '../../lib/caption-motion.js';
import { ExactPreviewButton, ExactPreviewOverlay } from './ExactPreview';
import { perfRender } from '../../lib/perf';
import { previewV2 } from '../../lib/preview-engine';

/** Vignette masks (data URLs) by settings and canvas shape; the export builds the same mask. */
const vignetteCache = new Map<string, string>();
function vignetteMask(vig: ColorSettings['vignette'], aspect: number): string {
    const key = `${JSON.stringify(vig)}:${aspect.toFixed(3)}`;
    const hit = vignetteCache.get(key);
    if (hit) return hit;
    const w = 96;
    const h = Math.max(8, Math.round(w / aspect));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y += 1)
        for (let x = 0; x < w; x += 1) {
            const { dark, light } = vignetteAt(vig, (x + 0.5) / w, (y + 0.5) / h, aspect);
            const v = Math.round((vig.amount < 0 ? dark : light) * 255);
            const i = (y * w + x) * 4;
            img.data[i] = v;
            img.data[i + 1] = v;
            img.data[i + 2] = v;
            img.data[i + 3] = 255;
        }
    ctx.putImageData(img, 0, 0);
    const url = canvas.toDataURL();
    if (vignetteCache.size > 30) vignetteCache.delete(vignetteCache.keys().next().value as string);
    vignetteCache.set(key, url);
    return url;
}

function GradedImage({ src, color, chromaKey, style }: { src: string; color: ColorSettings | null; chromaKey: ChromaKey | null; style: React.CSSProperties }) {
    const [img, setImg] = useState<HTMLImageElement | null>(null);
    const luts = useProjectStore((st) => st.luts);
    const lut = useLut(color, luts);
    return (
        <>
            <img ref={setImg} src={src} alt="" className="ke-preview__media" style={{ ...style, opacity: 0 }} draggable={false} />
            {lut || chromaKey ? <GradedCanvas source={img} lut={lut} chromaKey={chromaKey} className="ke-preview__media" style={style} /> : null}
        </>
    );
}

function UnplayableNotice({ mediaId }: { mediaId: string }) {
    const job = useEnhanceStore((s) => (s.runningMediaId === mediaId ? s : null));
    const convert = () => useEnhanceStore.getState().convertForPreview(mediaId).catch(() => {});
    return (
        <div className="ke-preview__unplayable" role="status">
            {job ? (
                <>
                    <Loader2 size={18} className="ke-spin" />
                    <p>
                        Converting this video so it plays here… {job.progress ? `${job.progress}%` : ''}
                        <small>Camera formats such as ProRes play sound but no picture in the browser.</small>
                    </p>
                </>
            ) : (
                <>
                    <p>
                        Your browser can't show this video's format (common for camera files such as ProRes).
                        <small>Convert it to MP4 to see it here; your edits stay in place.</small>
                    </p>
                    <button className="ke-btn ke-btn--sm ke-btn--primary" onClick={convert}>
                        Convert to MP4
                    </button>
                </>
            )}
        </div>
    );
}

/** Elements this far ahead of the playhead are mounted early so cuts don't stall. */
const PRELOAD_SECONDS = 2.5;

type TextDrag = { trackId: string; id: string; startX: number; startY: number; x: number; y: number; dx: number; dy: number };
type Extend = Map<string, { head: number; tail: number }>;

/** Transition state of a main clip at `time`: its role and CSS, or null. */
function transitionFor(windows: TransitionWindow[], id: string, time: number) {
    for (const w of windows) {
        const from = w.at - w.duration / 2;
        if (time < from || time >= from + w.duration) continue;
        if (w.outgoingId !== id && w.incomingId !== id) continue;
        const styles = transitionStyles(w.type, (time - from) / w.duration);
        return { incoming: w.incomingId === id, style: w.incomingId === id ? styles.b : styles.a, wash: styles.wash };
    }
    return null;
}

function washAt(windows: TransitionWindow[], time: number) {
    return windows
        .map((w) => {
            const from = w.at - w.duration / 2;
            return time >= from && time < from + w.duration ? transitionStyles(w.type, (time - from) / w.duration).wash : undefined;
        })
        .find(Boolean);
}

/** Which elements are mounted and which are visible at `time` (the preview's layer list). */
function layersAt(tracks: TimelineTrack[], time: number, extend: Extend) {
    const ordered = [...tracks].reverse();
    return ordered.flatMap((track, trackIndex) =>
        track.elements
            .filter((el) => !el.hidden)
            .filter((el) => time >= el.startTime - PRELOAD_SECONDS && time < getElementEnd(el) + 0.25 + (extend.get(el.id)?.tail || 0))
            .map((el) => {
                const ext = extend.get(el.id);
                return { track, element: el, z: trackIndex, active: time >= el.startTime - (ext?.head || 0) && time < getElementEnd(el) + (ext?.tail || 0) };
            })
    );
}

/** A compact key of the layer list: v2 re-renders the preview only when it changes. */
function layersKey(tracks: TimelineTrack[], time: number, extend: Extend) {
    return layersAt(tracks, time, extend)
        .map((l) => `${l.element.id}:${l.active ? 1 : 0}`)
        .join('|');
}

const hasKeyframes = (el: TimelineElement) => !!el.keyframes && Object.values(el.keyframes).some((k) => Array.isArray(k) && k.length > 0);

/** Whether a layer looks different from one frame to the next (and so must follow the playhead). */
function isAnimated(track: TimelineTrack, el: TimelineElement, windows: TransitionWindow[]): boolean {
    if (hasKeyframes(el)) return true;
    if (el.type === 'text') return !!el.captionMotion || el.animation === 'pop' || el.animation === 'fade';
    const media = el as MediaElement;
    if (track.isMain && windows.some((w) => w.incomingId === el.id || w.outgoingId === el.id)) return true;
    if (track.isMain && media.effects?.some((e) => e.enabled !== false)) return true;
    const t = getTransform(media);
    if (!track.isMain) t.animation = 'none'; // same rule as the layer render
    return cssTransform(t, 0, 1) !== cssTransform(t, 1, 1); // Ken Burns zoom or camera motion
}

/**
 * The time a layer draws at. Legacy passes the parent's per-frame time. In v2 an animated layer
 * subscribes to the playhead itself; a static one reads it once and doesn't re-render per frame.
 */
function useLayerTime(time: number | undefined, animated: boolean): number {
    const live = usePlaybackStore((s) => (time === undefined && animated ? s.currentTime : -1));
    if (time !== undefined) return time;
    return live >= 0 ? live : usePlaybackStore.getState().currentTime;
}

interface LayerProps {
    track: TimelineTrack;
    element: TimelineElement;
    z: number;
    active: boolean;
    /** Legacy engine: the playhead time. v2: undefined (the layer follows the playhead itself). */
    time?: number;
    media?: MediaItem;
    scale: number;
    canvasWidth: number;
    canvasHeight: number;
    windows: TransitionWindow[];
    ext?: { head: number; tail: number };
    isSelected: boolean;
    /** The text drag in progress on this element, if any. */
    drag: TextDrag | null;
    onTextPointerDown: (trackId: string, el: TextElement, x: number, y: number, e: React.PointerEvent) => void;
}

/** One layer of the preview: a text, image, video or audio element. */
const PreviewLayer = memo(function PreviewLayer({ track, element, z, active, time, media, scale, canvasWidth, canvasHeight, windows, ext, isSelected, drag, onTextPointerDown }: LayerProps) {
    perfRender('PreviewLayer');
    const animated = useMemo(() => isAnimated(track, element, windows), [track, element, windows]);
    // Layers mounted early (preload) are invisible: they don't need to follow the playhead yet.
    const currentTime = useLayerTime(time, animated && active);

    if (element.type === 'text') {
        if (!active) return null;
        const el = element;
        const kf = evaluateKeyframes(el.keyframes, currentTime - el.startTime) as Partial<Record<'x' | 'y' | 'scale' | 'rotation' | 'opacity', number>>;
        const x = (kf.x ?? el.x) + (drag ? drag.dx : 0);
        const y = (kf.y ?? el.y) + (drag ? drag.dy : 0);
        // Entrance animation, matching the renderer (fade 0.25s; pop: quick fade + scale 72% → 100%).
        const local = currentTime - el.startTime;
        const motion = el.captionMotion ? captionFrame(el.content, el.captionWords, el.captionMotion, local + el.trimStart, el.duration, el.color, el.accentColor) : null;
        const fadeIn = el.animation === 'pop' ? Math.min(1, local / 0.09) : el.animation === 'fade' ? Math.min(1, local / 0.25) : 1;
        const pop = el.animation === 'pop' ? 0.72 + 0.28 * Math.min(1, Math.max(0, local / 0.14)) : 1;
        const stroke = (el.strokeWidth || 0) > 0 && el.strokeColor && el.strokeColor !== 'transparent' && el.backgroundColor === 'transparent';
        return (
            <div
                className={`ke-preview__text ${isSelected ? 'is-selected' : ''}`}
                style={{
                    left: `${50 + (x / canvasWidth) * 100}%`,
                    top: `${50 + (y / canvasHeight) * 100}%`,
                    transform: `translate(-50%, -50%) translateY(${(motion?.y || 0) * scale}px) rotate(${kf.rotation ?? el.rotation}deg) scale(${pop * (motion?.scale || 1) * (kf.scale ?? 1)})`,
                    opacity: el.opacity * Math.max(0, fadeIn) * (motion?.opacity ?? 1) * (kf.opacity ?? 1),
                    zIndex: 100 + z,
                }}
                onPointerDown={(e) => onTextPointerDown(track.id, el, kf.x ?? el.x, kf.y ?? el.y, e)}
            >
                <div
                    style={{
                        fontSize: el.fontSize * scale,
                        fontFamily: previewFont(el.fontFamily),
                        color: el.color,
                        backgroundColor: el.backgroundColor,
                        textAlign: el.textAlign,
                        fontWeight: el.fontWeight,
                        fontStyle: el.fontStyle,
                        padding: `${6 * scale}px ${12 * scale}px`,
                        borderRadius: 6 * scale,
                        whiteSpace: 'pre',
                        lineHeight: 1.15,
                        textShadow: el.backgroundColor === 'transparent' ? `0 ${2 * scale}px ${6 * scale}px rgba(0,0,0,0.6)` : undefined,
                        ...(stroke ? { WebkitTextStroke: `${(el.strokeWidth || 0) * 2 * scale}px ${el.strokeColor}`, paintOrder: 'stroke fill' } : {}),
                    }}
                >
                    {motion
                        ? motion.chunks.map((chunk, i) => (
                              <span key={i}>
                                  <span style={{ color: chunk.color, opacity: chunk.opacity, textDecoration: chunk.underline ? 'underline' : undefined, textUnderlineOffset: '0.16em' }}>{chunk.text}</span>
                                  {chunk.tail ? <span style={{ visibility: 'hidden' }}>{chunk.tail}</span> : null}
                                  {chunk.breakAfter ? <br /> : i < motion.chunks.length - 1 ? ' ' : ''}
                              </span>
                          ))
                        : el.content}
                </div>
            </div>
        );
    }

    if (!media) return null;
    const mediaEl = element as MediaElement;
    const progress = (currentTime - element.startTime) / Math.max(getElementLength(element), 0.001);
    const clipTransform = getTransform(mediaEl);
    // Zoom animation renders on the main track only; keep preview and export identical.
    if (!track.isMain) clipTransform.animation = 'none';
    const fx = track.isMain && media.type !== 'audio' ? effectPreview(mediaEl.effects, currentTime - element.startTime, scale) : null;
    const tr = track.isMain ? transitionFor(windows, element.id, currentTime) : null;
    // Keyframes replace the static/camera value per property (same rule as the export).
    const animatedValues = mediaEl.keyframes ? animatedTransform(track.isMain ? mediaEl : { ...mediaEl, transform: clipTransform }, currentTime - element.startTime, getElementLength(element)) : null;
    const baseCss = animatedValues ? cssFromValues(animatedValues, scale) : cssTransform(clipTransform, progress, scale);
    const transform = [baseCss, fx?.transform].filter(Boolean).join(' ') || undefined;
    const kfOpacity = animatedValues?.opacity ?? 1;
    // Incoming clips draw above outgoing ones during a transition.
    const zIndex = z * 2 + (tr?.incoming ? 1 : 0);
    const vig = track.isMain && mediaEl.color?.vignette?.amount ? mediaEl.color.vignette : null;
    const overlays = [
        ...(fx?.overlays.map((o, i) => <div key={i} className="ke-preview__fx" style={o} />) || []),
        ...(vig
            ? [<div key="vig" className="ke-preview__fx" style={{ backgroundImage: `url(${vignetteMask(vig, canvasWidth / canvasHeight)})`, backgroundSize: '100% 100%', mixBlendMode: vig.amount < 0 ? 'multiply' : 'screen' }} />]
            : []),
    ];
    // Green/blue screen keys render on overlay tracks only (export matches).
    const chromaKey = !track.isMain && webgl2Available ? mediaEl.chromaKey || null : null;
    const gradedColor = webgl2Available && mediaEl.color && !isNeutralColor(mediaEl.color) ? mediaEl.color : null;
    if (media.type === 'image') {
        return active ? (
            <div className="ke-preview__tx" style={{ zIndex, ...tr?.style }}>
                {gradedColor || chromaKey ? (
                    <GradedImage src={media.url} color={gradedColor} chromaKey={chromaKey} style={{ filter: `${previewFilter(mediaEl.filter, mediaEl.grade)}${fx?.filter || ''}`.replace(/^none /, ''), transform, opacity: kfOpacity }} />
                ) : (
                    <img
                        src={media.url}
                        alt=""
                        className="ke-preview__media"
                        style={{ filter: `${previewFilter(mediaEl.filter, mediaEl.grade)}${fx?.filter || ''}`.replace(/^none /, ''), transform, opacity: kfOpacity }}
                        draggable={false}
                    />
                )}
                {overlays}
            </div>
        ) : null;
    }
    return (
        <div className="ke-preview__tx" style={{ zIndex, ...(active ? tr?.style : null) }}>
            <div className="ke-preview__layer" style={{ transform, ...(kfOpacity < 1 ? { opacity: kfOpacity } : {}) }}>
                <MediaLayer
                    kind={media.type === 'audio' ? 'audio' : 'video'}
                    src={media.url}
                    element={mediaEl}
                    trackMuted={!!track.muted}
                    active={active}
                    extendHead={ext?.head || 0}
                    extendTail={ext?.tail || 0}
                    extraFilter={fx?.filter || ''}
                    chromaKey={chromaKey}
                />
            </div>
            {active ? overlays : null}
        </div>
    );
});

/** The transition colour wash. v2: follows the playhead only when the project has transitions. */
function TransitionWash({ windows, time }: { windows: TransitionWindow[]; time?: number }) {
    const live = usePlaybackStore((s) => (time === undefined && windows.length ? s.currentTime : -1));
    const t = time ?? (live >= 0 ? live : usePlaybackStore.getState().currentTime);
    const wash = washAt(windows, t);
    return wash ? <div className="ke-preview__fx" style={{ ...wash, zIndex: 99 }} /> : null;
}

/** Playhead timecode. v2: the only part of the toolbar that follows the playhead. */
function Timecode({ fps, time }: { fps: number; time?: number }) {
    const live = usePlaybackStore((s) => (time === undefined ? s.currentTime : -1));
    return <span className="ke-mono">{formatTimecode(time ?? live, fps)}</span>;
}

export function PreviewPanel() {
    perfRender('PreviewPanel');
    const tracks = useTimelineStore((s) => s.tracks);
    const selected = useTimelineStore((s) => s.selected);
    const selectElement = useTimelineStore((s) => s.selectElement);
    const updateElement = useTimelineStore((s) => s.updateElement);
    const pushHistory = useTimelineStore((s) => s.pushHistory);
    const totalDuration = useTimelineStore((s) => s.getTotalDuration());
    const items = useMediaStore((s) => s.items);
    const isPlaying = usePlaybackStore((s) => s.isPlaying);
    const muted = usePlaybackStore((s) => s.muted);
    const loop = usePlaybackStore((s) => s.loop);
    const { toggle, seek, toggleMute, toggleLoop } = usePlaybackStore.getState();
    // Selectors (not the whole store): an autosave must not re-render the preview.
    const ratio = useProjectStore((s) => s.ratio);
    const setRatio = useProjectStore((s) => s.setRatio);
    const backgroundColor = useProjectStore((s) => s.backgroundColor);
    const fps = useProjectStore((s) => s.fps);
    const canvas = getCanvasSize(ratio);

    const windows = useMemo(() => transitionWindows(tracks.find((t) => t.isMain)), [tracks]);
    /** Seconds each main clip extends before its start / after its end for transitions. */
    const extend = useMemo(() => {
        const map: Extend = new Map();
        for (const w of windows) {
            map.set(w.incomingId, { head: w.duration / 2, tail: map.get(w.incomingId)?.tail || 0 });
            map.set(w.outgoingId, { head: map.get(w.outgoingId)?.head || 0, tail: w.duration / 2 });
        }
        return map;
    }, [windows]);

    // Legacy: re-render on every playback frame. v2: only when the layer list changes (cuts).
    const frameTime = usePlaybackStore((s) => (previewV2 ? 0 : s.currentTime));
    const layerKey = usePlaybackStore((s) => (previewV2 ? layersKey(tracks, s.currentTime, extend) : ''));
    const currentTime = previewV2 ? usePlaybackStore.getState().currentTime : frameTime;
    const layerTime = previewV2 ? undefined : currentTime;

    const containerRef = useRef<HTMLDivElement>(null);
    const [box, setBox] = useState({ width: 0, height: 0 });
    const [fullscreen, setFullscreen] = useState(false);
    const [safeGuides, setSafeGuides] = useState(false);
    const [exact, setExact] = useState<{ url: string; start: number; end: number } | null>(null);
    const [drag, setDragState] = useState<TextDrag | null>(null);
    const dragRef = useRef<TextDrag | null>(null);
    const setDrag = (next: TextDrag | null) => {
        dragRef.current = next;
        setDragState(next);
    };

    // Fit the canvas into the stage's content box while keeping its aspect ratio.
    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return undefined;
        const measure = () => {
            const style = getComputedStyle(el);
            const width = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            const height = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
            const scale = Math.max(0, Math.min(width / canvas.width, height / canvas.height));
            setBox({ width: Math.floor(canvas.width * scale), height: Math.floor(canvas.height * scale) });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [canvas.width, canvas.height, fullscreen]);

    const scale = box.width / canvas.width || 0;

    // Bottom track first so higher tracks paint on top.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const layers = useMemo(() => layersAt(tracks, currentTime, extend), [tracks, currentTime, extend, layerKey]);

    const dragging = drag !== null;
    useEffect(() => {
        if (!dragging) return undefined;
        const onMove = (e: PointerEvent) => {
            const d = dragRef.current;
            if (d) setDrag({ ...d, dx: (e.clientX - d.startX) / scale, dy: (e.clientY - d.startY) / scale });
        };
        const onUp = () => {
            const d = dragRef.current;
            setDrag(null);
            if (d && (Math.abs(d.dx) > 1 || Math.abs(d.dy) > 1)) {
                pushHistory();
                const el = useTimelineStore.getState().findElement(d.id)?.element;
                const kfs = el?.keyframes;
                if (el && (kfs?.x?.length || kfs?.y?.length)) {
                    // Animated position: the drop becomes a keyframe at the playhead.
                    const local = Math.max(0, usePlaybackStore.getState().currentTime - el.startTime);
                    const fpsNow = useProjectStore.getState().fps;
                    const next = { ...kfs };
                    if (kfs.x?.length) next.x = setKeyframe(kfs.x, local, Math.round(d.x + d.dx), undefined, fpsNow);
                    if (kfs.y?.length) next.y = setKeyframe(kfs.y, local, Math.round(d.y + d.dy), undefined, fpsNow);
                    updateElement(d.trackId, d.id, { keyframes: next, ...(!kfs.x?.length ? { x: Math.round(d.x + d.dx) } : {}), ...(!kfs.y?.length ? { y: Math.round(d.y + d.dy) } : {}) }, false);
                } else {
                    updateElement(d.trackId, d.id, { x: Math.round(d.x + d.dx), y: Math.round(d.y + d.dy) }, false);
                }
            }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
    }, [dragging, scale, pushHistory, updateElement]);

    // Stable handler, so memoised text layers don't re-render on every preview render.
    const onTextPointerDown = useMemo(
        () => (trackId: string, el: TextElement, x: number, y: number, e: React.PointerEvent) => {
            e.stopPropagation();
            useTimelineStore.getState().selectElement(trackId, el.id);
            setDrag({ trackId, id: el.id, startX: e.clientX, startY: e.clientY, x, y, dx: 0, dy: 0 });
        },
        []
    );

    // ── Overlay (picture-in-picture) drag: move the box, or resize it from its corner ──
    type OverlayDrag = { trackId: string; id: string; mode: 'move' | 'resize'; startX: number; startY: number; box: { left: number; top: number; width: number; height: number }; media: { width?: number; height?: number } };
    const overlayDragRef = useRef<OverlayDrag | null>(null);
    const [overlayDragging, setOverlayDragging] = useState(false);
    useEffect(() => {
        if (!overlayDragging) return undefined;
        const onMove = (e: PointerEvent) => {
            const d = overlayDragRef.current;
            // Button released where we never saw the pointerup (outside the window): end the drag.
            if (!e.buttons) return onUp();
            if (!d || !scale) return;
            const dx = (e.clientX - d.startX) / scale;
            const dy = (e.clientY - d.startY) / scale;
            const aspect = d.box.height / d.box.width;
            let box = d.box;
            if (d.mode === 'move') box = snapBox({ ...d.box, left: d.box.left + dx, top: d.box.top + dy }, canvas, 8 / scale);
            else {
                const width = Math.max(canvas.width * 0.08, d.box.width + dx);
                box = { ...d.box, width, height: width * aspect };
            }
            const el = useTimelineStore.getState().findElement(d.id)?.element as MediaElement | undefined;
            if (!el) return;
            updateElement(d.trackId, d.id, { transform: { ...getTransform(el), ...transformForBox(d.media, canvas, box) } }, false);
        };
        const onUp = () => {
            overlayDragRef.current = null;
            setOverlayDragging(false);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
    }, [overlayDragging, scale, canvas, updateElement]);

    /** A handle over each visible overlay: click selects, drag moves, the corner resizes. */
    const renderOverlayHandle = (trackId: string, el: MediaElement, media: { width?: number; height?: number }, z: number) => {
        if (el.keyframes && Object.values(el.keyframes).some((k) => Array.isArray(k) && k.length)) return null; // animated: edit in Keyframes
        const box = overlayBox(media, canvas, getTransform(el));
        const isSelected = selected.some((s) => s.elementId === el.id);
        const start = (mode: OverlayDrag['mode']) => (e: React.PointerEvent) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            selectElement(trackId, el.id);
            pushHistory();
            overlayDragRef.current = { trackId, id: el.id, mode, startX: e.clientX, startY: e.clientY, box, media };
            setOverlayDragging(true);
        };
        return (
            <div
                key={`handle-${el.id}`}
                className={`ke-overlay-handle ${isSelected ? 'is-selected' : ''}`}
                style={{ left: `${(box.left / canvas.width) * 100}%`, top: `${(box.top / canvas.height) * 100}%`, width: `${(box.width / canvas.width) * 100}%`, height: `${(box.height / canvas.height) * 100}%`, zIndex: 100 + z }}
                onPointerDown={start('move')}
                title="Drag to move · corner to resize"
            >
                {isSelected ? <span className="ke-overlay-handle__corner" onPointerDown={start('resize')} aria-label="Resize overlay" /> : null}
            </div>
        );
    };

    const empty = !tracks.some((t) => t.elements.length);
    const step = (dir: number) => seek(usePlaybackStore.getState().currentTime + dir / fps);

    return (
        <div className={`ke-panel ke-preview ${fullscreen ? 'is-fullscreen' : ''}`}>
            <div className="ke-preview__stage" ref={containerRef}>
                <div
                    className="ke-preview__canvas"
                    style={{ width: box.width, height: box.height, background: backgroundColor }}
                    onPointerDown={() => useTimelineStore.getState().clearSelection()}
                >
                    {safeGuides ? <div className="ke-safe-guides"><span>Text safe area · guide</span></div> : null}
                    {empty ? (
                        <div className="ke-preview__empty">
                            <p>Drop media on the timeline to start</p>
                        </div>
                    ) : null}
                    {layers.map(({ track, element, z, active }) => (
                        <PreviewLayer
                            key={element.id}
                            track={track}
                            element={element}
                            z={z}
                            active={active}
                            time={layerTime}
                            media={element.type === 'media' ? items.find((i) => i.id === (element as MediaElement).mediaId) : undefined}
                            scale={scale}
                            canvasWidth={canvas.width}
                            canvasHeight={canvas.height}
                            windows={windows}
                            ext={extend.get(element.id)}
                            isSelected={selected.some((s) => s.elementId === element.id)}
                            drag={drag?.id === element.id ? drag : null}
                            onTextPointerDown={onTextPointerDown}
                        />
                    ))}
                    {layers.map(({ track, element, z, active }) => {
                        if (!active || track.isMain || element.type !== 'media') return null;
                        const media = items.find((i) => i.id === (element as MediaElement).mediaId);
                        return media && media.type !== 'audio' ? renderOverlayHandle(track.id, element as MediaElement, media, z) : null;
                    })}
                    {(() => {
                        // A video the browser can't decode (camera formats such as ProRes) plays sound
                        // but no picture: say so instead of showing a black frame.
                        const unplayable = layers.find(({ element, active }) => active && element.type === 'media' && items.find((i) => i.id === (element as MediaElement).mediaId && i.type === 'video' && !i.width));
                        if (!unplayable) return null;
                        const mediaId = (unplayable.element as MediaElement).mediaId;
                        return <UnplayableNotice mediaId={mediaId} />;
                    })()}
                    <TransitionWash windows={windows} time={layerTime} />
                    <LyricOverlay scale={scale} />
                    {exact ? (
                        <ExactPreviewOverlay
                            result={exact}
                            onClose={() => {
                                URL.revokeObjectURL(exact.url);
                                setExact(null);
                            }}
                        />
                    ) : null}
                </div>
                <GuideTrackPlayer />
            </div>

            <div className="ke-preview__toolbar">
                <div className="ke-preview__time">
                    <Timecode fps={fps} time={layerTime} />
                    <span className="ke-muted"> / </span>
                    <span className="ke-mono ke-muted">{formatTimecode(totalDuration, fps)}</span>
                </div>
                <div className="ke-preview__transport">
                    <button className="ke-icon-btn" title="Back 1 frame (←)" onClick={() => step(-1)}>
                        <SkipBack size={16} />
                    </button>
                    <button className="ke-play-btn" title="Play/Pause (Space)" onClick={toggle} disabled={empty}>
                        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                    </button>
                    <button className="ke-icon-btn" title="Forward 1 frame (→)" onClick={() => step(1)}>
                        <SkipForward size={16} />
                    </button>
                </div>
                <div className="ke-preview__right">
                    <ExactPreviewButton
                        onResult={(r) =>
                            setExact((old) => {
                                if (old) URL.revokeObjectURL(old.url);
                                return r;
                            })
                        }
                    />
                    <button className={`ke-chip ${safeGuides ? 'is-active' : ''}`} aria-pressed={safeGuides} title="Show suggested text-safe margins" onClick={() => setSafeGuides((value) => !value)}>Safe area</button>
                    <button className={`ke-icon-btn ${loop ? 'is-active' : ''}`} title="Loop" onClick={toggleLoop}>
                        <Repeat size={15} />
                    </button>
                    <button className="ke-icon-btn" title={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>
                        {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                    </button>
                    <select className="ke-select ke-select--sm" value={ratio} onChange={(e) => setRatio(e.target.value as AspectRatio)} title="Canvas size">
                        <option value="9:16">9:16</option>
                        <option value="1:1">1:1</option>
                        <option value="16:9">16:9</option>
                    </select>
                    <button className="ke-icon-btn" title={fullscreen ? 'Exit full view' : 'Full view'} onClick={() => setFullscreen((f) => !f)}>
                        {fullscreen ? <Minimize size={15} /> : <Expand size={15} />}
                    </button>
                </div>
            </div>
        </div>
    );
}
