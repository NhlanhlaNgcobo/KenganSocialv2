import { useEffect, useRef, useState } from 'react';
import { Check, Download, Globe, ImagePlus, Loader2, Trash2, X } from 'lucide-react';
import { contrast, loadGoogleFont, marketingApi } from '../../lib/marketing-api';
import { confirmDialog } from '../../lib/dialogs';

const ROLES = [
    { id: 'primary', label: 'Primary' },
    { id: 'secondary', label: 'Secondary' },
    { id: 'accent', label: 'Accent' },
    { id: 'background', label: 'Background' },
    { id: 'text', label: 'Text' },
];

const HEX = /^#[0-9a-f]{6}$/i;

function formFrom(kit) {
    return {
        name: kit.name || '',
        tagline: kit.tagline || '',
        website: kit.website || '',
        colors: Object.fromEntries(ROLES.map((r) => [r.id, kit.colors?.[r.id] || ''])),
        extra: kit.colors?.extra || [],
        fonts: { heading: kit.fonts?.heading || '', body: kit.fonts?.body || '' },
    };
}

/** Brand identity: name, logo, colours with roles, fonts. "Import from website" fills it in. */
export default function BrandKitPanel({ data, onSaved }) {
    const { kit } = data;
    const [form, setForm] = useState(() => formFrom(kit));
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);
    const [importing, setImporting] = useState(false);
    const [suggestion, setSuggestion] = useState(null);
    const [logoBusy, setLogoBusy] = useState('');
    const fileRefs = { primary: useRef(null), onDark: useRef(null) };

    // Keep the form in sync when the saved kit changes elsewhere (e.g. after a logo upload).
    const savedKey = JSON.stringify(formFrom(kit));
    const [lastSaved, setLastSaved] = useState(savedKey);
    useEffect(() => {
        if (savedKey !== lastSaved) {
            // Adopt changes saved elsewhere, but never discard the user's unsaved edits.
            setForm((current) => (JSON.stringify(current) === lastSaved ? formFrom(kit) : current));
            setLastSaved(savedKey);
        }
    }, [savedKey, lastSaved, kit]);

    useEffect(() => {
        loadGoogleFont(form.fonts.heading);
        loadGoogleFont(form.fonts.body);
    }, [form.fonts.heading, form.fonts.body]);

    const dirty = JSON.stringify(form) !== savedKey;
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    const setColor = (role, value) => setForm((f) => ({ ...f, colors: { ...f.colors, [role]: value } }));
    const textContrast = contrast(form.colors.text, form.colors.background);
    const invalid = ROLES.find((r) => form.colors[r.id] && !HEX.test(form.colors[r.id]));

    const save = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const payload = {
                name: form.name,
                tagline: form.tagline,
                website: form.website,
                colors: { ...Object.fromEntries(ROLES.map((r) => [r.id, form.colors[r.id] || null])), extra: form.extra },
                fonts: form.fonts,
            };
            const result = await marketingApi.saveBrand(payload);
            onSaved({ ...data, ...result });
            setMessage({ type: 'success', text: 'Brand kit saved.' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSaving(false);
        }
    };

    const runImport = async () => {
        if (!form.website.trim()) return setMessage({ type: 'error', text: 'Add your website address first.' });
        setImporting(true);
        setMessage(null);
        try {
            const { suggestion: s } = await marketingApi.importFromWebsite(form.website.trim());
            setSuggestion({ ...s, chosenLogo: s.logos[0]?.dataUrl || null });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setImporting(false);
        }
    };

    const applySuggestion = async () => {
        const s = suggestion;
        setForm((f) => ({
            ...f,
            name: f.name || s.name,
            tagline: f.tagline || s.tagline,
            website: s.url || f.website,
            colors: Object.fromEntries(ROLES.map((r) => [r.id, s.colors[r.id] || f.colors[r.id] || ''])),
            extra: s.colors.extra || f.extra,
            fonts: { heading: s.fonts.heading || f.fonts.heading, body: s.fonts.body || f.fonts.body },
        }));
        setSuggestion(null);
        setMessage({ type: 'success', text: 'Imported. Check the colours and fonts, then save.' });
        if (s.chosenLogo) {
            setLogoBusy('primary');
            try {
                const result = await marketingApi.uploadLogo(s.chosenLogo, 'primary');
                onSaved({ ...data, ...result });
            } catch (err) {
                setMessage({ type: 'error', text: `Logo: ${err.message}` });
            } finally {
                setLogoBusy('');
            }
        }
    };

    const uploadLogo = async (variant, file) => {
        if (!file) return;
        setLogoBusy(variant);
        setMessage(null);
        try {
            const result = await marketingApi.uploadLogo(file, variant);
            onSaved({ ...data, ...result });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setLogoBusy('');
        }
    };

    const removeLogo = async (variant) => {
        if (!(await confirmDialog('Remove this logo?', { confirmLabel: 'Remove', danger: true }))) return;
        setLogoBusy(variant);
        try {
            const result = await marketingApi.removeLogo(variant);
            onSaved({ ...data, ...result });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setLogoBusy('');
        }
    };

    return (
        <section className="surface marketing-section">
            <div className="marketing-section__head">
                <div>
                    <h3>Brand kit</h3>
                    <p className="muted">Used by every carousel, ad and post the app makes for you.</p>
                </div>
            </div>

            <div className="field-row">
                <label className="field">
                    <span>Brand name</span>
                    <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} />
                </label>
                <label className="field">
                    <span>
                        Tagline <em>optional</em>
                    </span>
                    <input className="input" value={form.tagline} onChange={(e) => set({ tagline: e.target.value })} maxLength={200} />
                </label>
            </div>

            <div className="field">
                <span>Website</span>
                <div className="marketing-inline">
                    <input className="input" placeholder="yourbrand.co.za" value={form.website} onChange={(e) => set({ website: e.target.value })} maxLength={120} />
                    <button className="btn btn-secondary" onClick={runImport} disabled={importing || !form.website.trim()}>
                        {importing ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
                        {importing ? 'Reading your site…' : 'Import from website'}
                    </button>
                </div>
                <small>Fills in your logo, colours and fonts from your site. Takes about 30 seconds; you review everything before saving.</small>
            </div>

            {suggestion ? <ImportReview suggestion={suggestion} setSuggestion={setSuggestion} onApply={applySuggestion} /> : null}

            <div className="field">
                <span>Logo</span>
                <div className="marketing-logos">
                    {[
                        { id: 'primary', label: 'Main logo', hint: 'On light backgrounds' },
                        { id: 'onDark', label: 'On dark', hint: 'Optional, for dark slides' },
                    ].map((v) => (
                        <div key={v.id} className={`marketing-logo ${v.id === 'onDark' ? 'is-dark' : ''}`}>
                            {kit.logo?.[v.id] ? <img src={kit.logo[v.id]} alt={`${v.label}`} /> : <ImagePlus size={22} />}
                            <div className="marketing-logo__meta">
                                <strong>{v.label}</strong>
                                <small>{v.hint}</small>
                            </div>
                            <input ref={fileRefs[v.id]} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => {
                                    uploadLogo(v.id, e.target.files?.[0]);
                                    e.target.value = '';
                                }}
                            />
                            <div className="marketing-logo__actions">
                                <button className="btn btn-ghost btn-sm" onClick={() => fileRefs[v.id].current?.click()} disabled={!!logoBusy}>
                                    {logoBusy === v.id ? <Loader2 size={14} className="spin" /> : null} {kit.logo?.[v.id] ? 'Replace' : 'Upload'}
                                </button>
                                {kit.logo?.[v.id] ? (
                                    <button className="btn btn-ghost btn-sm" onClick={() => removeLogo(v.id)} disabled={!!logoBusy} aria-label={`Remove ${v.label}`}>
                                        <Trash2 size={14} />
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    ))}
                </div>
                <small>PNG, JPG, WebP or SVG up to 5 MB. A transparent PNG or SVG works best.</small>
            </div>

            <div className="field">
                <span>Colours</span>
                <div className="marketing-colors">
                    {ROLES.map((r) => (
                        <label key={r.id} className="marketing-color">
                            <input
                                type="color"
                                value={HEX.test(form.colors[r.id]) ? form.colors[r.id] : '#000000'}
                                onChange={(e) => setColor(r.id, e.target.value)}
                                aria-label={`${r.label} colour picker`}
                            />
                            <span>{r.label}</span>
                            <input className="input" value={form.colors[r.id]} placeholder="#000000" onChange={(e) => setColor(r.id, e.target.value.trim())} maxLength={7} aria-label={`${r.label} hex`} />
                        </label>
                    ))}
                </div>
                {form.extra.length ? (
                    <div className="marketing-extra">
                        <small>Also on your site (click to use as accent):</small>
                        {form.extra.map((hex) => (
                            <button key={hex} className="marketing-chip-swatch" style={{ background: hex }} title={hex} onClick={() => setColor('accent', hex)} />
                        ))}
                    </div>
                ) : null}
                {invalid ? <small className="is-error">{invalid.label} must be a colour like #1a2b3c.</small> : null}
                {textContrast !== null ? (
                    <small className={textContrast < 4.5 ? 'is-error' : ''}>
                        Text on background contrast {textContrast}:1 {textContrast >= 4.5 ? '(readable)' : '(too low; aim for 4.5:1 or more)'}
                    </small>
                ) : null}
            </div>

            <div className="field-row">
                <label className="field">
                    <span>Heading font</span>
                    <input className="input" placeholder="e.g. Poppins" value={form.fonts.heading} onChange={(e) => set({ fonts: { ...form.fonts, heading: e.target.value } })} maxLength={60} />
                    <small style={{ fontFamily: form.fonts.heading ? `"${form.fonts.heading}", sans-serif` : undefined, fontSize: '1rem', fontWeight: 700 }}>The quick brown fox</small>
                </label>
                <label className="field">
                    <span>Body font</span>
                    <input className="input" placeholder="e.g. Inter" value={form.fonts.body} onChange={(e) => set({ fonts: { ...form.fonts, body: e.target.value } })} maxLength={60} />
                    <small style={{ fontFamily: form.fonts.body ? `"${form.fonts.body}", sans-serif` : undefined, fontSize: '0.95rem' }}>Jumps over the lazy dog</small>
                </label>
            </div>
            <small className="muted">Any Google Font name works and previews here. Custom fonts are kept by name and fall back to a similar font when rendering.</small>

            {message ? <div className={message.type === 'error' ? 'error-banner' : 'success-banner'}>{message.text}</div> : null}

            <div className="marketing-actions">
                <button className="btn btn-primary" onClick={save} disabled={!dirty || saving || !!invalid}>
                    {saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {saving ? 'Saving…' : 'Save brand kit'}
                </button>
                {dirty ? (
                    <button className="btn btn-ghost" onClick={() => setForm(formFrom(kit))} disabled={saving}>
                        Discard changes
                    </button>
                ) : null}
            </div>
        </section>
    );
}

function ImportReview({ suggestion: s, setSuggestion, onApply }) {
    return (
        <div className="marketing-import">
            <div className="marketing-import__head">
                <strong>
                    <Globe size={15} /> Found on {new URL(s.url).hostname}
                </strong>
                <button className="btn btn-ghost btn-sm" onClick={() => setSuggestion(null)} aria-label="Close">
                    <X size={15} />
                </button>
            </div>
            {s.logos.length ? (
                <div className="field">
                    <span>Choose your logo</span>
                    <div className="marketing-logo-picks">
                        {s.logos.map((l) => (
                            <button
                                key={l.dataUrl.slice(0, 80) + l.source}
                                className={`marketing-logo-pick ${s.chosenLogo === l.dataUrl ? 'is-active' : ''}`}
                                onClick={() => setSuggestion({ ...s, chosenLogo: s.chosenLogo === l.dataUrl ? null : l.dataUrl })}
                            >
                                <img src={l.dataUrl} alt="" />
                                <small>{l.source}</small>
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                <small className="muted">No logo found; upload one below.</small>
            )}
            <div className="field">
                <span>Colours</span>
                <div className="marketing-import__colors">
                    {ROLES.filter((r) => s.colors[r.id]).map((r) => (
                        <span key={r.id}>
                            <i style={{ background: s.colors[r.id] }} /> {r.label} <code>{s.colors[r.id]}</code>
                        </span>
                    ))}
                </div>
            </div>
            <div className="field">
                <span>Fonts</span>
                <small>
                    Headings: {s.fonts.heading || 'not found'} · Body: {s.fonts.body || 'not found'}
                </small>
            </div>
            {s.socials.length ? (
                <div className="field">
                    <span>Social profiles found</span>
                    <small>{s.socials.map((x) => x.platform).join(', ')}</small>
                </div>
            ) : null}
            <div className="marketing-actions">
                <button className="btn btn-primary btn-sm" onClick={onApply}>
                    <Check size={14} /> Use these
                </button>
                <small className="muted">You can change anything before saving.</small>
            </div>
        </div>
    );
}
