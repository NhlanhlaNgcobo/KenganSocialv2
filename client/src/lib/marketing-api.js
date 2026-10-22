/**
 * Marketing tab API: brand kit, brand voice, reference library. Server: /api/marketing.
 */
import { apiClient, apiFetch, API_URL, buildApiError } from './api';

const PLAN_MESSAGES = {
    FEATURE_LOCKED: 'This uses AI, which is part of the Nano plan and up. Upgrade in Billing to unlock it.',
    PLAN_LIMIT_EXCEEDED: "You've used this month's AI allowance. It resets on the 1st, or upgrade for more.",
};

/** apiClient throws the error code for plan limits; turn those into sentences. */
async function call(path, options) {
    try {
        return await apiClient(path, options);
    } catch (error) {
        throw new Error(PLAN_MESSAGES[error.code] || PLAN_MESSAGES[error.message] || error.message);
    }
}

export const marketingApi = {
    videoAdOptions: () => call('/marketing/video-ads/options'),
    videoAds: () => call('/marketing/video-ads'),
    videoAd: (id) => call(`/marketing/video-ads/${encodeURIComponent(id)}`),
    createVideoAd: (form) => call('/marketing/video-ads', { method: 'POST', body: form }),
    renderVideoAd: (id, body) => call(`/marketing/video-ads/${encodeURIComponent(id)}/render`, { method: 'POST', body }),
    deleteVideoAd: (id) => call(`/marketing/video-ads/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    async videoAdMedia(id, kind = 'video') {
        const { auth } = await import('./firebase');
        const token = await auth.currentUser?.getIdToken();
        const response = await apiFetch(`${API_URL}/marketing/video-ads/${encodeURIComponent(id)}/media/${kind}`, {
            headers: { Authorization: `Bearer ${token || ''}`, 'x-workspace-id': localStorage.getItem('kengan_current_workspace_id') || '' },
        });
        if (!response.ok) throw buildApiError(await response.json().catch(() => ({})), response.status);
        return response.blob();
    },
    brand: () => call('/marketing/brand'),
    saveBrand: (body) => call('/marketing/brand', { method: 'PUT', body }),
    importFromWebsite: (url) => call('/marketing/brand/import', { method: 'POST', body: { url } }),
    uploadLogo(fileOrDataUrl, variant = 'primary') {
        const path = `/marketing/brand/logo?variant=${variant}`;
        if (typeof fileOrDataUrl === 'string') return call(path, { method: 'POST', body: { dataUrl: fileOrDataUrl } });
        const form = new FormData();
        form.append('file', fileOrDataUrl);
        return call(path, { method: 'POST', body: form });
    },
    removeLogo: (variant) => call(`/marketing/brand/logo/${variant}`, { method: 'DELETE' }),
    analyzeVoice: (samples) => call('/marketing/brand/voice/analyze', { method: 'POST', body: { samples } }),

    references: () => call('/marketing/references'),
    uploadReferences(files) {
        const form = new FormData();
        [...files].forEach((f) => form.append('files', f));
        return call('/marketing/references', { method: 'POST', body: form });
    },
    removeReference: (id) => call(`/marketing/references/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    learnStyle: () => call('/marketing/references/style', { method: 'POST' }),

    setupFromWebsite: (url) => call('/marketing/setup/website', { method: 'POST', body: { url } }),
    job: (id) => call(`/marketing/jobs/${encodeURIComponent(id)}`),

    carouselOptions: () => call('/marketing/carousels/options'),
    carousels: () => call('/marketing/carousels'),
    carousel: (id) => call(`/marketing/carousels/${encodeURIComponent(id)}`),
    createCarousel: (body) => call('/marketing/carousels', { method: 'POST', body }),
    updateCarousel: (id, body) => call(`/marketing/carousels/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
    updateSlide: (id, index, body) => call(`/marketing/carousels/${encodeURIComponent(id)}/slides/${index}`, { method: 'PATCH', body }),
    regenerateImage: (id, index, body = {}) => call(`/marketing/carousels/${encodeURIComponent(id)}/slides/${index}/image`, { method: 'POST', body }),
    deleteCarousel: (id) => call(`/marketing/carousels/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

/** Polls a job-like fetcher until status is no longer "running". */
export async function pollUntilDone(fetcher, onUpdate, { interval = 2500, timeoutMs = 15 * 60 * 1000 } = {}) {
    const started = Date.now();
    for (;;) {
        const value = await fetcher();
        onUpdate?.(value);
        if (value.status !== 'running') return value;
        if (Date.now() - started > timeoutMs) throw new Error('This is taking longer than expected. Check back in a minute.');
        await new Promise((r) => setTimeout(r, interval));
    }
}

/** Loads Google Fonts for previews. Unknown or custom fonts simply fall back to system fonts. */
const loadedFonts = new Set();
export function loadGoogleFont(name) {
    const family = String(name || '').trim();
    if (!family || loadedFonts.has(family) || /^(arial|helvetica|georgia|times new roman|verdana|system-ui|sans-serif|serif)$/i.test(family)) return;
    loadedFonts.add(family);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;600;700&display=swap`;
    document.head.appendChild(link);
}

/** WCAG contrast ratio between two #rrggbb colours. */
export function contrast(a, b) {
    const lum = (hex) => {
        const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
        if (!m) return null;
        const [r, g, bl] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const la = lum(a);
    const lb = lum(b);
    if (la === null || lb === null) return null;
    const [hi, lo] = [la, lb].sort((x, y) => y - x);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10;
}
