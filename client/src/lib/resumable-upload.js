/**
 * Large uploads in chunks (server: /api/video/manual-edit/resumable). A dropped connection or a
 * failed chunk is retried; uploading the same file again later resumes from the chunks the server
 * already has (the session id is remembered per file for 24 hours, like the server session).
 */
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const BASE = `${API_URL}/video/manual-edit/resumable`;
const RETRIES = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function headers(extra = {}) {
    const { auth } = await import('./firebase');
    const h = { ...extra };
    // A fresh token per request: big uploads can outlast the one-hour ID token.
    const token = await auth?.currentUser?.getIdToken();
    if (token) h.Authorization = `Bearer ${token}`;
    const workspaceId = localStorage.getItem('kengan_current_workspace_id');
    if (workspaceId) h['x-workspace-id'] = workspaceId;
    return h;
}

async function call(url, options = {}) {
    const response = await fetch(url, { ...options, headers: await headers(options.headers) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.error || `Upload failed (${response.status})`), { status: response.status });
    return body;
}

/** Retries network errors and server hiccups; gives up at once on 4xx (except 408/429). */
async function withRetry(task) {
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await task();
        } catch (error) {
            const permanent = error.status && error.status < 500 && ![408, 429].includes(error.status);
            if (permanent || attempt >= RETRIES) throw error;
            await sleep(Math.min(15000, 1000 * 2 ** attempt));
        }
    }
}

const fileKey = (file) => `kengan_resumable:${file.name}:${file.size}:${file.lastModified || 0}`;

function remembered(file) {
    try {
        const saved = JSON.parse(localStorage.getItem(fileKey(file)) || 'null');
        return saved && saved.expires > Date.now() ? saved.id : null;
    } catch {
        return null;
    }
}

function remember(file, id) {
    try {
        if (id) localStorage.setItem(fileKey(file), JSON.stringify({ id, expires: Date.now() + 23 * 3600 * 1000 }));
        else localStorage.removeItem(fileKey(file));
    } catch {
        /* storage blocked: resuming within this upload still works */
    }
}

/** Uploads `file` and resolves to its upload id. onProgress gets 0-100. */
export async function resumableUpload(file, onProgress = () => {}) {
    let id = remembered(file);
    let status = null;
    if (id) status = await call(`${BASE}/${id}`).catch(() => null);
    if (!status) {
        const created = await withRetry(() =>
            call(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ size: file.size, type: file.type || 'video/mp4', name: file.name }) })
        );
        id = created.id;
        remember(file, id);
        status = { chunkBytes: created.chunkBytes, received: [] };
    }

    const chunkBytes = status.chunkBytes;
    const count = Math.ceil(file.size / chunkBytes);
    const done = new Set(status.received || []);
    const report = () => onProgress(Math.min(99, Math.round((done.size / count) * 100)));
    report();

    for (let index = 0; index < count; index += 1) {
        if (done.has(index)) continue;
        const chunk = file.slice(index * chunkBytes, Math.min(file.size, (index + 1) * chunkBytes));
        await withRetry(() => call(`${BASE}/${id}/${index}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk }));
        done.add(index);
        report();
    }

    const result = await withRetry(() => call(`${BASE}/${id}/complete`, { method: 'POST' }));
    remember(file, null);
    onProgress(100);
    return result.uploadId;
}
