import { CAPTION_TEMPLATES } from './lib/caption-templates';
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
    'teal-orange': 'saturate(1.2) contrast(1.08) sepia(0.12) hue-rotate(-8deg)',
    golden: 'sepia(0.35) saturate(1.25) brightness(1.04)',
    moody: 'contrast(1.15) brightness(0.92) saturate(0.78) hue-rotate(6deg)',
    vintage: 'sepia(0.4) contrast(0.9) brightness(1.05) saturate(0.85)',
    'cross-process': 'contrast(1.2) saturate(1.35) hue-rotate(-12deg) sepia(0.15)',
    'bleach-bypass': 'saturate(0.45) contrast(1.35) brightness(0.98)',
    matte: 'contrast(0.84) brightness(1.06) saturate(0.9)',
    'film-warm': 'sepia(0.22) saturate(1.1) contrast(1.05)',
    'film-cool': 'hue-rotate(10deg) saturate(1.05) contrast(1.04) brightness(1.02)',
    sepia: 'sepia(1)',
    cyberpunk: 'saturate(1.5) contrast(1.15) hue-rotate(-25deg)',
    pastel: 'saturate(0.75) brightness(1.08) contrast(0.88)',
};

/** Display names for looks. */
export const LOOK_LABELS: Record<VideoFilter, string> = {
    none: 'None',
    vivid: 'Vivid',
    fade: 'Faded',
    noir: 'Noir',
    warm: 'Warm',
    cool: 'Cool',
    drama: 'Drama',
    neon: 'Neon',
    'teal-orange': 'Teal & orange',
    golden: 'Golden hour',
    moody: 'Moody',
    vintage: 'Vintage',
    'cross-process': 'Cross process',
    'bleach-bypass': 'Bleach bypass',
    matte: 'Matte',
    'film-warm': 'Warm film',
    'film-cool': 'Cool film',
    sepia: 'Sepia',
    cyberpunk: 'Cyberpunk',
    pastel: 'Pastel',
};

export const FILTERS = Object.keys(FILTER_PREVIEW_CSS) as VideoFilter[];

export const FONT_FAMILIES = ['Inter', 'Poppins', 'Anton', 'Bebas Neue', 'Arial', 'Impact', 'Georgia', 'Courier New'];

/** Caption fonts bundled with the app (public/fonts/captions) and burned in by the renderer. */
const BUNDLED_FONTS: Record<string, string> = {
    Anton: "'Kengan Anton', Impact, sans-serif",
    'Bebas Neue': "'Kengan Bebas', Impact, sans-serif",
    Poppins: "'Kengan Poppins', Arial, sans-serif",
    Impact: "Impact, 'Kengan Anton', sans-serif",
};

/** CSS font-family for the preview. */
export const previewFont = (family: string) => BUNDLED_FONTS[family] || family;

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

/** Caption styles by template id (lib/caption-templates.ts holds the full templates). */
export const CAPTION_STYLES: Record<string, Partial<TextElement>> = Object.fromEntries(CAPTION_TEMPLATES.map((t) => [t.id, t.style]));

export const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];
