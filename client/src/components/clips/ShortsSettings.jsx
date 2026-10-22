import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CAPTION_TEMPLATES, LAYOUTS, RATIOS, SHORT_LENGTHS, SHORT_PLATFORMS } from './shorts-options';
import { marketingApi } from '../../lib/marketing-api';
import './ShortsSettings.css';

/**
 * Settings for turning a long video into shorts: where they are going, how faces are
 * framed, the caption template and extras.
 */

const ORDER = ['short', 'medium', 'long'];

/**
 * "Apply my brand": the brand kit's logo goes on each clip and its colour on the captions, hook card
 * and progress bar (like brand templates in other clip tools). Off when there's no kit yet.
 */
function BrandCheck({ checked, onChange }) {
    const [kit, setKit] = useState(undefined);
    useEffect(() => {
        let active = true;
        marketingApi
            .brand()
            .then((d) => active && setKit(d?.kit || null))
            .catch(() => active && setKit(null));
        return () => {
            active = false;
        };
    }, []);
    const colour = kit && [kit.colors?.accent, kit.colors?.primary, kit.colors?.secondary].find(Boolean);
    const logo = kit?.logo?.primary;
    const ready = Boolean(colour || logo);
    return (
        <div className="ss-brand">
            <label className="check">
                <input type="checkbox" checked={ready && checked} disabled={!ready} onChange={(e) => onChange({ brand: e.target.checked })} />
                Apply my brand: logo in the corner, captions and bar in my colour
            </label>
            {ready ? (
                <span className="ss-brand__kit" aria-label="Your brand">
                    {logo ? <img src={logo} alt="" /> : null}
                    {colour ? <i style={{ background: colour }} /> : null}
                </span>
            ) : kit !== undefined ? (
                <Link to="/dashboard/marketing?tab=brand" className="ss-brand__setup">
                    Set up your brand kit
                </Link>
            ) : null}
        </div>
    );
}

function CaptionSample({ template }) {
    if (template.id === 'none') return <span className="ss-caption__none">Clean video</span>;
    const words = template.single ? ['THIS'] : ['This', 'changed', 'everything'];
    const style = {
        fontFamily: template.font,
        fontWeight: template.weight,
        color: template.color,
        textTransform: template.upper ? 'uppercase' : 'none',
        WebkitTextStroke: template.stroke ? `1.5px ${template.stroke}` : undefined,
        paintOrder: 'stroke fill',
        textShadow: template.glow ? `0 0 6px ${template.glow}, 0 0 12px ${template.glow}` : template.shadow ? '0 2px 4px rgba(0,0,0,0.7)' : undefined,
        background: template.box,
    };
    return (
        <span className={`ss-caption__text ${template.box ? 'has-box' : ''}`} style={style}>
            {words.map((w, i) => (
                <span key={w} style={i === 1 && template.active ? { color: template.active } : template.fill && i === 0 ? { color: template.active } : undefined}>
                    {w}
                    {i < words.length - 1 ? ' ' : ''}
                </span>
            ))}
        </span>
    );
}

function LayoutIcon({ id }) {
    // Tiny 9:16 frame diagrams.
    const face = (cx, cy, r = 4) => <circle cx={cx} cy={cy} r={r} />;
    return (
        <svg viewBox="0 0 28 48" className="ss-layout__icon" aria-hidden="true">
            <rect x="1" y="1" width="26" height="46" rx="3" className="ss-layout__frame" />
            {id === 'split' ? (
                <>
                    <line x1="1" y1="24" x2="27" y2="24" className="ss-layout__line" />
                    {face(14, 11)}
                    {face(14, 35)}
                </>
            ) : id === 'fit' ? (
                <>
                    <rect x="1" y="16" width="26" height="16" className="ss-layout__band" />
                    {face(9, 23, 2.5)}
                    {face(19, 23, 2.5)}
                </>
            ) : id === 'track' ? (
                <>
                    {face(14, 18, 6)}
                    <path d="M6 40 h16" className="ss-layout__line" />
                </>
            ) : (
                <>
                    {face(14, 16, 5)}
                    <text x="14" y="38" textAnchor="middle" className="ss-layout__auto">
                        A
                    </text>
                </>
            )}
        </svg>
    );
}

/**
 * @param {{ value: object, onChange: (patch: object) => void, disabled?: boolean, countLabel?: string }} props
 * value.platform starts as null: the platform question is asked first and the rest unlocks after.
 */
export default function ShortsSettings({ value, onChange, disabled = false, countLabel = 'Number of clips' }) {
    const platform = SHORT_PLATFORMS.find((p) => p.id === value.platform);
    const maxIndex = ORDER.indexOf(platform?.maxLength || 'long');

    const pickPlatform = (p) => {
        const patch = { platform: p.id };
        if (ORDER.indexOf(value.length) > ORDER.indexOf(p.maxLength)) patch.length = p.maxLength;
        if (p.id !== 'custom') patch.ratio = '9:16';
        onChange(patch);
    };

    return (
        <div className="ss">
            <div className="field">
                <span>Where are these shorts going?</span>
                <div className="ss-platforms" role="radiogroup" aria-label="Platform">
                    {SHORT_PLATFORMS.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            role="radio"
                            aria-checked={value.platform === p.id}
                            className={`ss-platform ${value.platform === p.id ? 'is-active' : ''}`}
                            onClick={() => pickPlatform(p)}
                            disabled={disabled}
                        >
                            <p.icon size={18} />
                            <strong>{p.label}</strong>
                            <small>{p.hint}</small>
                        </button>
                    ))}
                </div>
                {!platform ? <small>Choose one to set the shape, length and caption position for that app.</small> : null}
            </div>

            <fieldset className="ss-rest" disabled={disabled || !platform}>
                <div className="field-row">
                    <div className="field">
                        <span>{countLabel}</span>
                        <div className="segmented">
                            {[3, 5, 8, 10].map((n) => (
                                <button type="button" key={n} className={value.count === n ? 'is-active' : ''} onClick={() => onChange({ count: n })}>
                                    {n}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="field">
                        <span>Clip length</span>
                        <div className="segmented">
                            {SHORT_LENGTHS.map((l, i) => (
                                <button
                                    type="button"
                                    key={l.id}
                                    className={value.length === l.id ? 'is-active' : ''}
                                    onClick={() => onChange({ length: l.id })}
                                    disabled={i > maxIndex}
                                    title={i > maxIndex ? `Too long for ${platform?.label}` : undefined}
                                >
                                    {l.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    {value.platform === 'custom' ? (
                        <div className="field">
                            <span>Shape</span>
                            <div className="segmented">
                                {RATIOS.map((r) => (
                                    <button type="button" key={r.id} className={value.ratio === r.id ? 'is-active' : ''} onClick={() => onChange({ ratio: r.id })} title={r.hint}>
                                        {r.id}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>

                <div className="field">
                    <span>Framing</span>
                    <div className="ss-layouts">
                        {LAYOUTS.map((l) => (
                            <button type="button" key={l.id} className={`ss-layout ${value.layout === l.id ? 'is-active' : ''}`} onClick={() => onChange({ layout: l.id })} title={l.description}>
                                <LayoutIcon id={l.id} />
                                <span>
                                    <strong>{l.label}</strong>
                                    <small>{l.description}</small>
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="field">
                    <span>Caption template</span>
                    <div className="ss-captions">
                        {CAPTION_TEMPLATES.map((t) => (
                            <button type="button" key={t.id} className={`ss-caption ${value.captionStyle === t.id ? 'is-active' : ''}`} onClick={() => onChange({ captionStyle: t.id })}>
                                <span className="ss-caption__stage">
                                    <CaptionSample template={t} />
                                </span>
                                <small>{t.label}</small>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="ss-checks">
                    <label className="check">
                        <input type="checkbox" checked={value.hookTitle} onChange={(e) => onChange({ hookTitle: e.target.checked })} />
                        Hook title card for the first 3 seconds
                    </label>
                    <label className="check">
                        <input type="checkbox" checked={value.progressBar} onChange={(e) => onChange({ progressBar: e.target.checked })} />
                        Progress bar along the bottom
                    </label>
                    <BrandCheck checked={Boolean(value.brand)} onChange={onChange} />
                </div>
            </fieldset>
        </div>
    );
}
