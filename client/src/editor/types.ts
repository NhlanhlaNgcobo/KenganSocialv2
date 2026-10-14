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
    transform?: ClipTransform;
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
    animation: 'none' | 'zoom-in' | 'zoom-out';
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
    /** Set on captions generated from a transcript. */
    isCaption?: boolean;
}

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

export type VideoFilter = 'none' | 'vivid' | 'fade' | 'noir' | 'warm' | 'cool' | 'drama' | 'neon';

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
