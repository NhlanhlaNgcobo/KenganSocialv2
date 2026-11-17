import { useEffect, useState } from 'react';
import { ExternalLink, ImagePlus, Loader2, Plus, Trash2, Wand2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { marketingApi } from '../../lib/marketing-api';
import { confirmDialog } from '../../lib/dialogs';

const EMPTY = { name: '', website: '', instagram: '', tiktok: '', facebook: '' };

/** Competitors: links to their live ads, and a swipe file of ads to recreate with your brand. */
export default function CompetitorsPanel({ go }) {
    const { plan } = useAuth();
    const locked = plan === 'starter';
    const [data, setData] = useState(null);
    const [form, setForm] = useState(EMPTY);
    const [swipeFor, setSwipeFor] = useState('');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (locked) return;
        marketingApi.competitors().then(setData).catch((err) => setError(err.message));
    }, [locked]);

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

    if (locked) {
        return (
            <section className="surface marketing-coming">
                <h2>Competitor research</h2>
                <p className="muted">Track competitors, open their live ads in the official ad libraries, save the ads that work and rebuild their format with your own brand.</p>
                <Link className="btn btn-primary" to="/dashboard/billing">
                    See plans
                </Link>
            </section>
        );
    }
    if (!data) {
        return (
            <section className="surface marketing-section">
                {error ? <div className="error-banner">{error}</div> : <p className="muted"><Loader2 size={14} className="spin" /> Loading…</p>}
            </section>
        );
    }

    const add = () =>
        run('add', async () => {
            const { competitor } = await marketingApi.addCompetitor(form);
            setData({ ...data, competitors: [competitor, ...data.competitors] });
            setForm(EMPTY);
        });
    const upload = (files) =>
        run('upload', async () => {
            const { swipes } = await marketingApi.addSwipes(files, { competitor: swipeFor });
            setData({ ...data, swipes: [...swipes, ...data.swipes] });
        });

    return (
        <div className="marketing-competitors">
            <section className="surface marketing-section">
                <div className="marketing-section__head">
                    <div>
                        <h3>Competitors</h3>
                        <p className="muted">See the ads they're running right now, straight from the official ad libraries.</p>
                    </div>
                </div>
                <div className="competitor-form">
                    <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} placeholder="Brand name" aria-label="Competitor brand name" />
                    <input className="input" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} maxLength={200} placeholder="Website (optional)" aria-label="Competitor website" />
                    <input className="input" value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} maxLength={60} placeholder="@instagram (optional)" aria-label="Competitor Instagram handle" />
                    <input className="input" value={form.tiktok} onChange={(e) => setForm({ ...form, tiktok: e.target.value })} maxLength={60} placeholder="@tiktok (optional)" aria-label="Competitor TikTok handle" />
                    <button className="btn btn-primary" onClick={add} disabled={busy === 'add' || form.name.trim().length < 2}>
                        {busy === 'add' ? <Loader2 size={15} className="spin" /> : <Plus size={15} />} Add
                    </button>
                </div>
                {error ? <div className="error-banner">{error}</div> : null}

                {data.competitors.length ? (
                    <ul className="competitor-list">
                        {data.competitors.map((c) => (
                            <li key={c.id} className="competitor">
                                <div className="competitor__head">
                                    <strong>{c.name}</strong>
                                    {c.website ? <small className="muted">{c.website}</small> : null}
                                    <button
                                        className="btn-icon btn-ghost"
                                        aria-label={`Remove ${c.name}`}
                                        onClick={async () =>
                                            (await confirmDialog(`Stop tracking ${c.name}?`, { confirmLabel: 'Remove', danger: true })) &&
                                            run(`rm-${c.id}`, async () => {
                                                await marketingApi.removeCompetitor(c.id);
                                                setData({ ...data, competitors: data.competitors.filter((x) => x.id !== c.id) });
                                            })
                                        }
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                                <div className="competitor__links">
                                    {c.links.map((l) => (
                                        <a key={l.label} className="chip" href={l.url} target="_blank" rel="noopener noreferrer">
                                            {l.label} <ExternalLink size={12} />
                                        </a>
                                    ))}
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="muted">Add a competitor to get one-click links to their live Facebook, Instagram and Google ads.</p>
                )}
            </section>

            <section className="surface marketing-section">
                <div className="marketing-section__head">
                    <div>
                        <h3>Swipe file</h3>
                        <p className="muted">Screenshot ads that stop you scrolling and save them here. Recreate rebuilds the format with your brand, product and words.</p>
                    </div>
                </div>
                <div className="competitor-form">
                    <select className="input" value={swipeFor} onChange={(e) => setSwipeFor(e.target.value)} aria-label="Whose ads are these?">
                        <option value="">Whose ad? (optional)</option>
                        {data.competitors.map((c) => (
                            <option key={c.id} value={c.name}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                    <label className={`btn btn-secondary ${busy === 'upload' ? 'is-disabled' : ''}`}>
                        {busy === 'upload' ? <Loader2 size={15} className="spin" /> : <ImagePlus size={15} />} Add screenshots
                        <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={busy === 'upload'} onChange={(e) => e.target.files?.length && upload(e.target.files)} />
                    </label>
                </div>
                {data.swipes.length ? (
                    <div className="swipe-grid">
                        {data.swipes.map((s) => (
                            <figure key={s.id} className="swipe">
                                <img src={s.previewUrl} alt={s.competitor ? `Ad from ${s.competitor}` : 'Saved ad'} />
                                <figcaption>
                                    <small className="muted">{s.competitor || 'Saved ad'}</small>
                                    {s.structure?.hookType ? <small>{s.structure.hookType}</small> : null}
                                    <div className="marketing-actions">
                                        <button className="btn btn-primary btn-sm" onClick={() => go('image-ads', { swipe: s.id })}>
                                            <Wand2 size={14} /> Recreate
                                        </button>
                                        <button
                                            className="btn-icon btn-ghost"
                                            aria-label="Delete saved ad"
                                            onClick={async () =>
                                                (await confirmDialog('Delete this saved ad?', { confirmLabel: 'Delete', danger: true })) &&
                                                run(`sw-${s.id}`, async () => {
                                                    await marketingApi.removeSwipe(s.id);
                                                    setData({ ...data, swipes: data.swipes.filter((x) => x.id !== s.id) });
                                                })
                                            }
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </figcaption>
                            </figure>
                        ))}
                    </div>
                ) : (
                    <p className="muted">No saved ads yet. Open a competitor's ad library above, screenshot ads you like, and add them here.</p>
                )}
            </section>
        </div>
    );
}
