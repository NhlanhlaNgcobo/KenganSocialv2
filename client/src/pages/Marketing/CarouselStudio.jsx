import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Download, ImagePlus, Loader2, Plus, RefreshCw, Trash2, Wand2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { marketingApi, pollUntilDone } from '../../lib/marketing-api';

const SOURCES = [
    { id: 'website', label: 'My website' },
    { id: 'topic', label: 'A topic' },
    { id: 'text', label: 'My text' },
];

const GOAL_LABELS = { educate: 'Educate', promote: 'Promote', engage: 'Engage', launch: 'Launch', proof: 'Social proof' };
const LAYOUT_LABELS = {
    cover: 'Cover',
    statement: 'Statement',
    list: 'List',
    steps: 'Steps',
    stat: 'Big number',
    quote: 'Quote',
    image: 'Image + text',
    comparison: 'Comparison',
    cta: 'Call to action',
};
const IMAGERY = [
    { id: 'none', label: 'No AI images', hint: 'Fastest. Slides use your brand colours and layouts.' },
    { id: 'free', label: 'Free AI images', hint: 'Open-source FLUX model via Pollinations.' },
    { id: 'best', label: 'Best AI images', hint: 'GPT Image (top-ranked). Uses paid credit if OpenRouter is set up.' },
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

/** Create: on-brand carousels from the website, a topic or pasted text. */
export default function CarouselStudio({ kit, initialSource = 'website' }) {
    const { plan } = useAuth();
    const aiLocked = plan === 'starter';
    const [options, setOptions] = useState(null);
    const [list, setList] = useState([]);
    const [form, setForm] = useState({ source: kit.website ? initialSource : 'topic', topic: '', text: '', goal: 'educate', format: '4:5', slideCount: 7, imagery: 'none', extra: '' });
    const [active, setActive] = useState(null); // carousel being made or edited
    const [error, setError] = useState('');
    const [starting, setStarting] = useState(false);

    const refreshList = useCallback(() => marketingApi.carousels().then((d) => setList(d.carousels)).catch(() => {}), []);

    useEffect(() => {
        marketingApi.carouselOptions().then(setOptions).catch((err) => setError(err.message));
        refreshList();
    }, [refreshList]);

    const set = (patch) => setForm((f) => ({ ...f, ...patch }));

    const watch = useCallback(
        async (id) => {
            try {
                const final = await pollUntilDone(async () => (await marketingApi.carousel(id)).carousel, setActive);
                if (final.status === 'failed') setError(final.error || 'The carousel could not be made.');
            } catch (err) {
                setError(err.message);
            } finally {
                refreshList();
            }
        },
        [refreshList]
    );

    const create = async () => {
        setError('');
        setStarting(true);
        try {
            const { id } = await marketingApi.createCarousel({
                source: { type: form.source, topic: form.topic, text: form.text },
                goal: form.goal,
                format: form.format,
                slideCount: form.slideCount,
                imagery: form.imagery,
                extra: form.extra,
            });
            setActive({ id, status: 'running', stage: 'Writing your slides', progress: 3, slides: [] });
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
            const { carousel } = await marketingApi.carousel(id);
            setActive(carousel);
            if (carousel.status === 'running') watch(id);
        } catch (err) {
            setError(err.message);
        }
    };

    const canSubmit =
        options?.aiAvailable &&
        !aiLocked &&
        !starting &&
        active?.status !== 'running' &&
        ((form.source === 'website' && kit.website) || (form.source === 'topic' && form.topic.trim().length >= 3) || (form.source === 'text' && form.text.trim().length >= 80));

    return (
        <div className="marketing-studio">
            <section className="surface marketing-section marketing-studio__form">
                <div className="marketing-section__head">
                    <div>
                        <h3>New carousel</h3>
                        <p className="muted">Written in your brand voice, designed with your brand kit.</p>
                    </div>
                </div>

                <div className="segmented" role="tablist" aria-label="Source">
                    {SOURCES.map((s) => (
                        <button key={s.id} className={form.source === s.id ? 'is-active' : ''} onClick={() => set({ source: s.id })}>
                            {s.label}
                        </button>
                    ))}
                </div>
                {form.source === 'website' ? (
                    kit.website ? (
                        <small className="muted">From {kit.website.replace(/^https?:\/\//, '')}{kit.site?.readAt ? `, read ${new Date(kit.site.readAt).toLocaleDateString()}` : ''}. Add a focus below, e.g. "our new winter menu".</small>
                    ) : (
                        <small className="is-error">Add your website on the Brand tab first.</small>
                    )
                ) : null}
                {form.source === 'topic' ? (
                    <label className="field">
                        <span>What's it about?</span>
                        <input className="input" value={form.topic} onChange={(e) => set({ topic: e.target.value })} maxLength={300} placeholder="e.g. 5 mistakes people make when choosing a gym" />
                    </label>
                ) : null}
                {form.source === 'text' ? (
                    <label className="field">
                        <span>Your text</span>
                        <textarea className="input" rows={5} value={form.text} onChange={(e) => set({ text: e.target.value })} placeholder="A blog post, newsletter, script or notes…" />
                    </label>
                ) : null}

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

                <div className="field-row">
                    <label className="field">
                        <span>Format</span>
                        <select className="input" value={form.format} onChange={(e) => set({ format: e.target.value })}>
                            {(options?.formats || []).map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        <span>Slides</span>
                        <select className="input" value={form.slideCount} onChange={(e) => set({ slideCount: Number(e.target.value) })}>
                            {[5, 6, 7, 8, 9, 10].map((n) => (
                                <option key={n} value={n}>
                                    {n} slides
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                <div className="field">
                    <span>Images</span>
                    <div className="marketing-imagery">
                        {IMAGERY.map((i) => {
                            const available = options?.imagery?.[i.id];
                            return (
                                <label key={i.id} className={`marketing-imagery__opt ${form.imagery === i.id ? 'is-active' : ''} ${available ? '' : 'is-disabled'}`}>
                                    <input type="radio" name="imagery" checked={form.imagery === i.id} disabled={!available} onChange={() => set({ imagery: i.id })} />
                                    <strong>{i.label}</strong>
                                    <small>{available ? i.hint : i.id === 'free' ? 'Needs a free Pollinations key (POLLINATIONS_API_KEY).' : 'Needs an image provider key.'}</small>
                                </label>
                            );
                        })}
                    </div>
                </div>

                <label className="field">
                    <span>
                        Extra instructions <em>optional</em>
                    </span>
                    <input className="input" value={form.extra} onChange={(e) => set({ extra: e.target.value })} maxLength={400} placeholder='e.g. "Focus on the student discount", "end with a question"' />
                </label>

                {options && !options.aiAvailable ? <div className="error-banner">AI is not set up on the server yet. Add OPENROUTER_API_KEY or GEMINI_API_KEY to server/.env.</div> : null}
                {aiLocked ? (
                    <div className="error-banner">
                        Carousels are written by AI, which is part of the Nano plan and up. <Link to="/dashboard/billing">See plans</Link>
                    </div>
                ) : null}
                {error ? <div className="error-banner">{error}</div> : null}

                <button className="btn btn-primary btn-block" onClick={create} disabled={!canSubmit}>
                    {starting ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />} Make carousel
                </button>
            </section>

            <div className="marketing-studio__main">
                {active ? (
                    <CarouselEditor
                        key={`${active.id}-${active.status}`}
                        carousel={active}
                        setCarousel={setActive}
                        onDeleted={() => {
                            setActive(null);
                            refreshList();
                        }}
                        onError={setError}
                    />
                ) : (
                    <EmptyState />
                )}
                {list.length ? (
                    <section className="surface marketing-section">
                        <h3>Your carousels</h3>
                        <div className="marketing-carousel-list">
                            {list.map((c) => (
                                <button key={c.id} className={`marketing-carousel-tile ${active?.id === c.id ? 'is-active' : ''}`} onClick={() => open(c.id)}>
                                    {c.cover ? <img src={c.cover} alt="" /> : <span className="marketing-carousel-tile__ph">{c.status === 'running' ? <Loader2 size={16} className="spin" /> : '—'}</span>}
                                    <strong>{c.title || 'Carousel'}</strong>
                                    <small className="muted">
                                        {c.status === 'done' ? `${c.slideCount} slides` : c.status === 'running' ? c.stage : 'Failed'}
                                    </small>
                                </button>
                            ))}
                        </div>
                    </section>
                ) : null}
            </div>
        </div>
    );
}

function EmptyState() {
    return (
        <section className="surface marketing-coming">
            <h2>Your carousel appears here</h2>
            <p className="muted">Pick a source and a goal, then make a carousel. You can edit every slide afterwards; edits re-render instantly and cost no AI credit.</p>
        </section>
    );
}

function CarouselEditor({ carousel, setCarousel, onDeleted, onError }) {
    const [index, setIndex] = useState(0);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [caption, setCaption] = useState(carousel.caption || '');
    const [copied, setCopied] = useState(false);
    const slides = carousel.slides || [];
    const slide = slides[Math.min(index, slides.length - 1)];

    if (carousel.status === 'running') {
        return (
            <section className="surface marketing-section">
                <h3>{carousel.title || 'Making your carousel'}</h3>
                <div className="progress">
                    <div style={{ width: `${carousel.progress || 3}%` }} />
                </div>
                <p className="muted">
                    <Loader2 size={14} className="spin" /> {carousel.stage}… This takes about a minute, longer with AI images.
                </p>
            </section>
        );
    }
    if (carousel.status === 'failed') {
        return (
            <section className="surface marketing-section">
                <h3>Couldn't make this carousel</h3>
                <div className="error-banner">{carousel.error}</div>
                <div className="marketing-actions">
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={async () => {
                            try {
                                await marketingApi.deleteCarousel(carousel.id);
                                onDeleted();
                            } catch (err) {
                                onError?.(err.message);
                            }
                        }}
                    >
                        <Trash2 size={14} /> Delete
                    </button>
                </div>
            </section>
        );
    }

    const run = async (label, fn) => {
        setBusy(label);
        setError('');
        try {
            const result = await fn();
            if (result?.carousel) setCarousel(result.carousel);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy('');
        }
    };

    const fullCaption = `${caption}${carousel.hashtags?.length ? `\n\n${carousel.hashtags.map((h) => `#${h}`).join(' ')}` : ''}`;

    return (
        <section className="surface marketing-section marketing-editor">
            <div className="marketing-section__head">
                <div>
                    <h3>{carousel.title}</h3>
                    <p className="muted">
                        {slides.length} slides · {carousel.settings?.format}
                    </p>
                </div>
                <div className="marketing-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => run('download', async () => { for (const [i, s] of slides.entries()) await downloadUrl(s.renderUrl, `${carousel.title || 'carousel'}-${i + 1}.png`); })} disabled={!!busy}>
                        {busy === 'download' ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Download all
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => window.confirm('Delete this carousel?') && run('delete', async () => { await marketingApi.deleteCarousel(carousel.id); onDeleted(); })} disabled={!!busy} aria-label="Delete carousel">
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>

            {(carousel.notes || []).map((n) => (
                <small key={n} className="muted">
                    {n}
                </small>
            ))}

            <div className="marketing-strip">
                {slides.map((s, i) => (
                    <button key={i} className={`marketing-strip__item ${i === index ? 'is-active' : ''}`} onClick={() => setIndex(i)} aria-label={`Slide ${i + 1}`}>
                        <img src={s.renderUrl} alt="" />
                        <span>{i + 1}</span>
                    </button>
                ))}
            </div>

            {slide ? (
                <div className="marketing-editor__body">
                    <div className="marketing-editor__preview">
                        <img src={slide.renderUrl} alt={`Slide ${index + 1}`} />
                        {busy === 'slide' || busy === 'image' ? (
                            <div className="marketing-editor__overlay">
                                <Loader2 size={22} className="spin" />
                            </div>
                        ) : null}
                    </div>
                    <SlideForm
                        key={`${carousel.id}-${index}-${slide.renderedAt}`}
                        slide={slide}
                        busy={busy}
                        onSave={(values) => run('slide', () => marketingApi.updateSlide(carousel.id, index, values))}
                        onImage={(prompt) => run('image', () => marketingApi.regenerateImage(carousel.id, index, { prompt }))}
                        onDownload={() => run('download', () => downloadUrl(slide.renderUrl, `${carousel.title || 'carousel'}-${index + 1}.png`))}
                    />
                </div>
            ) : null}

            {error ? <div className="error-banner">{error}</div> : null}

            <div className="field">
                <span>Caption</span>
                <textarea className="input" rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} />
                {carousel.hashtags?.length ? <small>{carousel.hashtags.map((h) => `#${h}`).join(' ')}</small> : null}
            </div>
            <div className="marketing-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => run('caption', () => marketingApi.updateCarousel(carousel.id, { caption }))} disabled={!!busy || caption === (carousel.caption || '')}>
                    {busy === 'caption' ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Save caption
                </button>
                <button
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(fullCaption);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                        } catch {
                            setError('Copy failed. Select the caption and copy it manually.');
                        }
                    }}
                >
                    {copied ? <Check size={14} /> : <Copy size={14} />} Copy caption + hashtags
                </button>
            </div>
        </section>
    );
}

function SlideForm({ slide, busy, onSave, onImage, onDownload }) {
    const [v, setV] = useState(() => ({
        layout: slide.layout,
        kicker: slide.kicker || '',
        headline: slide.headline || '',
        body: slide.body || '',
        bullets: (slide.bullets || []).join('\n'),
        statValue: slide.stat?.value || '',
        statLabel: slide.stat?.label || '',
        quoteText: slide.quote?.text || '',
        quoteAuthor: slide.quote?.author || '',
        leftTitle: slide.compare?.leftTitle || '',
        left: (slide.compare?.left || []).join('\n'),
        rightTitle: slide.compare?.rightTitle || '',
        right: (slide.compare?.right || []).join('\n'),
        cta: slide.cta || '',
    }));
    const [prompt, setPrompt] = useState(slide.imagePrompt || '');
    const set = (patch) => setV((x) => ({ ...x, ...patch }));
    const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);

    const save = () =>
        onSave({
            layout: v.layout,
            kicker: v.kicker,
            headline: v.headline,
            body: v.body,
            bullets: lines(v.bullets),
            stat: v.layout === 'stat' ? { value: v.statValue, label: v.statLabel } : slide.stat,
            quote: v.layout === 'quote' ? { text: v.quoteText, author: v.quoteAuthor } : slide.quote,
            compare: v.layout === 'comparison' ? { leftTitle: v.leftTitle, left: lines(v.left), rightTitle: v.rightTitle, right: lines(v.right) } : slide.compare,
            cta: v.cta,
        });

    const L = v.layout;
    return (
        <div className="marketing-slide-form">
            <label className="field">
                <span>Layout</span>
                <select className="input" value={L} onChange={(e) => set({ layout: e.target.value })}>
                    {Object.entries(LAYOUT_LABELS).map(([id, label]) => (
                        <option key={id} value={id}>
                            {label}
                        </option>
                    ))}
                </select>
            </label>
            {L !== 'quote' && L !== 'stat' ? (
                <label className="field">
                    <span>Headline</span>
                    <textarea className="input" rows={2} value={v.headline} onChange={(e) => set({ headline: e.target.value })} maxLength={120} />
                </label>
            ) : null}
            {['cover', 'list', 'steps', 'stat', 'image', 'comparison', 'cta', 'statement'].includes(L) ? (
                <label className="field">
                    <span>
                        Small label <em>optional</em>
                    </span>
                    <input className="input" value={v.kicker} onChange={(e) => set({ kicker: e.target.value })} maxLength={40} />
                </label>
            ) : null}
            {L === 'list' || L === 'steps' ? (
                <label className="field">
                    <span>{L === 'steps' ? 'Steps' : 'Points'} (one per line)</span>
                    <textarea className="input" rows={5} value={v.bullets} onChange={(e) => set({ bullets: e.target.value })} />
                </label>
            ) : null}
            {L === 'stat' ? (
                <div className="field-row">
                    <label className="field">
                        <span>Number</span>
                        <input className="input" value={v.statValue} onChange={(e) => set({ statValue: e.target.value })} maxLength={12} />
                    </label>
                    <label className="field">
                        <span>What it means</span>
                        <input className="input" value={v.statLabel} onChange={(e) => set({ statLabel: e.target.value })} maxLength={80} />
                    </label>
                </div>
            ) : null}
            {L === 'quote' ? (
                <>
                    <label className="field">
                        <span>Quote</span>
                        <textarea className="input" rows={3} value={v.quoteText} onChange={(e) => set({ quoteText: e.target.value })} maxLength={260} />
                    </label>
                    <label className="field">
                        <span>Who said it</span>
                        <input className="input" value={v.quoteAuthor} onChange={(e) => set({ quoteAuthor: e.target.value })} maxLength={60} />
                    </label>
                </>
            ) : null}
            {L === 'comparison' ? (
                <div className="field-row">
                    <div className="field">
                        <span>Left</span>
                        <input className="input" value={v.leftTitle} onChange={(e) => set({ leftTitle: e.target.value })} maxLength={30} />
                        <textarea className="input" rows={3} value={v.left} onChange={(e) => set({ left: e.target.value })} />
                    </div>
                    <div className="field">
                        <span>Right (yours)</span>
                        <input className="input" value={v.rightTitle} onChange={(e) => set({ rightTitle: e.target.value })} maxLength={30} />
                        <textarea className="input" rows={3} value={v.right} onChange={(e) => set({ right: e.target.value })} />
                    </div>
                </div>
            ) : null}
            {['cover', 'statement', 'stat', 'image', 'cta'].includes(L) ? (
                <label className="field">
                    <span>
                        Text <em>optional</em>
                    </span>
                    <textarea className="input" rows={2} value={v.body} onChange={(e) => set({ body: e.target.value })} maxLength={260} />
                </label>
            ) : null}
            {L === 'cta' ? (
                <label className="field">
                    <span>Button</span>
                    <input className="input" value={v.cta} onChange={(e) => set({ cta: e.target.value })} maxLength={40} />
                </label>
            ) : null}

            <div className="marketing-actions">
                <button className="btn btn-primary btn-sm" onClick={save} disabled={!!busy}>
                    {busy === 'slide' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Update slide
                </button>
                <button className="btn btn-ghost btn-sm" onClick={onDownload}>
                    <Download size={14} /> Download
                </button>
            </div>

            {L === 'cover' || L === 'image' ? (
                <div className="field marketing-image-gen">
                    <span>AI image</span>
                    <textarea className="input" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={600} placeholder="Describe the picture (no text in it), e.g. flat lay of coffee beans and a cup on warm wood" />
                    <button className="btn btn-secondary btn-sm" onClick={() => onImage(prompt)} disabled={!!busy || !prompt.trim()}>
                        {busy === 'image' ? <Loader2 size={14} className="spin" /> : slide.imageUrl ? <ImagePlus size={14} /> : <Plus size={14} />} {slide.imageUrl ? 'New image' : 'Add image'}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
