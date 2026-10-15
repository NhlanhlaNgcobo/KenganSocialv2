import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { marketingApi } from '../../lib/marketing-api';

const LIST_FIELDS = [
    { id: 'audience', label: 'Who buys', hint: 'One audience per line' },
    { id: 'painPoints', label: 'Problems you solve', hint: 'One per line' },
    { id: 'sellingPoints', label: 'Why choose you', hint: 'One per line' },
    { id: 'offers', label: 'Offers and promos', hint: 'One per line' },
    { id: 'proof', label: 'Proof', hint: 'Reviews, numbers, awards, clients' },
    { id: 'contentPillars', label: 'Content pillars', hint: 'Themes you post about' },
];

const toForm = (b) => ({
    oneLiner: b?.oneLiner || '',
    category: b?.category || '',
    whatYouSell: b?.whatYouSell || '',
    primaryCta: b?.primaryCta || '',
    location: b?.location || '',
    products: b?.products || [],
    ...Object.fromEntries(LIST_FIELDS.map((f) => [f.id, (b?.[f.id] || []).join('\n')])),
});

const lines = (s) =>
    String(s || '')
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);

/** What the business sells and to whom; learned from the website, editable. */
export default function BusinessProfilePanel({ data, onSaved }) {
    const saved = data.kit.business;
    const [form, setForm] = useState(() => toForm(saved));
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(null);
    const [savedKey, setSavedKey] = useState(() => JSON.stringify(toForm(saved)));
    const currentKey = JSON.stringify(toForm(saved));
    if (currentKey !== savedKey) {
        // The profile was refreshed elsewhere (e.g. "Set up from your website"): show the new one.
        setSavedKey(currentKey);
        setForm(toForm(saved));
    }
    const dirty = JSON.stringify(form) !== savedKey;
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));

    const save = async () => {
        setBusy(true);
        setMessage(null);
        try {
            const business = { ...form, ...Object.fromEntries(LIST_FIELDS.map((f) => [f.id, lines(form[f.id])])), source: saved?.source || null };
            const result = await marketingApi.saveBrand({ business });
            onSaved({ ...data, ...result });
            setMessage({ type: 'success', text: 'Business profile saved.' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="surface marketing-section">
            <div className="marketing-section__head">
                <div>
                    <h3>Business profile</h3>
                    <p className="muted">What you sell and to whom. Carousels and ideas are written from this.</p>
                </div>
                {saved?.source ? <span className="badge">From {String(saved.source).replace(/^https?:\/\//, '').split('/')[0]}</span> : null}
            </div>

            <label className="field">
                <span>In one sentence</span>
                <input className="input" value={form.oneLiner} onChange={(e) => set({ oneLiner: e.target.value })} maxLength={200} placeholder="We roast fresh coffee in Soweto and deliver it across Gauteng." />
            </label>
            <div className="field-row">
                <label className="field">
                    <span>Category</span>
                    <input className="input" value={form.category} onChange={(e) => set({ category: e.target.value })} maxLength={80} placeholder="e.g. coffee roaster" />
                </label>
                <label className="field">
                    <span>Main call to action</span>
                    <input className="input" value={form.primaryCta} onChange={(e) => set({ primaryCta: e.target.value })} maxLength={80} placeholder="e.g. Order online" />
                </label>
                <label className="field">
                    <span>Location</span>
                    <input className="input" value={form.location} onChange={(e) => set({ location: e.target.value })} maxLength={80} placeholder="e.g. Johannesburg" />
                </label>
            </div>
            <label className="field">
                <span>What you sell</span>
                <textarea className="input" rows={3} value={form.whatYouSell} onChange={(e) => set({ whatYouSell: e.target.value })} maxLength={400} />
            </label>

            {form.products.length ? (
                <div className="field">
                    <span>Products found</span>
                    <div className="marketing-words">
                        {form.products.map((p) => (
                            <span key={p.name} className="chip" title={p.description}>
                                {p.name}
                                {p.price ? ` · ${p.price}` : ''}
                            </span>
                        ))}
                    </div>
                </div>
            ) : null}

            <div className="marketing-grid-2">
                {LIST_FIELDS.map((f) => (
                    <label key={f.id} className="field">
                        <span>{f.label}</span>
                        <textarea className="input" rows={3} value={form[f.id]} onChange={(e) => set({ [f.id]: e.target.value })} />
                        <small>{f.hint}</small>
                    </label>
                ))}
            </div>

            {message ? <div className={message.type === 'error' ? 'error-banner' : 'success-banner'}>{message.text}</div> : null}
            <div className="marketing-actions">
                <button className="btn btn-primary" onClick={save} disabled={!dirty || busy}>
                    {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Save business profile
                </button>
                {dirty ? (
                    <button className="btn btn-ghost" onClick={() => setForm(toForm(saved))} disabled={busy}>
                        Discard changes
                    </button>
                ) : null}
            </div>
        </section>
    );
}
