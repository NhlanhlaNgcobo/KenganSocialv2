const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

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

    const response = await fetch(`${API_URL}${normalizedEndpoint}`, {
        ...options,
        body: requestBody,
        headers,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API Error: ${response.status}`);
    }

    return response.json();
}
