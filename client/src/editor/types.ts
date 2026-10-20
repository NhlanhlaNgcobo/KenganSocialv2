/**
 * Editor domain model.
 * Track/element model adapted from OpenCut (MIT, https://github.com/OpenCut-app/OpenCut).
 */

export type MediaType = 'video' | 'image' | 'audio';

export interface MediaItem {
    id: string;
    name: string;
    type: MediaType;
    file: File | Blob;
    url: string;
    thumbnailUrl?: string;
    duration: number;
    width?: number;
    height?: number;
    /** Server-side upload id used by the export renderer. */
    uploadId?: string | null;
    uploadStatus?: 'idle' | 'uploading' | 'uploaded' | 'failed';
}

export type TrackType = 'media' | 'text' | 'audio';

interface BaseTimelineElement {
    id: string;
    name: string;
    /** Full source duration in seconds (before trimming). */
    duration: number;
    /** Position on the timeline in seconds. */
    startTime: number;
    /** Seconds trimmed from the head of the source. */
    trimStart: number;
    /** Seconds trimmed from the tail of the source. */
    trimEnd: number;
    hidden?: boolean;
}

export interface MediaElement extends BaseTimelineElement {
    type: 'media';
    mediaId: string;
    muted?: boolean;
    volume: number;
    speed: number;
    filter: VideoFilter;
    /** Colour adjustment on top of the filter (Adjust panel, AI Edit colour match). */
    grade?: ColorGrade;
    transform?: ClipTransform;
    /** Effects layered on the picture (main track), in order. */
    effects?: ClipEffect[];
    /** Transition from the previous main-track clip into this one, centred on the cut. */
    transitionIn?: ClipTransition | null;
    /** Lumetri-style colour (lib/color-pipeline.js), compiled to a 3D LUT for preview and export. */
    color?: ColorSettings | null;
}

export interface CurvePoints {
    master: [number, number][];
    red: [number, number][];
    green: [number, number][];
    blue: [number, number][];
}

export interface ColorWheel {
    x: number;
    y: number;
    luma: number;
}

export interface ColorSettings {
    basic: { temperature: number; tint: number; exposure: number; contrast: number; highlights: number; shadows: number; whites: number; blacks: number; saturation: number };
    creative: {
        look: string | null;
        intensity: number;
        fadedFilm: number;
        vibrance: number;
        saturation: number;
        shadowTint: { hue: number; amount: number };
        highlightTint: { hue: number; amount: number };
        tintBalance: number;
    };
    curves: CurvePoints;
    wheels: { shadows: ColorWheel; midtones: ColorWheel; highlights: ColorWheel };
    hsl: Partial<Record<string, { hue: number; saturation: number; luminance: number }>>;
    vignette: { amount: number; midpoint: number; roundness: number; feather: number };
}

export type EffectType = 'vignette' | 'grain' | 'blur' | 'glow' | 'rgbsplit' | 'glitch' | 'vhs' | 'pixelate' | 'shake' | 'echo' | 'sketch'
    | 'ks-impact-shake' | 'ks-halation' | 'ks-chromatic-echo' | 'ks-frame-cadence' | 'ks-digicam'
    | 'ks-spotlight' | 'ks-split-diopter' | 'ks-prism-edge' | 'ks-exposure-hit' | 'ks-motion-smear';

export interface ClipEffect {
    type: EffectType;
    /** False bypasses an effect without losing its settings or stack position. */
    enabled?: boolean;
    /** 0..1 */
    amount: number;
}

export type TransitionType =
    | 'ks-whip-carry' | 'ks-crash-reveal' | 'ks-spin-catch' | 'ks-lens-cover' | 'ks-focus-snap'
    | 'ks-tear-through' | 'ks-shutter-roll' | 'ks-elastic-pull' | 'ks-prism-pass' | 'ks-luma-bloom'
    | 'fade'
    | 'dissolve'
    | 'fadeblack'
    | 'fadewhite'
    | 'wipeleft'
    | 'wiperight'
    | 'wipeup'
    | 'wipedown'
    | 'slideleft'
    | 'slideright'
    | 'slideup'
    | 'slidedown'
    | 'smoothleft'
    | 'circleopen'
    | 'circleclose'
    | 'zoomin'
    | 'hblur'
    | 'pixelize'
    | 'radial'
    | 'squeezeh'
    // Kengan originals (custom xfade expressions)
    | 'blinds'
    | 'vblinds'
    | 'checker'
    | 'diamond'
    | 'barndoor'
    | 'boxiris'
    | 'diagsoft'
    | 'pixeldissolve'
    | 'spiral'
    | 'heart'
    | 'glitchbands'
    | 'flash'
    | 'filmburn'
    | 'wavewipe'
    | 'pixelrain';

export interface ClipTransition {
    type: TransitionType;
    /** Seconds, 0.2..2 */
    duration: number;
}

/** brightness -0.3..0.3 (added), contrast and saturation ×, temperature -1 (cool)..1 (warm). */
export interface ColorGrade {
    brightness: number;
    contrast: number;
    saturation: number;
    temperature: number;
    /** -1..1 */
    vibrance?: number;
    /** -1 (green)..1 (magenta) */
    tint?: number;
    /** -1..1 */
    highlights?: number;
    /** -1..1 */
    shadows?: number;
    /** 0..1: lifted, matte blacks */
    fade?: number;
}

/**
 * Framing of a clip on the canvas, applied after it is fitted to the canvas.
 * scale 1 = fitted size; x/y are canvas pixels from centre; rotation in degrees.
 */
export interface ClipTransform {
    scale: number;
    x: number;
    y: number;
    rotation: number;
    flipH: boolean;
    flipV: boolean;
    /** Ken Burns style zoom across the clip (main track only). */
    animation: 'none' | 'zoom-in' | 'zoom-out' | 'push-in' | 'pull-out' | 'pan-left' | 'pan-right' | 'tilt-up' | 'tilt-down' | 'diagonal-rise' | 'diagonal-fall' | 'detail-approach' | 'detail-release';
    /** Extra zoom reached by the end (zoom-in) or start (zoom-out), e.g. 0.2 = +20%. */
    animationAmount: number;
}

export interface TextElement extends BaseTimelineElement {
    type: 'text';
    content: string;
    fontSize: number;
    fontFamily: string;
    color: string;
    backgroundColor: string;
    textAlign: 'left' | 'center' | 'right';
    fontWeight: 'normal' | 'bold';
    fontStyle: 'normal' | 'italic';
    /** Offset from canvas centre, in canvas pixels. */
    x: number;
    y: number;
    rotation: number;
    opacity: number;
    /** Outline around the letters (captions); width in canvas pixels, 0 = none. */
    strokeColor?: string;
    strokeWidth?: number;
    /** Entrance animation. */
    animation?: TextAnimation;
    /** Set on captions generated from a transcript. */
    isCaption?: boolean;
    /** Caption text as spoken (before a template's upper-casing), so styles can be switched back. */
    rawContent?: string;
    /** Relative to the untrimmed caption start; retained when changing its style. */
    captionWords?: { text: string; start: number; end: number }[];
    captionMotion?: string;
    accentColor?: string;
}

export type TextAnimation = 'none' | 'fade' | 'pop';

export type TimelineElement = MediaElement | TextElement;
export type CreateTimelineElement = Omit<MediaElement, 'id'> | Omit<TextElement, 'id'>;

export interface TimelineTrack {
    id: string;
    name: string;
    type: TrackType;
    elements: TimelineElement[];
    muted?: boolean;
    isMain?: boolean;
}

export type VideoFilter =
    | 'none'
    | 'vivid'
    | 'fade'
    | 'noir'
    | 'warm'
    | 'cool'
    | 'drama'
    | 'neon'
    | 'teal-orange'
    | 'golden'
    | 'moody'
    | 'vintage'
    | 'cross-process'
    | 'bleach-bypass'
    | 'matte'
    | 'film-warm'
    | 'film-cool'
    | 'sepia'
    | 'cyberpunk'
    | 'pastel';

export type AspectRatio = '9:16' | '1:1' | '16:9';

export interface CanvasSize {
    width: number;
    height: number;
}

export interface SelectedElement {
    trackId: string;
    elementId: string;
}

/** Payload carried by drag-and-drop from the media panel onto the timeline. */
export type DragData =
    | { kind: 'media'; mediaId: string }
    | { kind: 'text'; content: string; style?: Partial<TextElement> };

export const DRAG_MIME = 'application/x-kengan-editor';
