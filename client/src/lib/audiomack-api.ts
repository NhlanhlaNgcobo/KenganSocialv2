/**
 * Audiomack guide tracks, served by /api/audiomack. Stream-only: tracks play
 * along with the editor preview but are never downloaded or exported.
 */
import { apiClient } from './api';

export interface AudiomackTrack {
    id: string;
    title: string;
    artist: string;
    artworkUrl: string | null;
    genre: string | null;
    durationSec: number | null;
    permalink: string | null;
}

export const audiomackApi = {
    status(): Promise<{ configured: boolean }> {
        return apiClient('/audiomack/status');
    },

    search(q: string, page = 1): Promise<{ configured: boolean; tracks: AudiomackTrack[] }> {
        return apiClient(`/audiomack/search?${new URLSearchParams({ q, page: String(page) })}`);
    },

    /** Fresh stream URL; Audiomack's expire within seconds, so call right before playing. */
    async playUrl(id: string): Promise<string> {
        const { url } = await apiClient(`/audiomack/play/${encodeURIComponent(id)}`, { method: 'POST' });
        return url;
    },
};
