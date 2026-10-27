/**
 * Server calls used by the editor. UI components never call fetch directly.
 */
import { apiClient, apiFetch } from '../../lib/api';
import { resumableUpload } from '../../lib/resumable-upload';
import { RESUMABLE_FROM_BYTES } from '../../lib/clips-api';

const API_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

async function authHeaders(): Promise<Record<string, string>> {
    const { auth } = await import('../../lib/firebase');
    const headers: Record<string, string> = {};
    const token = await auth?.currentUser?.getIdToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const workspaceId = localStorage.getItem('kengan_current_workspace_id');
    if (workspaceId) headers['x-workspace-id'] = workspaceId;
    return headers;
}

export interface RenderJobStatus {
    jobId: string;
    status: 'processing' | 'completed' | 'failed';
    progress: number;
    downloadUrl: string | null;
    outputUploadId?: string | null;
    summary?: EnhanceSummary | null;
    error: string | null;
}

export interface StockAsset {
    id: string;
    title: string;
    thumb?: string;
    artist?: string;
    duration?: number | null;
    license?: string;
    attribution?: string;
    fileUrl: string;
    source: 'openverse' | 'pexels';
}

export interface StabilizeSettings {
    mode: 'smooth' | 'tripod';
    strength: number;
    zoomMode: 'auto' | 'manual';
    zoom: number;
    edgeFill: 'zoom' | 'blur' | 'black';
    correctRotation: boolean;
}

export interface CleanupOptions {
    video: { denoise: 'off' | 'light' | 'medium' | 'strong'; sharpen: number; deband: boolean; deflicker: boolean; autoLevels: boolean };
    audio: {
        noise: 'off' | 'voice' | 'voice-laughter' | 'general' | 'fft';
        strength: number;
        hum: 'off' | '50' | '60';
        declick: boolean;
        clarity: boolean;
        deess: boolean;
        loudness: 'off' | 'social' | 'podcast';
    };
}

export interface EnhanceSummary {
    cleanup?: { video: boolean; audio: boolean } | null;
    stabilized: boolean;
    stabilizer?: (Partial<StabilizeSettings> & { engine: 'l1' | 'vidstab-fallback'; zoomApplied?: number; shots?: number }) | null;
    autoframe: null | { applied: boolean; reason?: string; ratio?: string; width?: number; height?: number; shots?: number; faceCoverage?: number };
    backgroundRemoved?: { keyColor: string; personShare: number } | null;
}

export interface EnhanceRequest {
    sourceUploadId: string;
    stabilize?: { enabled: boolean } & StabilizeSettings;
    autoframe?: { enabled: boolean; ratio: string };
    cleanup?: { enabled: boolean } & CleanupOptions;
    /** AI background removal: people on a flat key colour (summary.backgroundRemoved.keyColor). */
    removeBackground?: { enabled: boolean };
}

export interface AnalysisJob {
    jobId: string;
    status: string;
    progress: number;
    error?: string | null;
    transcription?: { words: { text: string; start: number; end: number }[] } | null;
    viralClips?: { startSec: number; endSec: number; score: number; reason: string }[] | null;
    keepSegments?: { startSec: number; endSec: number; reason?: string }[] | null;
    silenceSegments?: { startSec: number; endSec: number }[] | null;
}

export const editorApi = {
    async uploadSource(file: Blob, name: string, signal?: AbortSignal): Promise<string> {
        if (file.size >= RESUMABLE_FROM_BYTES) {
            const named = file instanceof File ? file : new File([file], name, { type: file.type || 'video/mp4' });
            return resumableUpload(named, undefined, signal);
        }
        const form = new FormData();
        form.append('video', file, name);
        const data = await apiClient('/video/manual-edit/upload', { method: 'POST', body: form, signal });
        return data.uploadId as string;
    },

    async startRender(config: unknown): Promise<string> {
        const data = await apiClient('/video/manual-edit', { method: 'POST', body: config });
        return data.jobId as string;
    },

    async startEnhance(body: EnhanceRequest): Promise<string> {
        const data = await apiClient('/video/enhance', { method: 'POST', body });
        return data.jobId as string;
    },

    async getRenderStatus(jobId: string): Promise<RenderJobStatus> {
        return apiClient(`/video/manual-edit/status/${encodeURIComponent(jobId)}`);
    },

    async downloadRender(downloadUrl: string): Promise<Blob> {
        const root = API_URL.replace(/\/api$/, '');
        const response = await apiFetch(`${root}${downloadUrl}`, { headers: await authHeaders() });
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        // Not response.blob(): Chrome streams large response blobs into its disk-backed blob store
        // and fails them ("Failed to fetch") when the disk is nearly full. Reading the bytes and
        // wrapping them works in that case too, at the same memory cost.
        return new Blob([await response.arrayBuffer()], { type: response.headers.get('content-type') || 'video/mp4' });
    },

    async startAnalysis(body: {
        sourceUploadId: string;
        analysisPreferences: Record<string, unknown>;
        stylePreset?: unknown;
    }): Promise<string> {
        const data = await apiClient('/video/process', { method: 'POST', body });
        return data.jobId as string;
    },

    async getAnalysisJob(jobId: string): Promise<AnalysisJob> {
        const data = await apiClient(`/video/jobs/${encodeURIComponent(jobId)}`);
        return data.job as AnalysisJob;
    },

    async searchAssets(type: 'broll' | 'music' | 'images', query: string, orientation?: string) {
        const params = new URLSearchParams({ q: query });
        if (orientation) params.set('orientation', orientation);
        const data = await apiClient(`/assets/${type}?${params}`);
        return { assets: (data.assets || []) as StockAsset[], notice: (data.notice as string) || null };
    },

    /** Downloads a stock asset through the server (fileUrl comes from searchAssets). */
    async downloadAsset(fileUrl: string): Promise<Blob> {
        const root = API_URL.replace(/\/api$/, '');
        const response = await apiFetch(`${root}${fileUrl}`, { headers: await authHeaders() });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || `Download failed (${response.status})`);
        }
        // Bytes, not response.blob(): see downloadRender.
        return new Blob([await response.arrayBuffer()], { type: response.headers.get('content-type') || 'video/mp4' });
    },
};

/** Polls `fetcher` until `isDone` returns true, the job fails, or the signal aborts. */
export async function pollJob<T extends { status: string; error?: string | null }>(
    fetcher: () => Promise<T>,
    onUpdate: (job: T) => void,
    isDone: (job: T) => boolean,
    signal?: AbortSignal,
    intervalMs = 1500
): Promise<T> {
    for (;;) {
        if (signal?.aborted) throw new Error('Cancelled');
        const job = await fetcher();
        onUpdate(job);
        if (job.status === 'failed') throw new Error(job.error || 'Job failed');
        if (isDone(job)) return job;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
}
