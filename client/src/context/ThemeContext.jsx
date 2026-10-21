import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/*
 * Theme preference: 'light' | 'dark' | 'system'.
 * - preference: what the user chose (persisted in localStorage 'kengan-theme').
 * - theme: the resolved theme actually applied ('light' | 'dark').
 * 'system' follows prefers-color-scheme and reacts to OS changes.
 * The inline script in index.html applies the same logic before React mounts (no flash).
 */
const STORAGE_KEY = 'kengan-theme';
const PREFERENCES = ['light', 'dark', 'system'];
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

const ThemeContext = createContext(null);

function readStoredPreference() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        // Dark until the person picks another theme.
        return PREFERENCES.includes(saved) ? saved : 'dark';
    } catch {
        return 'dark';
    }
}

function getSystemTheme() {
    if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
    return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
    const [preference, setPreferenceState] = useState(readStoredPreference);
    const [systemTheme, setSystemTheme] = useState(getSystemTheme);

    const theme = preference === 'system' ? systemTheme : preference;

    // Follow OS changes while the preference is 'system'.
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return undefined;
        const mql = window.matchMedia(MEDIA_QUERY);
        const onChange = (e) => setSystemTheme(e.matches ? 'dark' : 'light');
        if (mql.addEventListener) mql.addEventListener('change', onChange);
        else mql.addListener(onChange);
        return () => {
            if (mql.removeEventListener) mql.removeEventListener('change', onChange);
            else mql.removeListener(onChange);
        };
    }, []);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, preference);
        } catch {
            /* storage unavailable: preference lasts for this session only */
        }
    }, [preference]);

    const setPreference = useCallback((next) => {
        if (PREFERENCES.includes(next)) setPreferenceState(next);
    }, []);

    // Explicit flip between light and dark (sidebar icon button).
    const toggleTheme = useCallback(() => {
        setPreferenceState(theme === 'dark' ? 'light' : 'dark');
    }, [theme]);

    return (
        <ThemeContext.Provider value={{ theme, preference, setPreference, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its provider
export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
