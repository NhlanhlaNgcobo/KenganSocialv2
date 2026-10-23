import { useEffect, useRef } from 'react';
import { useVisibleAnimation } from '../../components/performance/useVisibleAnimation';

/**
 * A short, muted, looping clip from /landing (real KenganSocial output). It loads only when it
 * scrolls into view and pauses when it leaves; with reduced motion it stays on its poster frame.
 */
export default function LoopVideo({ name, className = '', label, eager = false }) {
    const ref = useRef(null);
    const active = useVisibleAnimation(ref);
    useEffect(() => {
        const video = ref.current;
        if (!video) return;
        if (active) video.play().catch(() => {});
        else video.pause();
    }, [active]);

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
