/**
 * Clips API: long video → ranked short clips. Server: /api/clips.
 */
import { apiClient, apiFetch } from './api';
import { resumableUpload } from './resumable-upload';

// Files over 2 MB go up in 2 MB chunks: each request stays short (proxies cut off requests that
// run past 60 seconds, which a single upload over mobile data easily does) and survives drops.
export const RESUMABLE_FROM_BYTES = 2 * 1024 * 1024;

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const API_ROOT = API_URL.replace(/\/api$/, '');

async function authHeaders() {
    const { auth } = await import('./firebase');
    const headers = {};
    const token = await auth?.currentUser?.getIdToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const workspaceId = localStorage.getItem('kengan_current_workspace_id');
    if (workspaceId) headers['x-workspace-id'] = workspaceId;
    return headers;
}

/** Uploads a video with progress (fetch cannot report upload progress). Resolves to the upload ID; `signal` cancels. */
export async function uploadVideo(file, onProgress = () => {}, signal) {
    if (file.size >= RESUMABLE_FROM_BYTES) return resumableUpload(file, onProgress, signal);
    const headers = await authHeaders();
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_URL}/video/manual-edit/upload`);
        Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
        xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
        xhr.onload = () => {
            let body = {};
            try {
                body = JSON.parse(xhr.responseText);
            } catch {
                /* non-JSON error page */
            }
            if (xhr.status >= 200 && xhr.status < 300 && body.uploadId) resolve(body.uploadId);
            else reject(new Error(body.error || `Upload failed (${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
        xhr.onabort = () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError', cancelled: true }));
        if (signal?.aborted) return xhr.onabort();
        signal?.addEventListener('abort', () => xhr.abort(), { once: true });
        const form = new FormData();
        form.append('video', file, file.name);
        xhr.send(form);
    });
}

export const clipsApi = {
    create: (body) => apiClient('/clips', { method: 'POST', body }),
    /** YouTube link → clips: { url, rightsConfirmed, count, length, ratio, captionStyle }. */
    fromUrl: (body) => apiClient('/clips/from-url', { method: 'POST', body }),
    list: () => apiClient('/clips'),
    get: (id) => apiClient(`/clips/${encodeURIComponent(id)}`),
    remove: (id) => apiClient(`/clips/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    async download(downloadUrl) {
        const response = await apiFetch(`${API_ROOT}${downloadUrl}`, { headers: await authHeaders() });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            if (response.status === 401) throw new Error('Your session has expired. Sign in again to download this clip.');
            if (response.status === 403) throw new Error("You don't have access to this clip. It belongs to a workspace you're not a member of.");
            if (response.status === 404) throw new Error(body.message || 'This clip file is no longer available. Generate it again.');
            throw new Error(body.message || `Download failed (${response.status}). Try again.`);
        }
        // Bytes, not response.blob(): Chrome fails large response blobs when the disk is nearly full.
        return new Blob([await response.arrayBuffer()], { type: response.headers.get('content-type') || 'video/mp4' });
    },
};

export function formatTime(seconds) {
    const s = Math.max(0, Math.round(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
