import { useEffect, useState } from 'react';

/** Only the focused/hovered card animates. Respect the operating-system motion preference. */
export function usePreviewTime(active: boolean, duration = 1.8) {
    const [time, setTime] = useState(0.6);
    useEffect(() => {
        if (!active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        let raf = 0;
        let previous = 0;
        const start = performance.now();
        const tick = (now: number) => {
            if (now - previous >= 33) {
                setTime(((now - start) / 1000) % duration);
                previous = now;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [active, duration]);
    return time;
}
