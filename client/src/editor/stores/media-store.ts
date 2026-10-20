/**
 * Project media bin. Files live in the browser (object URLs + IndexedDB) and are
 * uploaded to the render server only when an export or AI job needs them.
 */
import { create } from 'zustand';
import { editorApi } from '../lib/editor-api';
import { detectMediaType, getMediaInfo } from '../lib/media-processing';
import { editorStorage } from '../lib/storage';
import { generateId } from '../lib/time';
import type { MediaItem } from '../types';

export interface StoredMediaMeta {
    id: string;
    name: string;
    type: MediaItem['type'];
}

interface MediaState {
    items: MediaItem[];
    isImporting: boolean;
    importErrors: string[];
    addFiles: (files: File[], projectKey: string, options?: { signal?: AbortSignal; isCurrent?: () => boolean }) => Promise<MediaItem[]>;
    removeItem: (id: string, projectKey: string) => void;
    restore: (metas: StoredMediaMeta[], projectKey: string) => Promise<void>;
    reset: () => void;
    ensureUploaded: (ids: string[], onProgress?: (done: number, total: number) => void) => Promise<Record<string, string>>;
    invalidateUploads: () => void;
    addProcessed: (blob: Blob, name: string, projectKey: string, uploadId: string) => Promise<MediaItem | null>;
    getItem: (id: string) => MediaItem | undefined;
}

const mediaKey = (projectKey: string, id: string) => `${projectKey}:${id}`;

export const useMediaStore = create<MediaState>((set, get) => ({
    items: [],
    isImporting: false,
    importErrors: [],

    addFiles: async (files, projectKey, options) => {
        set({ isImporting: true, importErrors: [] });
        const added: MediaItem[] = [];
        const errors: string[] = [];
        for (const file of files) {
            if (!detectMediaType(file)) {
                errors.push(`${file.name}: unsupported file type`);
                continue;
            }
            const url = URL.createObjectURL(file);
            try {
                const info = await getMediaInfo(file, url);
                const item: MediaItem = {
                    id: generateId('media'),
                    name: file.name,
                    file,
                    url,
                    ...info,
                    uploadId: null,
                    uploadStatus: 'idle',
                };
                added.push(item);
                await editorStorage.saveMedia(mediaKey(projectKey, item.id), {
                    id: item.id,
                    name: item.name,
                    type: item.type,
                    blob: file,
                    duration: item.duration,
                    width: item.width,
                    height: item.height,
                    thumbnailUrl: item.thumbnailUrl,
                });
            } catch (error) {
                URL.revokeObjectURL(url);
                errors.push(`${file.name}: ${(error as Error).message}`);
            }
        }
        if (options?.signal?.aborted || (options?.isCurrent && !options.isCurrent())) {
            for (const item of added) {
                URL.revokeObjectURL(item.url);
                await editorStorage.deleteMedia(mediaKey(projectKey, item.id));
            }
            set({ isImporting: false });
            throw new Error('Cancelled');
        }
        set((state) => ({ items: [...state.items, ...added], isImporting: false, importErrors: errors }));
        return added;
    },

    removeItem: (id, projectKey) => {
        const item = get().items.find((i) => i.id === id);
        if (item) URL.revokeObjectURL(item.url);
        editorStorage.deleteMedia(mediaKey(projectKey, id));
        set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
    },

    restore: async (metas, projectKey) => {
        const items: MediaItem[] = [];
        for (const meta of metas) {
            const stored = await editorStorage.loadMedia(mediaKey(projectKey, meta.id));
            if (!stored) continue;
            items.push({
                id: stored.id,
                name: stored.name,
                type: stored.type as MediaItem['type'],
                file: stored.blob,
                url: URL.createObjectURL(stored.blob),
                duration: stored.duration,
                width: stored.width,
                height: stored.height,
                thumbnailUrl: stored.thumbnailUrl,
                uploadId: null,
                uploadStatus: 'idle',
            });
        }
        get().items.forEach((i) => URL.revokeObjectURL(i.url));
        set({ items });
    },

    reset: () => {
        get().items.forEach((i) => URL.revokeObjectURL(i.url));
        set({ items: [], importErrors: [] });
    },

    ensureUploaded: async (ids, onProgress) => {
        const unique = [...new Set(ids)];
        const result: Record<string, string> = {};
        let done = 0;
        for (const id of unique) {
            const item = get().items.find((i) => i.id === id);
            if (!item) throw new Error('A clip on the timeline references media that is no longer in the project.');
            if (item.uploadId) {
                result[id] = item.uploadId;
            } else {
                set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, uploadStatus: 'uploading' } : i)) }));
                try {
                    const uploadId = await editorApi.uploadSource(item.file, item.name);
                    result[id] = uploadId;
                    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, uploadId, uploadStatus: 'uploaded' } : i)) }));
                } catch (error) {
                    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, uploadStatus: 'failed' } : i)) }));
                    throw error;
                }
            }
            done += 1;
            onProgress?.(done, unique.length);
        }
        return result;
    },

    /** The render server keeps uploads in memory; call this when it reports them missing. */
    invalidateUploads: () => set((s) => ({ items: s.items.map((i) => ({ ...i, uploadId: null, uploadStatus: 'idle' })) })),

    /** Adds a server-produced file (e.g. an enhanced clip) that already exists as an upload. */
    addProcessed: async (blob, name, projectKey, uploadId) => {
        const file = new File([blob], name, { type: blob.type || 'video/mp4' });
        const [item] = await get().addFiles([file], projectKey);
        if (!item) return null;
        set((s) => ({ items: s.items.map((i) => (i.id === item.id ? { ...i, uploadId, uploadStatus: 'uploaded' } : i)) }));
        return get().getItem(item.id) ?? null;
    },

    getItem: (id) => get().items.find((i) => i.id === id),
}));
