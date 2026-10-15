import { useEffect } from 'react';

/**
 * Adds `is-visible` to every [data-reveal] element inside `rootRef` the first time it scrolls
 * into view (CSS does the animation). Elements are shown at once without IntersectionObserver.
 */
export function useReveal(rootRef) {
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return undefined;
        const items = [...root.querySelectorAll('[data-reveal]')];
        if (typeof IntersectionObserver === 'undefined') {
            items.forEach((el) => el.classList.add('is-visible'));
            return undefined;
        }
        const io = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    entry.target.classList.add('is-visible');
                    io.unobserve(entry.target);
                }
            },
            { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
        );
        items.forEach((el) => io.observe(el));
        return () => io.disconnect();
    }, [rootRef]);
}
