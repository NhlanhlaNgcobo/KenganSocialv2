import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, ImagePlus, Loader2, Pencil, Plus, Trash2, Wand2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { marketingApi, pollUntilDone } from '../../lib/marketing-api';
import { confirmDialog } from '../../lib/dialogs';

const GOAL_LABELS = { sales: 'Sales', leads: 'Leads', traffic: 'Website visits', awareness: 'Awareness', launch: 'Launch' };
const LAYOUT_LABELS = { scene: 'Scene', product: 'Product', split: 'Split', offer: 'Offer', testimonial: 'Testimonial', bold: 'Bold text' };
const FORMAT_LABELS = { '1:1': 'Square 1:1', '4:5': 'Feed 4:5', '9:16': 'Story / TikTok 9:16' };
const IMAGERY = [
    { id: 'none', label: 'No AI backdrop', hint: 'Your product photo on your brand colours. No image credits.' },
    { id: 'free', label: 'Free AI backdrop', hint: 'Open-source FLUX scene behind your product.' },
    { id: 'best', label: 'Best AI backdrop', hint: 'Top-ranked image model. Uses more credits.' },
];

async function downloadUrl(url, name) {
    const res = await fetch(url);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
}

const safeName = (s) => String(s || 'ad').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ad';

/** Image Ad Studio: single-image ads in several sizes, from a product photo and an idea. */
export default function AdStudio({ kit, initialSwipeId = null }) {
    const { plan } = useAuth();
    const locked = plan === 'starter';
    const [options, setOptions] = useState(null);
    const [list, setList] = useState([]);
    const [swipes, setSwipes] = useState([]);
    const [form, setForm] = useState({ productName: '', productDescription: '', idea: '', goal: 'sales', formats: ['1:1', '4:5', '9:16'], count: 3, imagery: 'none', swipeId: initialSwipeId });
    const [photo, setPhoto] = useState(null);
    const [active, setActive] = useState(null);
    const [error, setError] = useState('');
    const [starting, setStarting] = useState(false);

    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    const refreshList = useCallback(() => marketingApi.adSets().then((d) => setList(d.sets)).catch(() => {}), []);

    useEffect(() => {
        if (locked) return;
        marketingApi.adOptions().then(setOptions).catch((err) => setError(err.message));
        marketingApi.competitors().then((d) => setSwipes(d.swipes)).catch(() => {});
        refreshList();
    }, [locked, refreshList]);

    const photoUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
    useEffect(() => () => photoUrl && URL.revokeObjectURL(photoUrl), [photoUrl]);

    const watch = useCallback(
        async (id) => {
            try {
                const final = await pollUntilDone(async () => (await marketingApi.adSet(id)).set, setActive);
                if (final.status === 'failed') setError(final.error || 'The ads could not be made.');
            } catch (err) {
                setError(err.message);
            } finally {
                refreshList();
            }
        },
        [refreshList]
    );

    const credits = options ? 1 + (form.swipeId ? 1 : 0) + form.count * (options.credits?.[form.imagery] || 0) : null;
    const swipe = swipes.find((s) => s.id === form.swipeId);

    const create = async () => {
        setError('');
        setStarting(true);
        try {
            const body = new FormData();
            if (photo) body.append('product', photo);
            for (const key of ['productName', 'productDescription', 'idea', 'goal', 'imagery']) body.append(key, form[key]);
            body.append('formats', form.formats.join(','));
            body.append('count', String(form.count));
            if (form.swipeId) body.append('swipeId', form.swipeId);
            const { id } = await marketingApi.createAdSet(body);
            setActive({ id, status: 'running', stage: 'Starting', progress: 3, ads: [], settings: { formats: form.formats } });
            watch(id);
        } catch (err) {
            setError(err.message);
        } finally {
            setStarting(false);
        }
    };

    const open = async (id) => {
        setError('');
        try {
            const { set: s } = await marketingApi.adSet(id);
            setActive(s);
            if (s.status === 'running') watch(id);
        } catch (err) {
            setError(err.message);
        }
    };

    if (locked) {
        return (
            <section className="surface marketing-coming">
                <h2>Image ads</h2>
                <p className="muted">Make on-brand ads for Facebook, Instagram and TikTok from a product photo: several angles to test, in every size, with the ad text written for you.</p>
                <Link className="btn btn-primary" to="/dashboard/billing">
                    See plans
                </Link>
            </section>
        );
    }

    const toggleFormat = (id) => set({ formats: form.formats.includes(id) ? form.formats.filter((f) => f !== id) : [...form.formats, id] });
    const canSubmit = options?.aiAvailable && !starting && active?.status !== 'running' && form.formats.length > 0 && (photo || form.productName.trim() || form.idea.trim().length >= 3);

    return (
        <div className="marketing-studio">
            <section className="surface marketing-section marketing-studio__form">
                <div className="marketing-section__head">
                    <div>
                        <h3>New image ads</h3>
                        <p className="muted">Different angles to test, in your brand, in every size.</p>
                    </div>
                </div>

                <div className="field">
                    <span>
                        Product photo <em>optional</em>
                    </span>
                    {photo ? (
                        <div className="ad-photo">
                            <img src={photoUrl} alt="" />
                            <div>
                                <strong>{photo.name}</strong>
                                <small className="muted">A plain background is removed automatically.</small>
                            </div>
                            <button className="btn-icon btn-ghost" onClick={() => setPhoto(null)} aria-label="Remove product photo">
                                <X size={16} />
                            </button>
                        </div>
                    ) : (
                        <label className="ad-photo ad-photo--empty">
                            <ImagePlus size={18} />
                            <span>Choose a photo (JPG, PNG or WebP)</span>
                            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && setPhoto(e.target.files[0])} />
                        </label>
                    )}
                </div>

                <div className="field-row">
                    <label className="field">
                        <span>Product name</span>
                        <input className="input" value={form.productName} onChange={(e) => set({ productName: e.target.value })} maxLength={80} placeholder="e.g. Vitamin C serum" />
                    </label>
                </div>
                <label className="field">
                    <span>What should the ad say?</span>
                    <textarea className="input" rows={3} value={form.idea} onChange={(e) => set({ idea: e.target.value })} maxLength={500} placeholder="Your offer, price or message, e.g. 30% off this weekend, free delivery in Durban" />
                    <small className="muted">Prices and offers you write here are used as-is; the AI never invents them.</small>
                </label>

                <div className="field">
                    <span>Goal</span>
                    <div className="marketing-words">
                        {(options?.goals || []).map((g) => (
                            <button key={g.id} className={`chip ${form.goal === g.id ? 'is-active' : ''}`} title={g.description} onClick={() => set({ goal: g.id })}>
                                {GOAL_LABELS[g.id] || g.id}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="field">
                    <span>Sizes</span>
                    <div className="marketing-words">
                        {(options?.formats || []).map((f) => (
                            <button key={f.id} className={`chip ${form.formats.includes(f.id) ? 'is-active' : ''}`} aria-pressed={form.formats.includes(f.id)} onClick={() => toggleFormat(f.id)}>
                                {FORMAT_LABELS[f.id] || f.id}
                            </button>
                        ))}
                    </div>
                </div>

                <label className="field">
                    <span>Concepts to test</span>
                    <select className="input" value={form.count} onChange={(e) => set({ count: Number(e.target.value) })}>
                        {[1, 2, 3, 4, 5, 6].map((n) => (
                            <option key={n} value={n}>
                                {n} {n === 1 ? 'ad' : 'different ads'}
                            </option>
                        ))}
                    </select>
                </label>

                <div className="field">
                    <span>Background</span>
                    <div className="marketing-imagery">
                        {IMAGERY.map((i) => {
                            const available = options?.imagery?.[i.id];
                            return (
                                <label key={i.id} className={`marketing-imagery__opt ${form.imagery === i.id ? 'is-active' : ''} ${available ? '' : 'is-disabled'}`}>
                                    <input type="radio" name="ad-imagery" checked={form.imagery === i.id} disabled={!available} onChange={() => set({ imagery: i.id })} />
                                    <strong>{i.label}</strong>
                                    <small>{available ? i.hint : 'Not set up on the server yet.'}</small>
                                </label>
                            );
                        })}
                    </div>
                </div>

                <div className="field">
                    <span>
                        Recreate a format you like <em>optional</em>
                    </span>
                    {swipes.length ? (
                        <div className="ad-swipe-pick">
                            {swipes.slice(0, 12).map((s) => (
                                <button key={s.id} className={form.swipeId === s.id ? 'is-active' : ''} onClick={() => set({ swipeId: form.swipeId === s.id ? null : s.id })} aria-pressed={form.swipeId === s.id} title={s.competitor || 'Saved ad'}>
                                    <img src={s.previewUrl} alt={s.competitor ? `Ad from ${s.competitor}` : 'Saved ad'} />
                                </button>
                            ))}
                        </div>
                    ) : (
                        <small className="muted">
                            Save ads you like on the <Link to="/dashboard/marketing?tab=competitors">Competitors</Link> tab, then rebuild their format with your brand.
                        </small>
                    )}
                    {swipe ? <small className="muted">Uses its layout and hook style only, never their brand, words or images.</small> : null}
                </div>

                {!kit.colors?.primary || !kit.logo?.primary ? (
                    <div className="notice">
                        Ads use your brand kit's colours, fonts and logo. <Link to="/dashboard/marketing?tab=brand">Finish your brand kit</Link> first for ads that look like yours.
                    </div>
                ) : null}
                {options && !options.aiAvailable ? <div className="error-banner">AI is not set up on the server yet. Add OPENROUTER_API_KEY or GEMINI_API_KEY to server/.env.</div> : null}
                {error ? <div className="error-banner">{error}</div> : null}

                <button className="btn btn-primary btn-block" onClick={create} disabled={!canSubmit}>
                    {starting ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />} Make {form.count === 1 ? 'ad' : `${form.count} ads`}
                    {credits !== null ? <span className="ad-credits">{credits} credit{credits === 1 ? '' : 's'}</span> : null}
                </button>
            </section>

            <div className="marketing-studio__main">
                {active ? (
                    <AdSetView
                        key={active.id}
                        set={active}
                        setSet={setActive}
                        onMore={() => watch(active.id)}
                        onDeleted={() => {
                            setActive(null);
                            refreshList();
                        }}
                    />
                ) : (
                    <section className="surface marketing-coming">
                        <h2>Your ads appear here</h2>
                        <p className="muted">Add a product and what the ad should say. You get several angles to test in each size, plus the text for the ad itself. Editing text afterwards is free.</p>
                    </section>
                )}
                {list.length ? (
                    <section className="surface marketing-section">
                        <h3>Your ads</h3>
                        <div className="marketing-carousel-list">
                            {list.map((s) => (
                                <button key={s.id} className={`marketing-carousel-tile ${active?.id === s.id ? 'is-active' : ''}`} onClick={() => open(s.id)}>
                                    {s.cover ? <img src={s.cover} alt="" /> : <span className="marketing-carousel-tile__ph">{s.status === 'running' ? <Loader2 size={16} className="spin" /> : '—'}</span>}
                                    <strong>{s.title || 'Ads'}</strong>
                                    <small className="muted">{s.status === 'done' ? `${s.count} ads` : s.status === 'running' ? s.stage : 'Failed'}</small>
                                </button>
                            ))}
                        </div>
                    </section>
                ) : null}
            </div>
        </div>
    );
}

function AdSetView({ set, setSet, onMore, onDeleted }) {
    const formats = set.settings?.formats || ['1:1'];
    const [format, setFormat] = useState(formats[0]);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const ads = set.ads || [];

    const run = async (label, fn) => {
        setBusy(label);
        setError('');
        try {
            await fn();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy('');
        }
    };

    if (set.status === 'running' && !ads.length) {
        return (
            <section className="surface marketing-section">
                <h3>{set.title || 'Making your ads'}</h3>
                <div className="progress">
                    <div style={{ width: `${set.progress || 3}%` }} />
                </div>
                <p className="muted">
                    <Loader2 size={14} className="spin" /> {set.stage}… About a minute, longer with AI backdrops.
                </p>
            </section>
        );
    }
    if (set.status === 'failed') {
        return (
            <section className="surface marketing-section">
                <h3>Couldn't make these ads</h3>
                <div className="error-banner">{set.error}</div>
                <p className="muted">Credits for a failed run are returned.</p>
                <div className="marketing-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => run('delete', async () => { await marketingApi.deleteAdSet(set.id); onDeleted(); })}>
                        <Trash2 size={14} /> Delete
                    </button>
                </div>
            </section>
        );
    }

    return (
        <section className="surface marketing-section">
            <div className="marketing-section__head">
                <div>
                    <h3>{set.title}</h3>
                    <p className="muted">
                        {ads.length} ads{set.reference?.competitor ? ` · format from ${set.reference.competitor}` : set.reference ? ' · recreated from a saved ad' : ''}
                    </p>
                </div>
                <div className="marketing-actions">
                    <button
                        className="btn btn-secondary btn-sm"
                        disabled={!!busy || set.status === 'running'}
                        onClick={() => run('download', async () => { for (const [i, a] of ads.entries()) for (const f of formats) if (a.renders?.[f]) await downloadUrl(a.renders[f], `${safeName(set.title)}-${i + 1}-${f.replace(':', 'x')}.png`); })}
                    >
                        {busy === 'download' ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Download all
                    </button>
                    <button
                        className="btn btn-secondary btn-sm"
                        disabled={!!busy || set.status === 'running' || ads.length >= 12}
                        onClick={() => run('more', async () => { await marketingApi.adVariations(set.id, 3); setSet({ ...set, status: 'running', stage: 'Writing variations', progress: 10 }); onMore(); })}
                    >
                        {busy === 'more' || set.status === 'running' ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} 3 more variations
                    </button>
                    <button
                        className="btn btn-ghost btn-sm"
                        disabled={!!busy || set.status === 'running'}
                        aria-label="Delete these ads"
                        onClick={async () => (await confirmDialog('Delete these ads?', { confirmLabel: 'Delete', danger: true })) && run('delete', async () => { await marketingApi.deleteAdSet(set.id); onDeleted(); })}
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>

            {set.status === 'running' ? (
                <p className="muted">
                    <Loader2 size={14} className="spin" /> {set.stage}…
                </p>
            ) : null}
            {set.notes?.length ? <div className="notice">{set.notes.join(' ')}</div> : null}
            {error ? <div className="error-banner">{error}</div> : null}

            {formats.length > 1 ? (
                <div className="segmented" role="tablist" aria-label="Size">
                    {formats.map((f) => (
                        <button key={f} role="tab" aria-selected={format === f} className={format === f ? 'is-active' : ''} onClick={() => setFormat(f)}>
                            {FORMAT_LABELS[f] || f}
                        </button>
                    ))}
                </div>
            ) : null}

            <div className={`ad-grid is-${format.replace(':', 'x')}`}>
                {ads.map((ad, i) => (
                    <AdCard key={`${i}-${ad.renders?.[format] || ''}`} ad={ad} index={i} format={format} set={set} setSet={setSet} />
                ))}
            </div>
        </section>
    );
}

function AdCard({ ad, index, format, set, setSet }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(() => ({ layout: ad.layout, headline: ad.headline, subhead: ad.subhead, cta: ad.cta, badge: ad.badge, offer: ad.offer }));
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [copied, setCopied] = useState('');
    const render = ad.renders?.[format];

    const save = async () => {
        setBusy('save');
        setError('');
        try {
            const { set: next } = await marketingApi.updateAd(set.id, index, draft);
            setSet(next);
            setEditing(false);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy('');
        }
    };
    const copy = async (key, value) => {
        await navigator.clipboard.writeText(value);
        setCopied(key);
        setTimeout(() => setCopied(''), 1500);
    };
    const field = (key, label, max) => (
        <label className="field">
            <span>{label}</span>
            <input className="input" value={draft[key] || ''} maxLength={max} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
        </label>
    );

    return (
        <article className="ad-card">
            <div className="ad-card__media">
                {render ? <img src={render} alt={ad.headline || `Ad ${index + 1}`} /> : <span className="marketing-carousel-tile__ph">—</span>}
            </div>
            <div className="ad-card__body">
                <div className="ad-card__meta">
                    {ad.angle ? <span className="chip is-static">{ad.angle.charAt(0).toUpperCase() + ad.angle.slice(1)}</span> : null}
                    <span className="muted">{LAYOUT_LABELS[ad.layout] || ad.layout}</span>
                    {render ? (
                        <button className="btn btn-secondary btn-sm ad-card__download" onClick={() => downloadUrl(render, `${safeName(set.title)}-${index + 1}-${format.replace(':', 'x')}.png`)} aria-label={`Download ad ${index + 1}, ${FORMAT_LABELS[format] || format}`}>
                            <Download size={14} /> Download
                        </button>
                    ) : null}
                </div>

                {editing ? (
                    <div className="ad-card__edit">
                        <label className="field">
                            <span>Layout</span>
                            <select className="input" value={draft.layout} onChange={(e) => setDraft({ ...draft, layout: e.target.value })}>
                                {Object.entries(LAYOUT_LABELS).map(([id, label]) => (
                                    <option key={id} value={id}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {field('headline', 'Headline', 90)}
                        {field('subhead', 'Subheading', 140)}
                        <div className="field-row">
                            {field('cta', 'Button', 24)}
                            {field('badge', 'Badge', 22)}
                        </div>
                        {draft.layout === 'offer' ? field('offer', 'Offer (e.g. 30% off)', 18) : null}
                        {error ? <div className="error-banner">{error}</div> : null}
                        <div className="marketing-actions">
                            <button className="btn btn-primary btn-sm" onClick={save} disabled={busy === 'save'}>
                                {busy === 'save' ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Save
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                                Cancel
                            </button>
                        </div>
                        <small className="muted">Saving re-draws every size. No credits used.</small>
                    </div>
                ) : (
                    <>
                        <div className="ad-copy">
                            {[
                                ['primaryText', 'Post text', ad.primaryText],
                                ['adHeadline', 'Headline', ad.adHeadline],
                                ['description', 'Description', ad.description],
                            ]
                                .filter(([, , v]) => v)
                                .map(([key, label, value]) => (
                                    <div key={key} className="ad-copy__row">
                                        <div>
                                            <small className="muted">{label}</small>
                                            <p>{value}</p>
                                        </div>
                                        <button className="btn-icon btn-ghost" onClick={() => copy(key, value)} aria-label={`Copy ${label.toLowerCase()}`} title="Copy">
                                            {copied === key ? <Check size={14} /> : <Copy size={14} />}
                                        </button>
                                    </div>
                                ))}
                        </div>
                        <div className="marketing-actions">
                            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)} disabled={set.status === 'running'}>
                                <Pencil size={14} /> Edit
                            </button>
                        </div>
                    </>
                )}
            </div>
        </article>
    );
}
