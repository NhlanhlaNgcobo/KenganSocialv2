import { useEffect, useState } from 'react';

/** Animate only visible content while the tab is active and motion is permitted. */
export function useVisibleAnimation(ref) {
    const [active, setActive] = useState(false);
    useEffect(() => {
        const node = ref.current;
        if (!node) return undefined;
        const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
        let visible = !window.IntersectionObserver;
        const update = () => setActive(visible && !document.hidden && !preference.matches);
        const observer = window.IntersectionObserver ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            update();
        }) : null;
        observer?.observe(node);
        document.addEventListener('visibilitychange', update);
        preference.addEventListener('change', update);
        update();
        return () => {
            observer?.disconnect();
            document.removeEventListener('visibilitychange', update);
            preference.removeEventListener('change', update);
        };
    }, [ref]);
    return active;
}
