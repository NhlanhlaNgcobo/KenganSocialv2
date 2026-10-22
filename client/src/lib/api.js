export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export const NETWORK_ERROR = "Can't reach KenganSocial right now. Check your internet connection and try again in a moment.";

/** Sentences for error codes the server returns without a human-readable message. */
const ERROR_SENTENCES = {
    FEATURE_LOCKED: "This feature isn't included in your plan. Upgrade in Billing to use it.",
    PLAN_LIMIT_EXCEEDED: "You've reached this month's limit for your plan. It resets on the 1st, or upgrade in Billing.",
    UPGRADE_REQUIRED: "This feature isn't included in your plan. Upgrade in Billing to use it.",
};

/**
 * Builds the Error thrown for a non-2xx response. `message` is always a sentence the UI can show;
 * the machine-readable code (e.g. 'FEATURE_LOCKED') is on `error.code` and the HTTP status on `error.status`.
 */
export function buildApiError(errorData, status) {
    const code = typeof errorData?.error === 'string' ? errorData.error : undefined;
    // Plan-gate codes come with technical messages ("clipAnalysis is not available on the starter plan."),
    // so their mapped sentence wins; otherwise the server's own message is used.
    const message =
        (code && ERROR_SENTENCES[code]) ||
        (typeof errorData?.message === 'string' && errorData.message) ||
        code ||
        `Request failed (${status})`;
    const error = new Error(message);
    error.code = code;
    error.status = status;
    error.data = errorData;
    return error;
}

/**
 * fetch() for calls to the API. When the request never reaches the server (offline, server down,
 * blocked) the browser only says "Failed to fetch"; this throws a sentence the UI can show instead,
 * with code 'NETWORK_ERROR'. A cancelled request keeps its own error.
 */
export async function apiFetch(url, init) {
    try {
        return await fetch(url, init);
    } catch (cause) {
        if (cause?.name === 'AbortError') throw cause;
        const error = new Error(NETWORK_ERROR);
        error.code = 'NETWORK_ERROR';
        error.cause = cause;
        throw error;
    }
}

/**
 * API client with automatic Firebase auth token injection.
 */
export async function apiClient(endpoint, options = {}) {
    const { auth } = await import('./firebase');
    const user = auth.currentUser;
    const normalizedEndpoint = endpoint.startsWith('/api/') ? endpoint.slice(4) : endpoint;
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

    const headers = {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
    };

    if (user) {
        const token = await user.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
    }

    const currentWorkspaceId = localStorage.getItem('kengan_current_workspace_id');
    if (currentWorkspaceId && !headers['x-workspace-id']) {
        headers['x-workspace-id'] = currentWorkspaceId;
    }

    const requestBody =
        !isFormData &&
        options.body &&
        typeof options.body === 'object' &&
        !(options.body instanceof Blob)
            ? JSON.stringify(options.body)
            : options.body;

    const response = await apiFetch(`${API_URL}${normalizedEndpoint}`, {
        ...options,
        body: requestBody,
        headers,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw buildApiError(errorData, response.status);
    }

    return response.json();
}
