import type { AspectRatio, CanvasSize, TextElement, TrackType, VideoFilter } from './types';

export const TRACK_HEIGHTS: Record<TrackType, number> = {
    media: 60,
    text: 28,
    audio: 44,
};

export const TRACK_GAP = 4;

export const TIMELINE = {
    PIXELS_PER_SECOND: 50,
    MIN_ZOOM: 0.25,
    MAX_ZOOM: 6,
    ELEMENT_MIN_DURATION: 0.1,
    DEFAULT_IMAGE_DURATION: 5,
    DEFAULT_TEXT_DURATION: 3,
    SNAP_THRESHOLD_PX: 10,
    MIN_VISIBLE_SECONDS: 30,
    TRACK_LABEL_WIDTH: 132,
} as const;

export const DEFAULT_FPS = 30;

export const CANVAS_SIZES: Record<AspectRatio, CanvasSize> = {
    '9:16': { width: 1080, height: 1920 },
    '1:1': { width: 1080, height: 1080 },
    '16:9': { width: 1920, height: 1080 },
};

/** Maps an aspect ratio to the server renderer's export preset. */
export const EXPORT_FORMATS: Record<AspectRatio, string> = {
    '9:16': 'tiktok',
    '1:1': 'instagram',
    '16:9': 'youtube',
};

/** CSS approximations of the server FFmpeg filter presets, for preview only. */
export const FILTER_PREVIEW_CSS: Record<VideoFilter, string> = {
    none: 'none',
    vivid: 'saturate(1.5) contrast(1.1) brightness(1.05)',
    fade: 'saturate(0.6) brightness(1.1) contrast(0.9)',
    noir: 'grayscale(1) contrast(1.3) brightness(0.95)',
    warm: 'sepia(0.25) saturate(1.15)',
    cool: 'hue-rotate(15deg) saturate(1.05) brightness(1.02)',
    drama: 'contrast(1.4) brightness(0.92) saturate(1.2)',
    neon: 'saturate(2) contrast(1.3) brightness(1.1) hue-rotate(10deg)',
};

export const FILTERS: VideoFilter[] = ['none', 'vivid', 'fade', 'noir', 'warm', 'cool', 'drama', 'neon'];

export const FONT_FAMILIES = ['Inter', 'Arial', 'Georgia', 'Impact', 'Courier New'];

export const DEFAULT_TEXT: Omit<TextElement, 'id' | 'startTime'> = {
    type: 'text',
    name: 'Text',
    content: 'Your text',
    duration: TIMELINE.DEFAULT_TEXT_DURATION,
    trimStart: 0,
    trimEnd: 0,
    fontSize: 72,
    fontFamily: 'Inter',
    color: '#ffffff',
    backgroundColor: 'transparent',
    textAlign: 'center',
    fontWeight: 'bold',
    fontStyle: 'normal',
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 1,
};

/** Caption presets surfaced in the Captions tab. */
export const CAPTION_STYLES: Record<string, Partial<TextElement>> = {
    bold: { fontSize: 76, fontWeight: 'bold', color: '#ffffff', backgroundColor: 'transparent', fontFamily: 'Impact' },
    minimal: { fontSize: 56, fontWeight: 'normal', color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.55)', fontFamily: 'Inter' },
    karaoke: { fontSize: 72, fontWeight: 'bold', color: '#facc15', backgroundColor: 'transparent', fontFamily: 'Arial' },
    neon: { fontSize: 72, fontWeight: 'bold', color: '#22d3ee', backgroundColor: 'rgba(0,0,0,0.35)', fontFamily: 'Arial' },
    impact: { fontSize: 88, fontWeight: 'bold', color: '#ffffff', backgroundColor: 'transparent', fontFamily: 'Impact' },
    highlighter: { fontSize: 60, fontWeight: 'bold', color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.65)', fontFamily: 'Arial' },
    accent: { fontSize: 64, fontWeight: 'bold', color: '#ffffff', backgroundColor: '#e04a18', fontFamily: 'Arial' },
};

export const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];
