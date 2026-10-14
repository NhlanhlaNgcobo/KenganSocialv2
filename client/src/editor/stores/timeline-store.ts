/**
 * Timeline state: tracks, elements, selection and undo history.
 * Operations adapted from OpenCut's timeline-store (MIT).
 */
import { create } from 'zustand';
import { CAPTION_STYLES, DEFAULT_TEXT, TIMELINE } from '../constants';
import { generateId, getElementEnd, getElementLength } from '../lib/time';
import type {
    CreateTimelineElement,
    MediaElement,
    MediaItem,
    SelectedElement,
    TextElement,
    TimelineElement,
    TimelineTrack,
    TrackType,
} from '../types';

const HISTORY_LIMIT = 100;
export const LYRIC_TRACK_NAME = 'Lyrics';

const TRACK_NAMES: Record<TrackType, string> = {
    media: 'Video',
    text: 'Text',
    audio: 'Audio',
};

function createTrack(type: TrackType, isMain = false): TimelineTrack {
    return {
        id: generateId('track'),
        name: isMain ? 'Main' : TRACK_NAMES[type],
        type,
        elements: [],
        muted: false,
        isMain,
    };
}

/** Text tracks on top, then overlay media, then main, then audio. */
export function sortTracks(tracks: TimelineTrack[]): TimelineTrack[] {
    const rank = (t: TimelineTrack) => (t.type === 'text' ? 0 : t.type === 'audio' ? 3 : t.isMain ? 2 : 1);
    return [...tracks].sort((a, b) => rank(a) - rank(b));
}

function ensureMainTrack(tracks: TimelineTrack[]): TimelineTrack[] {
    return tracks.some((t) => t.isMain) ? tracks : [...tracks, createTrack('media', true)];
}

export function canElementGoOnTrack(elementType: TimelineElement['type'], mediaType: MediaItem['type'] | null, trackType: TrackType) {
    if (elementType === 'text') return trackType === 'text';
    if (mediaType === 'audio') return trackType === 'audio';
    return trackType === 'media';
}

function overlaps(track: TimelineTrack, start: number, length: number, excludeId?: string) {
    const end = start + length;
    return track.elements.some((el) => {
        if (el.id === excludeId) return false;
        const elStart = el.startTime;
        const elEnd = getElementEnd(el);
        return start < elEnd - 1e-3 && end > elStart + 1e-3;
    });
}

/** Groups transcript words into short caption phrases. */
function groupWords(words: { text: string; start: number; end: number }[], maxWords = 3, maxGap = 0.6) {
    const phrases: { text: string; start: number; end: number }[] = [];
    let current: { text: string[]; start: number; end: number } | null = null;
    for (const word of words) {
        const text = String(word.text || '').trim();
        if (!text) continue;
        const startsNew =
            !current || current.text.length >= maxWords || word.start - current.end > maxGap || /[.!?]$/.test(current.text[current.text.length - 1]);
        if (startsNew) {
            if (current) phrases.push({ text: current.text.join(' '), start: current.start, end: current.end });
            current = { text: [text], start: word.start, end: word.end };
        } else if (current) {
            current.text.push(text);
            current.end = word.end;
        }
    }
    if (current) phrases.push({ text: current.text.join(' '), start: current.start, end: current.end });
    return phrases;
}

interface TimelineState {
    tracks: TimelineTrack[];
    selected: SelectedElement[];
    snappingEnabled: boolean;
    rippleEnabled: boolean;
    history: TimelineTrack[][];
    future: TimelineTrack[][];

    // history
    pushHistory: () => void;
    undo: () => void;
    redo: () => void;

    // persistence
    loadTracks: (tracks: TimelineTrack[]) => void;
    clearTimeline: () => void;

    // settings
    toggleSnapping: () => void;
    toggleRipple: () => void;

    // selection
    selectElement: (trackId: string, elementId: string, multi?: boolean) => void;
    clearSelection: () => void;
    getSelectedElements: () => { track: TimelineTrack; element: TimelineElement }[];

    // tracks
    addTrack: (type: TrackType) => string;
    insertTrackAt: (type: TrackType, index: number) => string;
    removeTrack: (trackId: string) => void;
    toggleTrackMute: (trackId: string) => void;

    // elements
    addElementToTrack: (trackId: string, element: CreateTimelineElement) => string | null;
    removeElement: (trackId: string, elementId: string) => void;
    removeSelected: () => void;
    updateElement: (trackId: string, elementId: string, partial: Partial<MediaElement> | Partial<TextElement>, recordHistory?: boolean) => void;
    moveElement: (fromTrackId: string, toTrackId: string, elementId: string, newStartTime: number) => boolean;
    updateElementTrim: (trackId: string, elementId: string, trimStart: number, trimEnd: number, startTime?: number) => void;
    splitElement: (trackId: string, elementId: string, time: number) => string | null;
    splitAtPlayhead: (time: number) => number;
    duplicateSelected: () => void;
    toggleElementHidden: (trackId: string, elementId: string) => void;
    toggleElementMuted: (trackId: string, elementId: string) => void;

    // insertion helpers
    addMediaAtTime: (item: MediaItem, time: number, trackId?: string) => boolean;
    addTextAtTime: (time: number, partial?: Partial<TextElement>, trackId?: string) => boolean;
    addCaptions: (words: { text: string; start: number; end: number }[], style: keyof typeof CAPTION_STYLES) => number;
    /** Puts lyric lines on a single "Lyrics" text track, replacing any previous one. Returns the count. */
    replaceLyricTrack: (lines: (Partial<TextElement> & { content: string; startTime: number; duration: number })[]) => number;
    replaceMainTrackSegments: (mediaId: string, segments: { start: number; end: number; label?: string }[], mediaDuration: number) => void;
    removeElementsForMedia: (mediaId: string) => void;
    replaceMedia: (oldMediaId: string, newMediaId: string, newDuration: number, newName: string) => number;

    // derived
    getTotalDuration: () => number;
    findElement: (elementId: string) => { track: TimelineTrack; element: TimelineElement } | null;
    getSnapPoints: (excludeElementId?: string) => number[];
}

export const useTimelineStore = create<TimelineState>((set, get) => {
    const writeTracks = (tracks: TimelineTrack[]) => set({ tracks: sortTracks(ensureMainTrack(tracks)) });

    const mapElement = (trackId: string, elementId: string, fn: (el: TimelineElement) => TimelineElement) =>
        get().tracks.map((track) =>
            track.id === trackId ? { ...track, elements: track.elements.map((el) => (el.id === elementId ? fn(el) : el)) } : track
        );

    /** Shifts later elements left after a removal when ripple editing is on. */
    const rippleClose = (tracks: TimelineTrack[], trackId: string, gapStart: number, gapLength: number) =>
        tracks.map((track) =>
            track.id !== trackId
                ? track
                : {
                      ...track,
                      elements: track.elements.map((el) =>
                          el.startTime >= gapStart - 1e-3 ? { ...el, startTime: Math.max(0, el.startTime - gapLength) } : el
                      ),
                  }
        );

    return {
        tracks: [createTrack('media', true)],
        selected: [],
        snappingEnabled: true,
        rippleEnabled: false,
        history: [],
        future: [],

        pushHistory: () =>
            set((state) => ({
                history: [...state.history, state.tracks].slice(-HISTORY_LIMIT),
                future: [],
            })),
        undo: () =>
            set((state) => {
                if (!state.history.length) return state;
                const previous = state.history[state.history.length - 1];
                return {
                    tracks: previous,
                    history: state.history.slice(0, -1),
                    future: [state.tracks, ...state.future],
                    selected: [],
                };
            }),
        redo: () =>
            set((state) => {
                if (!state.future.length) return state;
                const [next, ...rest] = state.future;
                return {
                    tracks: next,
                    history: [...state.history, state.tracks],
                    future: rest,
                    selected: [],
                };
            }),

        loadTracks: (tracks) => set({ tracks: sortTracks(ensureMainTrack(tracks)), history: [], future: [], selected: [] }),
        clearTimeline: () => set({ tracks: [createTrack('media', true)], history: [], future: [], selected: [] }),

        toggleSnapping: () => set((s) => ({ snappingEnabled: !s.snappingEnabled })),
        toggleRipple: () => set((s) => ({ rippleEnabled: !s.rippleEnabled })),

        selectElement: (trackId, elementId, multi = false) =>
            set((state) => {
                const exists = state.selected.some((s) => s.elementId === elementId);
                if (multi) {
                    return {
                        selected: exists
                            ? state.selected.filter((s) => s.elementId !== elementId)
                            : [...state.selected, { trackId, elementId }],
                    };
                }
                return { selected: [{ trackId, elementId }] };
            }),
        clearSelection: () => set({ selected: [] }),
        getSelectedElements: () => {
            const { tracks, selected } = get();
            return selected
                .map(({ trackId, elementId }) => {
                    const track = tracks.find((t) => t.id === trackId);
                    const element = track?.elements.find((e) => e.id === elementId);
                    return track && element ? { track, element } : null;
                })
                .filter(Boolean) as { track: TimelineTrack; element: TimelineElement }[];
        },

        addTrack: (type) => {
            const track = createTrack(type);
            writeTracks([...get().tracks, track]);
            return track.id;
        },
        insertTrackAt: (type, index) => {
            const track = createTrack(type);
            const tracks = [...get().tracks];
            tracks.splice(index, 0, track);
            writeTracks(tracks);
            return track.id;
        },
        removeTrack: (trackId) => {
            const track = get().tracks.find((t) => t.id === trackId);
            if (!track || track.isMain) return;
            get().pushHistory();
            writeTracks(get().tracks.filter((t) => t.id !== trackId));
            set((s) => ({ selected: s.selected.filter((sel) => sel.trackId !== trackId) }));
        },
        toggleTrackMute: (trackId) => {
            get().pushHistory();
            writeTracks(get().tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)));
        },

        addElementToTrack: (trackId, element) => {
            const track = get().tracks.find((t) => t.id === trackId);
            if (!track) return null;
            const id = generateId(element.type === 'text' ? 'text' : 'clip');
            const newElement = { ...element, id } as TimelineElement;
            if (overlaps(track, newElement.startTime, getElementLength(newElement))) return null;
            get().pushHistory();
            writeTracks(get().tracks.map((t) => (t.id === trackId ? { ...t, elements: [...t.elements, newElement] } : t)));
            set({ selected: [{ trackId, elementId: id }] });
            return id;
        },

        removeElement: (trackId, elementId) => {
            const found = get().findElement(elementId);
            if (!found) return;
            get().pushHistory();
            let tracks = get().tracks.map((t) =>
                t.id === trackId ? { ...t, elements: t.elements.filter((e) => e.id !== elementId) } : t
            );
            if (get().rippleEnabled) {
                tracks = rippleClose(tracks, trackId, getElementEnd(found.element), getElementLength(found.element));
            }
            // Drop empty non-main tracks, as OpenCut does.
            tracks = tracks.filter((t) => t.isMain || t.elements.length > 0);
            writeTracks(tracks);
            set((s) => ({ selected: s.selected.filter((sel) => sel.elementId !== elementId) }));
        },
        removeSelected: () => {
            const selected = get().getSelectedElements();
            if (!selected.length) return;
            get().pushHistory();
            const ids = new Set(selected.map((s) => s.element.id));
            let tracks = get().tracks.map((t) => ({ ...t, elements: t.elements.filter((e) => !ids.has(e.id)) }));
            if (get().rippleEnabled) {
                const sorted = [...selected].sort((a, b) => b.element.startTime - a.element.startTime);
                for (const { track, element } of sorted) {
                    tracks = rippleClose(tracks, track.id, getElementEnd(element), getElementLength(element));
                }
            }
            tracks = tracks.filter((t) => t.isMain || t.elements.length > 0);
            writeTracks(tracks);
            set({ selected: [] });
        },

        updateElement: (trackId, elementId, partial, recordHistory = true) => {
            if (recordHistory) get().pushHistory();
            writeTracks(mapElement(trackId, elementId, (el) => ({ ...el, ...partial }) as TimelineElement));
        },

        moveElement: (fromTrackId, toTrackId, elementId, newStartTime) => {
            const found = get().findElement(elementId);
            const toTrack = get().tracks.find((t) => t.id === toTrackId);
            if (!found || !toTrack) return false;
            const { element } = found;
            const startTime = Math.max(0, newStartTime);
            if (toTrack.type !== found.track.type) return false;
            if (overlaps(toTrack, startTime, getElementLength(element), element.id)) return false;

            get().pushHistory();
            const moved = { ...element, startTime } as TimelineElement;
            let tracks = get().tracks.map((t) => {
                if (t.id === fromTrackId && t.id === toTrackId) {
                    return { ...t, elements: t.elements.map((e) => (e.id === elementId ? moved : e)) };
                }
                if (t.id === fromTrackId) return { ...t, elements: t.elements.filter((e) => e.id !== elementId) };
                if (t.id === toTrackId) return { ...t, elements: [...t.elements, moved] };
                return t;
            });
            tracks = tracks.filter((t) => t.isMain || t.elements.length > 0);
            writeTracks(tracks);
            set({ selected: [{ trackId: toTrackId, elementId }] });
            return true;
        },

        updateElementTrim: (trackId, elementId, trimStart, trimEnd, startTime) => {
            writeTracks(
                mapElement(trackId, elementId, (el) => ({
                    ...el,
                    trimStart: Math.max(0, trimStart),
                    trimEnd: Math.max(0, trimEnd),
                    ...(startTime !== undefined ? { startTime: Math.max(0, startTime) } : {}),
                }))
            );
        },

        splitElement: (trackId, elementId, time) => {
            const found = get().findElement(elementId);
            if (!found) return null;
            const { element } = found;
            const end = getElementEnd(element);
            if (time <= element.startTime + 0.01 || time >= end - 0.01) return null;

            get().pushHistory();
            const speed = element.type === 'media' ? element.speed || 1 : 1;
            const sourceLength = element.duration - element.trimStart - element.trimEnd;
            const relative = (time - element.startTime) * speed;
            const rightId = generateId(element.type === 'text' ? 'text' : 'clip');

            writeTracks(
                get().tracks.map((t) =>
                    t.id !== trackId
                        ? t
                        : {
                              ...t,
                              elements: t.elements.flatMap((el) =>
                                  el.id !== elementId
                                      ? [el]
                                      : [
                                            { ...el, trimEnd: el.trimEnd + (sourceLength - relative) },
                                            { ...el, id: rightId, startTime: time, trimStart: el.trimStart + relative },
                                        ]
                              ),
                          }
                )
            );
            return rightId;
        },

        splitAtPlayhead: (time) => {
            const selected = get().getSelectedElements();
            const targets = selected.length
                ? selected
                : get().tracks.flatMap((track) =>
                      track.elements
                          .filter((el) => time > el.startTime && time < getElementEnd(el))
                          .map((element) => ({ track, element }))
                  );
            let count = 0;
            for (const { track, element } of targets) {
                if (get().splitElement(track.id, element.id, time)) count += 1;
            }
            return count;
        },

        duplicateSelected: () => {
            const selected = get().getSelectedElements();
            if (!selected.length) return;
            get().pushHistory();
            let tracks = get().tracks;
            const newSelection: SelectedElement[] = [];
            for (const { track, element } of selected) {
                const copy = { ...element, id: generateId(element.type === 'text' ? 'text' : 'clip'), startTime: getElementEnd(element) } as TimelineElement;
                const current = tracks.find((t) => t.id === track.id)!;
                let targetId = track.id;
                if (overlaps(current, copy.startTime, getElementLength(copy))) {
                    const newTrack = createTrack(track.type);
                    tracks = [...tracks, newTrack];
                    targetId = newTrack.id;
                }
                tracks = tracks.map((t) => (t.id === targetId ? { ...t, elements: [...t.elements, copy] } : t));
                newSelection.push({ trackId: targetId, elementId: copy.id });
            }
            writeTracks(tracks);
            set({ selected: newSelection });
        },

        toggleElementHidden: (trackId, elementId) => {
            get().pushHistory();
            writeTracks(mapElement(trackId, elementId, (el) => ({ ...el, hidden: !el.hidden })));
        },
        toggleElementMuted: (trackId, elementId) => {
            get().pushHistory();
            writeTracks(mapElement(trackId, elementId, (el) => (el.type === 'media' ? { ...el, muted: !el.muted } : el)));
        },

        addMediaAtTime: (item, time, trackId) => {
            const trackType: TrackType = item.type === 'audio' ? 'audio' : 'media';
            const duration = item.type === 'image' ? TIMELINE.DEFAULT_IMAGE_DURATION : item.duration || TIMELINE.DEFAULT_IMAGE_DURATION;
            const startTime = Math.max(0, time);
            const { tracks } = get();

            let targetId: string | null = null;
            const preferred = trackId ? tracks.find((t) => t.id === trackId && t.type === trackType) : undefined;
            if (preferred && !overlaps(preferred, startTime, duration)) targetId = preferred.id;
            if (!targetId) {
                // Main track first so a plain import lands where export expects it.
                const candidates = [...tracks.filter((t) => t.type === trackType)].sort((a, b) => Number(!!b.isMain) - Number(!!a.isMain));
                targetId = candidates.find((t) => !overlaps(t, startTime, duration))?.id ?? null;
            }
            if (!targetId) targetId = get().addTrack(trackType);

            return !!get().addElementToTrack(targetId, {
                type: 'media',
                mediaId: item.id,
                name: item.name,
                duration,
                startTime,
                trimStart: 0,
                trimEnd: 0,
                muted: false,
                volume: 1,
                speed: 1,
                filter: 'none',
            });
        },

        addTextAtTime: (time, partial = {}, trackId) => {
            const element = { ...DEFAULT_TEXT, ...partial, startTime: Math.max(0, time) } as Omit<TextElement, 'id'>;
            const length = element.duration;
            const existing = trackId
                ? get().tracks.find((t) => t.id === trackId && t.type === 'text')
                : get().tracks.find((t) => t.type === 'text' && !overlaps(t, element.startTime, length));
            const target = existing && !overlaps(existing, element.startTime, length) ? existing.id : get().insertTrackAt('text', 0);
            return !!get().addElementToTrack(target, element);
        },

        addCaptions: (words, style) => {
            const phrases = groupWords(words);
            if (!phrases.length) return 0;
            get().pushHistory();
            const preset = CAPTION_STYLES[style] || CAPTION_STYLES.bold;
            const captionTrack: TimelineTrack = {
                ...createTrack('text'),
                name: 'Captions',
                elements: phrases.map((p) => ({
                    ...DEFAULT_TEXT,
                    ...preset,
                    id: generateId('cap'),
                    name: p.text.slice(0, 24),
                    content: p.text,
                    startTime: p.start,
                    duration: Math.max(0.2, p.end - p.start),
                    y: 520,
                    isCaption: true,
                })) as TextElement[],
            };
            // Replace any previous caption track instead of stacking them.
            const tracks = get().tracks.filter((t) => !(t.type === 'text' && t.elements.length > 0 && t.elements.every((e) => e.type === 'text' && e.isCaption)));
            writeTracks([captionTrack, ...tracks]);
            return phrases.length;
        },

        replaceLyricTrack: (lines) => {
            const valid = lines.filter((l) => l.content.trim() && l.duration > 0);
            if (!valid.length) return 0;
            get().pushHistory();
            const lyricTrack: TimelineTrack = {
                ...createTrack('text'),
                name: LYRIC_TRACK_NAME,
                elements: valid.map((line) => ({
                    ...DEFAULT_TEXT,
                    ...line,
                    id: generateId('lyr'),
                    name: line.content.slice(0, 24),
                    duration: Math.max(0.2, line.duration),
                })) as TextElement[],
            };
            writeTracks([lyricTrack, ...get().tracks.filter((t) => !(t.type === 'text' && t.name === LYRIC_TRACK_NAME))]);
            return valid.length;
        },

        replaceMainTrackSegments: (mediaId, segments, mediaDuration) => {
            if (!segments.length) return;
            get().pushHistory();
            let cursor = 0;
            const elements: MediaElement[] = segments
                .filter((s) => s.end > s.start)
                .map((segment, index) => {
                    const el: MediaElement = {
                        id: generateId('clip'),
                        type: 'media',
                        mediaId,
                        name: segment.label || `Keep ${index + 1}`,
                        duration: mediaDuration,
                        startTime: cursor,
                        trimStart: Math.max(0, segment.start),
                        trimEnd: Math.max(0, mediaDuration - segment.end),
                        muted: false,
                        volume: 1,
                        speed: 1,
                        filter: 'none',
                    };
                    cursor += segment.end - segment.start;
                    return el;
                });
            writeTracks(get().tracks.map((t) => (t.isMain ? { ...t, elements } : t)));
            set({ selected: [] });
        },

        removeElementsForMedia: (mediaId) => {
            get().pushHistory();
            writeTracks(
                get()
                    .tracks.map((t) => ({ ...t, elements: t.elements.filter((e) => !(e.type === 'media' && e.mediaId === mediaId)) }))
                    .filter((t) => t.isMain || t.elements.length > 0)
            );
            set({ selected: [] });
        },

        /** Points every clip using one source at a processed version of it, keeping cuts and timing. */
        replaceMedia: (oldMediaId, newMediaId, newDuration, newName) => {
            let count = 0;
            const tracks = get().tracks.map((t) => ({
                ...t,
                elements: t.elements.map((el) => {
                    if (el.type !== 'media' || el.mediaId !== oldMediaId) return el;
                    count += 1;
                    const trimStart = Math.min(el.trimStart, Math.max(0, newDuration - TIMELINE.ELEMENT_MIN_DURATION));
                    const trimEnd = Math.max(0, Math.min(el.trimEnd, newDuration - trimStart - TIMELINE.ELEMENT_MIN_DURATION));
                    return { ...el, mediaId: newMediaId, duration: newDuration, trimStart, trimEnd, name: newName };
                }),
            }));
            if (count) {
                get().pushHistory();
                writeTracks(tracks);
            }
            return count;
        },

        getTotalDuration: () =>
            get().tracks.reduce((max, track) => track.elements.reduce((m, el) => Math.max(m, getElementEnd(el)), max), 0),

        findElement: (elementId) => {
            for (const track of get().tracks) {
                const element = track.elements.find((e) => e.id === elementId);
                if (element) return { track, element };
            }
            return null;
        },

        getSnapPoints: (excludeElementId) => {
            const points = new Set<number>([0]);
            for (const track of get().tracks) {
                for (const el of track.elements) {
                    if (el.id === excludeElementId) continue;
                    points.add(el.startTime);
                    points.add(getElementEnd(el));
                }
            }
            return [...points];
        },
    };
});
