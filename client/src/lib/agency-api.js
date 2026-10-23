/**
 * Clients & approvals API. Team routes: /api/agency (signed in). Client review page: /api/review (public).
 */
import { apiClient, apiFetch } from './api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

async function authHeaders() {
    const { auth } = await import('./firebase');
    const headers = {};
    const token = await auth?.currentUser?.getIdToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const workspaceId = localStorage.getItem('kengan_current_workspace_id');
    if (workspaceId) headers['x-workspace-id'] = workspaceId;
    return headers;
}

/**
 * Uploads a video to the library with progress (fetch cannot report upload progress).
 * @param {File} file
 * @param {{ clientId?: string, title?: string, assetId?: string, note?: string }} fields  assetId = add a new version
 */
export async function uploadLibraryVideo(file, fields = {}, onProgress = () => {}) {
    const headers = await authHeaders();
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_URL}/agency/library/upload`);
        Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
        xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
        xhr.onload = () => {
            let body = {};
            try {
                body = JSON.parse(xhr.responseText);
            } catch {
                /* non-JSON error page */
            }
            if (xhr.status >= 200 && xhr.status < 300 && body.asset) resolve(body.asset);
            else reject(new Error(body.error || body.message || `Upload failed (${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
        const form = new FormData();
        Object.entries(fields).forEach(([k, v]) => v != null && v !== '' && form.append(k, v));
        form.append('file', file, file.name);
        xhr.send(form);
    });
}

export const agencyApi = {
    clients: () => apiClient('/agency/clients'),
    createClient: (body) => apiClient('/agency/clients', { method: 'POST', body }),
    updateClient: (id, body) => apiClient(`/agency/clients/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
    deleteClient: (id) => apiClient(`/agency/clients/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    library: () => apiClient('/agency/library'),
    asset: (id) => apiClient(`/agency/library/${encodeURIComponent(id)}`),
    updateAsset: (id, body) => apiClient(`/agency/library/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
    deleteAsset: (id) => apiClient(`/agency/library/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    saveRender: (body) => apiClient('/agency/library/from-render', { method: 'POST', body }),
    comment: (id, body) => apiClient(`/agency/library/${encodeURIComponent(id)}/comments`, { method: 'POST', body }),
    resolveComment: (id, commentId, resolved) =>
        apiClient(`/agency/library/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`, { method: 'PATCH', body: { resolved } }),

    reviews: () => apiClient('/agency/reviews'),
    createReview: (body) => apiClient('/agency/reviews', { method: 'POST', body }),
    revokeReview: (id) => apiClient(`/agency/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    notifications: () => apiClient('/agency/notifications'),
    /** @param {string[]} [ids] omit to mark everything read */
    markNotificationsRead: (ids) => apiClient('/agency/notifications/read', { method: 'POST', body: ids ? { ids } : {} }),
};

/** Public review page calls: no sign-in, the token in the link is the access. */
async function publicCall(path, options = {}) {
    const response = await apiFetch(`${API_URL}/review/${path}`, {
        method: options.method || 'GET',
        headers: options.body ? { 'Content-Type': 'application/json' } : {},
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.error || `Something went wrong (${response.status}).`), { status: response.status });
    return body;
}

export const reviewApi = {
    get: (token) => publicCall(encodeURIComponent(token)),
    comment: (token, assetId, body) => publicCall(`${encodeURIComponent(token)}/assets/${encodeURIComponent(assetId)}/comments`, { method: 'POST', body }),
    decide: (token, assetId, body) => publicCall(`${encodeURIComponent(token)}/assets/${encodeURIComponent(assetId)}/decision`, { method: 'POST', body }),
};

export const STATUS_META = {
    draft: { label: 'Draft', tone: 'muted' },
    in_review: { label: 'Waiting on client', tone: 'info' },
    changes_requested: { label: 'Changes requested', tone: 'warning' },
    approved: { label: 'Approved', tone: 'success' },
};

export const PLATFORM_LABELS = {
    instagram: 'Instagram',
    facebook: 'Facebook',
    tiktok: 'TikTok',
    youtube: 'YouTube',
};

export function formatTimecode(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatBytes(bytes) {
    if (!bytes) return '0 MB';
    return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}
