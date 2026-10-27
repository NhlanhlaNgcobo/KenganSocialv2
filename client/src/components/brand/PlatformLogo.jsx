import { siFacebook, siInstagram, siTiktok, siYoutube } from 'simple-icons';

/**
 * Official platform logos (Simple Icons, CC0): the white glyph on each brand's own colour.
 * Used to identify the platform a user connects or posts to.
 */
const LOGOS = {
    youtube: { icon: siYoutube, tile: '#FF0000' },
    instagram: { icon: siInstagram, tile: 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285aeb 90%)' },
    tiktok: { icon: siTiktok, tile: '#000000' },
    facebook: { icon: siFacebook, tile: '#0866FF' },
};

/** A brand-coloured tile with the platform's logo; `className` sets the tile's size and shape. */
export default function PlatformLogo({ platform, size = 24, className = '' }) {
    const logo = LOGOS[platform];
    if (!logo) return null;
    return (
        <div className={className} style={{ background: logo.tile }} role="img" aria-label={`${logo.icon.title} logo`}>
            <svg viewBox="0 0 24 24" width={size} height={size} fill="#ffffff" aria-hidden="true">
                <path d={logo.icon.path} />
            </svg>
        </div>
    );
}
