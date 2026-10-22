import { API_URL, apiClient, apiFetch, buildApiError } from './api';

/** Thumbnails for TikTok covers and YouTube (server: routes/thumbnails.ts). */
async function authHeaders() {
    const { auth } = await import('./firebase');
    const headers = { 'Content-Type': 'application/json' };
    const token = await auth?.currentUser?.getIdToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const workspaceId = localStorage.getItem('kengan_current_workspace_id');
    if (workspaceId) headers['x-workspace-id'] = workspaceId;
    return headers;
}

export const thumbnailsApi = {
    options: () => apiClient('/thumbnails/options'),
    candidates: (body) => apiClient('/thumbnails/candidates', { method: 'POST', body }),
    headlines: (body) => apiClient('/thumbnails/headlines', { method: 'POST', body }),
    background: (body) => apiClient('/thumbnails/background', { method: 'POST', body }),
    /** The finished thumbnail as a PNG blob. */
    async render(body) {
        const res = await apiFetch(`${API_URL}/thumbnails/render`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) });
        if (!res.ok) throw buildApiError(await res.json().catch(() => ({})), res.status);
        return res.blob();
    },
};
