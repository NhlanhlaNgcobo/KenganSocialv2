const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

/**
 * API client with automatic Firebase auth token injection.
 */
export async function apiClient(endpoint, options = {}) {
    const { auth } = await import('./firebase');
    const user = auth.currentUser;

    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (user) {
        const token = await user.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API Error: ${response.status}`);
    }

    return response.json();
}
