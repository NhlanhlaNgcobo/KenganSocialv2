import { useEffect, useRef, useState } from 'react';

/**
 * A short, muted, looping clip from /landing (real KenganSocial output). It loads only when it
 * scrolls into view and pauses when it leaves; with reduced motion it stays on its poster frame.
 */
export default function LoopVideo({ name, className = '', label, eager = false }) {
    const ref = useRef(null);
    const [reduce] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));

    useEffect(() => {
        const video = ref.current;
        if (!video || reduce) return undefined;
        const play = () => video.play().catch(() => {});
        if (typeof IntersectionObserver === 'undefined') {
            play();
            return undefined;
        }
        const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? play() : video.pause()), { threshold: 0.15 });
        io.observe(video);
        return () => io.disconnect();
    }, [reduce]);

    return (
        <video
            ref={ref}
            className={className}
            src={`/landing/${name}.mp4`}
            poster={`/landing/${name}.jpg`}
            muted
            loop
            playsInline
            preload={eager ? 'auto' : 'none'}
            aria-label={label}
            aria-hidden={label ? undefined : 'true'}
        />
    );
}
