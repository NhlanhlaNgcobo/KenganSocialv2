/**
 * Royalty-free music library (Kevin MacLeod / incompetech.com, CC BY 4.0), served by /api/music.
 * Used by the video editor, autocut templates and launch videos.
 */
import { apiClient } from './api';

const API_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export interface LibraryTrack {
    id: string;
    title: string;
    artist: string;
    duration: number;
    bpm: number | null;
    genreId: number;
    genre: string;
    moods: string[];
    instruments: string[];
    description: string;
    credit: string;
    license: string;
    fileUrl: string;
}

export interface LibrarySummary {
    total: number;
    genres: { id: number; name: string; count: number }[];
    moods: { name: string; count: number }[];
    lengths: string[];
    license: string;
    licenseUrl: string;
    source: string;
}

export interface LibraryQuery {
    genre?: string;
    mood?: string;
    q?: string;
    length?: '' | 'short' | 'medium' | 'long';
    page?: number;
}

export interface LibraryPage {
    total: number;
    page: number;
    hasMore: boolean;
    tracks: LibraryTrack[];
}

let summaryPromise: Promise<LibrarySummary> | null = null;

async function authHeaders(): Promise<Record<string, string>> {
    const { auth } = await import('./firebase');
    const headers: Record<string, string> = {};
    const token = await auth?.currentUser?.getIdToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const workspaceId = localStorage.getItem('kengan_current_workspace_id');
    if (workspaceId) headers['x-workspace-id'] = workspaceId;
    return headers;
}

export const musicApi = {
    /** Genres, moods and licence. Cached for the session. */
    summary(): Promise<LibrarySummary> {
        if (!summaryPromise) {
            summaryPromise = apiClient('/music').catch((error: Error) => {
                summaryPromise = null;
                throw error;
            });
        }
        return summaryPromise as Promise<LibrarySummary>;
    },

    async search(query: LibraryQuery = {}): Promise<LibraryPage> {
        const params = new URLSearchParams();
        Object.entries(query).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
        });
        return apiClient(`/music/tracks?${params}`);
    },

    /** Picks a random track matching the filters (used by templates). */
    async pick(query: LibraryQuery & { minSeconds?: number }): Promise<LibraryTrack | null> {
        const { minSeconds = 0, ...filters } = query;
        const attempts: LibraryQuery[] = [filters, { ...filters, mood: '' }, { ...filters, genre: '' }, {}];
        for (const attempt of attempts) {
            const page = await this.search(attempt);
            const fitting = page.tracks.filter((t) => t.duration >= minSeconds && t.genre !== 'Stings');
            if (fitting.length) return fitting[Math.floor(Math.random() * fitting.length)];
        }
        return null;
    },

    async download(track: Pick<LibraryTrack, 'fileUrl'>): Promise<Blob> {
        const root = API_URL.replace(/\/api$/, '');
        const response = await fetch(`${root}${track.fileUrl}`, { headers: await authHeaders() });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || `Download failed (${response.status})`);
        }
        return response.blob();
    },
};

/** A single shared preview player so only one track plays at a time across the app. */
const previewUrls = new Map<string, string>();
let previewAudio: HTMLAudioElement | null = null;
let previewId: string | null = null;
const listeners = new Set<(id: string | null) => void>();

function setPreview(id: string | null) {
    previewId = id;
    listeners.forEach((fn) => fn(id));
}

export const musicPreview = {
    subscribe(fn: (id: string | null) => void) {
        listeners.add(fn);
        return () => {
            listeners.delete(fn);
        };
    },
    current: () => previewId,
    async objectUrl(track: LibraryTrack): Promise<string> {
        let url = previewUrls.get(track.id);
        if (!url) {
            url = URL.createObjectURL(await musicApi.download(track));
            previewUrls.set(track.id, url);
        }
        return url;
    },
    async toggle(track: LibraryTrack) {
        if (previewId === track.id) return this.stop();
        const url = await this.objectUrl(track);
        previewAudio?.pause();
        previewAudio = new Audio(url);
        previewAudio.onended = () => setPreview(null);
        await previewAudio.play();
        setPreview(track.id);
    },
    stop() {
        previewAudio?.pause();
        previewAudio = null;
        setPreview(null);
    },
};

export function formatDuration(seconds: number): string {
    const s = Math.round(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
