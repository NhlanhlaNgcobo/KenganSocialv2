/**
 * Songs with vocals by independent artists (ccMixter + Openverse, CC BY / CC0 only), served by /api/music/songs.
 * Used by the video editor, autocut templates and launch videos.
 */
import { apiClient } from './api';

const API_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

/** A song with vocals from ccMixter or Openverse (CC BY / CC0 only). Playable by musicPreview. */
export interface Song {
    id: string;
    title: string;
    artist: string;
    featuring: string;
    duration: number;
    bpm: number | null;
    genre: string;
    vocals: 'female' | 'male' | 'vocal';
    explicit: boolean;
    description: string;
    pageUrl: string;
    license: string;
    licenseUrl: string;
    source: string;
    credit: string;
    fileUrl: string;
}

export interface SongGenres {
    genres: { id: string; name: string }[];
    vocals: ('any' | 'female' | 'male')[];
    licenses: string[];
    sources: string[];
}

export interface SongQuery {
    genre?: string;
    vocals?: 'any' | 'female' | 'male';
    q?: string;
    page?: number;
    explicit?: boolean;
}

export interface SongPage {
    page: number;
    hasMore: boolean;
    tracks: Song[];
}

let songGenresPromise: Promise<SongGenres> | null = null;

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
    /** Song genres and vocal filters. Cached for the session. */
    songGenres(): Promise<SongGenres> {
        if (!songGenresPromise) {
            songGenresPromise = apiClient('/music/songs/genres').catch((error: Error) => {
                songGenresPromise = null;
                throw error;
            });
        }
        return songGenresPromise as Promise<SongGenres>;
    },

    async searchSongs(query: SongQuery = {}): Promise<SongPage> {
        const params = new URLSearchParams();
        const { explicit, ...rest } = query;
        Object.entries(rest).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
        });
        if (explicit) params.set('explicit', '1');
        return apiClient(`/music/songs?${params}`);
    },

    /** Picks a random song at least minSeconds long, loosening the filters until one fits. */
    async pickSong(query: SongQuery & { minSeconds?: number }): Promise<Song | null> {
        const { minSeconds = 0, ...filters } = query;
        const attempts: SongQuery[] = [filters, { ...filters, vocals: 'any' }, { ...filters, genre: '' }, {}];
        for (const attempt of attempts) {
            const page = await this.searchSongs(attempt);
            const fitting = page.tracks.filter((t) => t.duration >= minSeconds);
            if (fitting.length) return fitting[Math.floor(Math.random() * fitting.length)];
        }
        return null;
    },

    async download(track: Pick<Song, 'fileUrl'>): Promise<Blob> {
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
    async objectUrl(track: Pick<Song, 'id' | 'fileUrl'>): Promise<string> {
        let url = previewUrls.get(track.id);
        if (!url) {
            url = URL.createObjectURL(await musicApi.download(track));
            previewUrls.set(track.id, url);
        }
        return url;
    },
    async toggle(track: Pick<Song, 'id' | 'fileUrl'>) {
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
