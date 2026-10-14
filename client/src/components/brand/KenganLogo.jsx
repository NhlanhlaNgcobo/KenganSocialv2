import { useId } from 'react';
import './KenganLogo.css';

/**
 * Kengan Social mark: a calendar block (scheduling) forms the K's stem, a silver
 * ribbon forms the upper arm, and a play tile (video) forms the lower leg.
 * Solid parts follow --text-primary so the mark inverts between dark and light
 * themes; the ribbon stays silver. Concept art: /brand/kengan-logo-concept.jpg.
 */
export function KenganMark({ size = 28, title = 'KenganSocial' }) {
    const id = useId().replace(/:/g, '');
    const ribbon = `${id}-ribbon`;
    const sheen = `${id}-sheen`;
    const baseline = `${id}-baseline`;

    return (
        <svg className="kengan-mark" viewBox="6 4 118 94" height={size} role="img" aria-label={title}>
            <defs>
                <linearGradient id={ribbon} x1="0" y1="1" x2="1" y2="0">
                    <stop offset="0%" stopColor="#85858b" />
                    <stop offset="45%" stopColor="#f2f2f4" />
                    <stop offset="70%" stopColor="#b8b8be" />
                    <stop offset="100%" stopColor="#7a7a80" />
                </linearGradient>
                <linearGradient id={sheen} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="100%" stopColor="#9a9aa0" />
                </linearGradient>
                <clipPath id={baseline}>
                    <rect x="0" y="0" width="128" height="96" />
                </clipPath>
            </defs>

            {/* Calendar stem */}
            <rect x="10" y="14" width="40" height="82" rx="9" className="kengan-mark__solid" />
            <rect x="19" y="6" width="5" height="15" rx="2.5" fill={`url(#${sheen})`} />
            <rect x="36" y="6" width="5" height="15" rx="2.5" fill={`url(#${sheen})`} />
            <rect x="18" y="28" width="9" height="9" rx="2" className="kengan-mark__detail" />
            <rect x="32" y="28" width="9" height="9" rx="2" className="kengan-mark__detail" />
            <rect x="18" y="42" width="9" height="9" rx="2" className="kengan-mark__detail" />
            <rect x="32" y="42" width="9" height="9" rx="2" className="kengan-mark__detail" />

            {/* Play-tile leg */}
            <g transform="translate(8 0)">
                <path
                    d="M66 52h14c3 0 5.6 1.3 7.5 3.6l24 28.6c3.6 4.3.6 10.8-5 10.8H84c-3 0-5.8-1.4-7.6-3.8L59.6 68.6C55.4 63 59.4 52 66 52Z"
                    className="kengan-mark__solid"
                />
                <path d="M86 66.5v15l12.5-7.5Z" className="kengan-mark__play" />
            </g>

            {/* Silver ribbon arm, with a background-coloured cut line around it */}
            <g clipPath={`url(#${baseline})`}>
                <line x1="46" y1="90" x2="100" y2="20" strokeWidth="31" strokeLinecap="round" className="kengan-mark__cut" />
                <line x1="46" y1="90" x2="100" y2="20" strokeWidth="24" strokeLinecap="round" stroke={`url(#${ribbon})`} />
            </g>
        </svg>
    );
}

/** Mark plus "Kengansocial" wordmark, matching the concept's two-weight lockup. */
export function KenganLogo({ size = 28, showWordmark = true }) {
    return (
        <span className="kengan-logo">
            <KenganMark size={size} />
            {showWordmark ? (
                <span className="kengan-logo__word">
                    <span className="kengan-logo__word-strong">Kengan</span>
                    <span className="kengan-logo__word-light">social</span>
                </span>
            ) : null}
        </span>
    );
}
