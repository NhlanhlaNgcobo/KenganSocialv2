/**
 * Project settings plus load/autosave of the whole editor state to IndexedDB.
 */
import { create } from 'zustand';
import { CANVAS_SIZES, DEFAULT_FPS } from '../constants';
import { editorStorage } from '../lib/storage';
import type { AspectRatio, TimelineTrack } from '../types';
import { useMediaStore, type StoredMediaMeta } from './media-store';
import { useTimelineStore } from './timeline-store';
import { usePlaybackStore } from './playback-store';

interface StoredProject {
    version: 1;
    name: string;
    ratio: AspectRatio;
    fps: number;
    backgroundColor: string;
    tracks: TimelineTrack[];
    media: StoredMediaMeta[];
    luts?: Record<string, ImportedLut>;
    updatedAt: number;
}

/** A .cube LUT imported into the project (Creative › Look › Import). data: r,g,b with r fastest. */
export interface ImportedLut {
    name: string;
    size: number;
    data: number[];
}

interface ProjectState {
    projectKey: string | null;
    name: string;
    ratio: AspectRatio;
    fps: number;
    backgroundColor: string;
    status: 'idle' | 'loading' | 'ready';
    lastSavedAt: number | null;
    luts: Record<string, ImportedLut>;
    addLut: (lut: ImportedLut) => string;
    removeLut: (id: string) => void;
    load: (projectKey: string) => Promise<void>;
    save: () => Promise<void>;
    newProject: () => Promise<void>;
    setName: (name: string) => void;
    setRatio: (ratio: AspectRatio) => void;
    setBackgroundColor: (color: string) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
    projectKey: null,
    name: 'Untitled project',
    ratio: '9:16',
    fps: DEFAULT_FPS,
    backgroundColor: '#000000',
    status: 'idle',
    lastSavedAt: null,
    luts: {},
    addLut: (lut) => {
        const id = `lut${Date.now().toString(36)}`;
        set((s) => ({ luts: { ...s.luts, [id]: lut } }));
        return id;
    },
    removeLut: (id) =>
        set((s) => {
            const next = { ...s.luts };
            delete next[id];
            return { luts: next };
        }),

    load: async (projectKey) => {
        set({ status: 'loading', projectKey });
        usePlaybackStore.getState().pause();
        usePlaybackStore.getState().seek(0);
        const stored = await editorStorage.loadProject<StoredProject>(projectKey);
        if (stored) {
            await useMediaStore.getState().restore(stored.media || [], projectKey);
            const available = new Set(useMediaStore.getState().items.map((i) => i.id));
            // Drop clips whose media blob did not survive (e.g. cleared site data).
            const tracks = (stored.tracks || []).map((t) => ({
                ...t,
                elements: t.elements.filter((e) => e.type !== 'media' || available.has(e.mediaId)),
            }));
            useTimelineStore.getState().loadTracks(tracks);
            set({
                name: stored.name || 'Untitled project',
                ratio: stored.ratio || '9:16',
                fps: stored.fps || DEFAULT_FPS,
                backgroundColor: stored.backgroundColor || '#000000',
                lastSavedAt: stored.updatedAt || null,
                luts: stored.luts || {},
            });
        } else {
            useMediaStore.getState().reset();
            useTimelineStore.getState().clearTimeline();
            set({ name: 'Untitled project', ratio: '9:16', fps: DEFAULT_FPS, backgroundColor: '#000000', lastSavedAt: null, luts: {} });
        }
        set({ status: 'ready' });
    },

    save: async () => {
        const { projectKey, name, ratio, fps, backgroundColor, status } = get();
        if (!projectKey || status !== 'ready') return;
        const data: StoredProject = {
            version: 1,
            name,
            ratio,
            fps,
            backgroundColor,
            tracks: useTimelineStore.getState().tracks,
            media: useMediaStore.getState().items.map(({ id, name: n, type }) => ({ id, name: n, type })),
            luts: get().luts,
            updatedAt: Date.now(),
        };
        await editorStorage.saveProject(projectKey, data);
        set({ lastSavedAt: data.updatedAt });
    },

    newProject: async () => {
        const { projectKey } = get();
        if (!projectKey) return;
        for (const item of useMediaStore.getState().items) useMediaStore.getState().removeItem(item.id, projectKey);
        await editorStorage.deleteProject(projectKey);
        await get().load(projectKey);
    },

    setName: (name) => set({ name }),
    setRatio: (ratio) => set({ ratio }),
    setBackgroundColor: (backgroundColor) => set({ backgroundColor }),
}));

export const getCanvasSize = (ratio: AspectRatio) => CANVAS_SIZES[ratio];

/** Debounced autosave whenever the timeline, media bin or settings change. */
export function startAutosave(delayMs = 800): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
        if (useProjectStore.getState().status !== 'ready') return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => useProjectStore.getState().save(), delayMs);
    };
    const unsubs = [
        useTimelineStore.subscribe((s, prev) => s.tracks !== prev.tracks && schedule()),
        useMediaStore.subscribe((s, prev) => s.items.length !== prev.items.length && schedule()),
        useProjectStore.subscribe((s, prev) => s.luts !== prev.luts && schedule()),
        useProjectStore.subscribe((s, prev) => {
            if (s.name !== prev.name || s.ratio !== prev.ratio || s.backgroundColor !== prev.backgroundColor) schedule();
        }),
    ];
    return () => {
        if (timer) {
            clearTimeout(timer);
            useProjectStore.getState().save();
        }
        unsubs.forEach((u) => u());
    };
}
