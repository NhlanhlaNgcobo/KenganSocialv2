import { useEffect } from 'react';
import { loadGoogleFont } from '../../lib/marketing-api';

/**
 * A sample 4:5 slide drawn with the saved brand kit, so users see their kit the way
 * carousels will use it. Brand colours appear only here, never in the app's own UI.
 */
export default function BrandPreview({ kit }) {
    const c = kit.colors || {};
    const bg = c.background || '#ffffff';
    const fg = c.text || '#111111';
    const primary = c.primary || fg;
    const accent = c.accent || c.secondary || primary;
    const heading = kit.fonts?.heading;
    const body = kit.fonts?.body;

    useEffect(() => {
        loadGoogleFont(heading);
        loadGoogleFont(body);
    }, [heading, body]);

    return (
        <section className="surface marketing-preview-card">
            <h3>Preview</h3>
            <div className="marketing-preview" style={{ background: bg, color: fg, fontFamily: body ? `"${body}", system-ui, sans-serif` : undefined }}>
                <div className="marketing-preview__bar" style={{ background: primary }} />
                {kit.logo?.primary ? <img className="marketing-preview__logo" src={kit.logo.primary} alt="" /> : <span className="marketing-preview__logo-text">{kit.name || 'Your brand'}</span>}
                <div className="marketing-preview__kicker" style={{ color: accent }}>
                    3 tips
                </div>
                <div className="marketing-preview__title" style={{ fontFamily: heading ? `"${heading}", system-ui, sans-serif` : undefined, color: primary }}>
                    {kit.tagline || 'Your headline in your brand fonts'}
                </div>
                <p className="marketing-preview__body">This is how carousel slides will use your colours, fonts and logo.</p>
                <span className="marketing-preview__cta" style={{ background: primary, color: bg }}>
                    Learn more
                </span>
                <div className="marketing-preview__dots">
                    {[0, 1, 2, 3].map((i) => (
                        <i key={i} style={{ background: i === 0 ? primary : fg, opacity: i === 0 ? 1 : 0.25 }} />
                    ))}
                </div>
            </div>
        </section>
    );
}
