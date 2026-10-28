import { useSyncExternalStore } from 'react';

/** True while the CSS media query matches; follows resizes and rotation. */
export function useMediaQuery(query) {
    return useSyncExternalStore(
        (onChange) => {
            const list = window.matchMedia(query);
            list.addEventListener('change', onChange);
            return () => list.removeEventListener('change', onChange);
        },
        () => window.matchMedia(query).matches,
        () => false
    );
}

/** Phones: the dashboard menu becomes a drawer (matches the 768px breakpoint in the layout CSS). */
export const PHONE_QUERY = '(max-width: 768px)';
