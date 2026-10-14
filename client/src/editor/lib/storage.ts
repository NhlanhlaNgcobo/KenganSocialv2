/**
 * IndexedDB persistence for editor projects and their media blobs.
 * Everything stays in the viewer's browser; nothing here is sent to the server.
 */

const DB_NAME = 'kengan-editor';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const MEDIA = 'media';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS);
            if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            dbPromise = null;
            reject(request.error);
        };
    });
    return dbPromise;
}

async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const request = run(db.transaction(store, mode).objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export interface StoredMedia {
    id: string;
    name: string;
    type: string;
    blob: Blob;
    duration: number;
    width?: number;
    height?: number;
    thumbnailUrl?: string;
}

export const editorStorage = {
    async saveProject(key: string, data: unknown) {
        try {
            await tx(PROJECTS, 'readwrite', (s) => s.put(data, key));
        } catch (error) {
            console.warn('[editor] project save failed', error);
        }
    },
    async loadProject<T>(key: string): Promise<T | null> {
        try {
            return ((await tx(PROJECTS, 'readonly', (s) => s.get(key))) as T) ?? null;
        } catch {
            return null;
        }
    },
    async deleteProject(key: string) {
        try {
            await tx(PROJECTS, 'readwrite', (s) => s.delete(key));
        } catch {
            /* ignore */
        }
    },
    async saveMedia(key: string, media: StoredMedia) {
        try {
            await tx(MEDIA, 'readwrite', (s) => s.put(media, key));
        } catch (error) {
            console.warn('[editor] media save failed', error);
        }
    },
    async loadMedia(key: string): Promise<StoredMedia | null> {
        try {
            return ((await tx(MEDIA, 'readonly', (s) => s.get(key))) as StoredMedia) ?? null;
        } catch {
            return null;
        }
    },
    async deleteMedia(key: string) {
        try {
            await tx(MEDIA, 'readwrite', (s) => s.delete(key));
        } catch {
            /* ignore */
        }
    },
};
