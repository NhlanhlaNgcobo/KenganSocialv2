import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, CalendarPlus, Check, Copy, FileText, Film, Link2, Loader2, Repeat2 } from 'lucide-react';
import { clipsApi } from '../../lib/clips-api';
import { formatSlot, nextFreeSlot, repurposeApi, schedulePost } from '../../lib/repurpose-api';
import './Repurpose.css';

/**
 * Repurpose: one source (an article link, your own text, or a clip from Clips) →
 * posts written natively for each platform, ready to copy or schedule.
 */

const SOURCES = [
    { id: 'url', label: 'Link', icon: Link2 },
    { id: 'text', label: 'Text', icon: FileText },
    { id: 'clip', label: 'A clip', icon: Film },
];

const PLATFORMS = [
    { id: 'linkedin', label: 'LinkedIn', limit: 3000, schedulable: true },
    { id: 'x', label: 'X thread', limit: 280, perPost: true },
    { id: 'instagram', label: 'Instagram', limit: 2200, calendar: true },
    { id: 'tiktok', label: 'TikTok', limit: 2200, calendar: true },
    { id: 'threads', label: 'Threads', limit: 500, schedulable: true },
    { id: 'facebook', label: 'Facebook', limit: 63206 },
    { id: 'youtube', label: 'YouTube', limit: 5000, calendar: true },
];

const TONES = ['Friendly', 'Professional', 'Bold', 'Educational', 'Witty'];

export default function RepurposePage() {
    const [source, setSource] = useState('url');
    const [url, setUrl] = useState('');
    const [text, setText] = useState('');
    const [title, setTitle] = useState('');
    const [projects, setProjects] = useState(null);
    const [projectId, setProjectId] = useState('');
    const [project, setProject] = useState(null);
    const [clipId, setClipId] = useState('');
    const [platforms, setPlatforms] = useState(['linkedin', 'x', 'instagram', 'tiktok']);
    const [tone, setTone] = useState('Friendly');
    const [audience, setAudience] = useState('');
    const [cta, setCta] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);

    // Clip projects are loaded the first time the "A clip" source is picked.
    useEffect(() => {
        if (source !== 'clip' || projects) return;
        clipsApi
            .list()
            .then((d) => setProjects((d.projects || []).filter((p) => p.status === 'completed' && p.clipCount > 0)))
            .catch(() => setProjects([]));
    }, [source, projects]);

    useEffect(() => {
        setProject(null);
        setClipId('');
        if (!projectId) return;
        clipsApi.get(projectId).then((d) => {
            setProject(d.project);
            const first = (d.project.clips || []).find((c) => !c.error && c.transcript);
            if (first) setClipId(first.id);
        });
    }, [projectId]);

    const clip = project?.clips?.find((c) => c.id === clipId);
    const togglePlatform = (id) => setPlatforms((list) => (list.includes(id) ? list.filter((p) => p !== id) : [...list, id]));

    const canSubmit =
        platforms.length > 0 &&
        ((source === 'url' && url.trim().length > 4) || (source === 'text' && text.trim().length >= 80) || (source === 'clip' && clip?.transcript));

    const generate = async () => {
        setBusy(true);
        setError('');
        setResult(null);
        try {
            const sourceBody =
                source === 'url'
                    ? { type: 'url', url: url.trim() }
                    : source === 'text'
                      ? { type: 'text', text, title }
                      : { type: 'text', text: clip.transcript, title: clip.title };
            setResult(await repurposeApi.generate({ source: sourceBody, platforms, tone, audience, cta }));
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="repurpose-page">
            <header className="page-head">
                <div>
                    <h1>Repurpose</h1>
                    <p>Turn one article, idea or clip into posts written for each platform, then copy them or put them on the calendar.</p>
                </div>
            </header>

            <div className="repurpose-layout">
                <section className="surface repurpose-form">
                    <div className="segmented" role="tablist" aria-label="Source">
                        {SOURCES.map((s) => (
                            <button key={s.id} role="tab" aria-selected={source === s.id} className={source === s.id ? 'is-active' : ''} onClick={() => setSource(s.id)} disabled={busy}>
                                <s.icon size={15} /> {s.label}
                            </button>
                        ))}
                    </div>

                    {source === 'url' ? (
                        <label className="field">
                            <span>Article or page address</span>
                            <input className="input" placeholder="yourblog.com/latest-post" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} />
                            <small>Blog posts, news articles, newsletters and landing pages. For videos, use Clips first.</small>
                        </label>
                    ) : null}

                    {source === 'text' ? (
                        <>
                            <label className="field">
                                <span>
                                    Title <em>optional</em>
                                </span>
                                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
                            </label>
                            <label className="field">
                                <span>Your text</span>
                                <textarea
                                    className="input"
                                    rows={7}
                                    placeholder="Notes, a script, a newsletter, a transcript…"
                                    value={text}
                                    onChange={(e) => setText(e.target.value)}
                                    disabled={busy}
                                />
                                <small>{text.trim().length < 80 ? `At least 80 characters (${text.trim().length} so far).` : `${text.trim().length.toLocaleString()} characters`}</small>
                            </label>
                        </>
                    ) : null}

                    {source === 'clip' ? (
                        <div className="field-row">
                            <label className="field">
                                <span>Clip project</span>
                                <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={busy}>
                                    <option value="">{projects === null ? 'Loading…' : projects.length ? 'Choose a project' : 'No finished clip projects yet'}</option>
                                    {projects?.map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.sourceName} ({p.clipCount})
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="field">
                                <span>Clip</span>
                                <select className="input" value={clipId} onChange={(e) => setClipId(e.target.value)} disabled={busy || !project}>
                                    {(project?.clips || [])
                                        .filter((c) => !c.error && c.transcript)
                                        .map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {c.title} ({c.score})
                                            </option>
                                        ))}
                                </select>
                            </label>
                        </div>
                    ) : null}

                    <div className="field">
                        <span>Platforms</span>
                        <div className="repurpose-platforms">
                            {PLATFORMS.map((p) => (
                                <button key={p.id} className={`chip ${platforms.includes(p.id) ? 'is-active' : ''}`} onClick={() => togglePlatform(p.id)} aria-pressed={platforms.includes(p.id)} disabled={busy}>
                                    {platforms.includes(p.id) ? <Check size={13} /> : null} {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="field">
                        <span>Voice</span>
                        <div className="segmented">
                            {TONES.map((t) => (
                                <button key={t} className={tone === t ? 'is-active' : ''} onClick={() => setTone(t)} disabled={busy}>
                                    {t}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="field-row">
                        <label className="field">
                            <span>
                                Audience <em>optional</em>
                            </span>
                            <input className="input" placeholder="e.g. Durban restaurant owners" value={audience} onChange={(e) => setAudience(e.target.value)} disabled={busy} />
                        </label>
                        <label className="field">
                            <span>
                                Call to action <em>optional</em>
                            </span>
                            <input className="input" placeholder="e.g. Book a free call at …" value={cta} onChange={(e) => setCta(e.target.value)} disabled={busy} />
                        </label>
                    </div>

                    {error ? <div className="error-banner">{error}</div> : null}

                    <button className="btn btn-primary btn-block" onClick={generate} disabled={!canSubmit || busy}>
                        {busy ? <Loader2 size={16} className="spin" /> : <Repeat2 size={16} />}
                        {busy ? 'Writing posts…' : `Write ${platforms.length} post${platforms.length === 1 ? '' : 's'}`}
                    </button>
                </section>

                <section className="repurpose-results">
                    {!result && !busy ? (
                        <div className="surface repurpose-empty">
                            <Repeat2 size={26} />
                            <h3>Posts appear here</h3>
                            <p>Each platform gets its own format: a LinkedIn post, an X thread, an Instagram caption with hashtags, a TikTok script and more. Everything stays editable.</p>
                        </div>
                    ) : null}
                    {busy ? (
                        <div className="surface repurpose-empty">
                            <Loader2 size={24} className="spin" />
                            <p>Reading the source and writing {platforms.length} posts. This takes about 20 seconds.</p>
                        </div>
                    ) : null}
                    {result ? (
                        <>
                            <div className="repurpose-angle">
                                {result.origin ? (
                                    <span>
                                        From <a href={result.origin.url} target="_blank" rel="noreferrer">{result.origin.siteName}</a> ·{' '}
                                    </span>
                                ) : null}
                                {result.angle}
                            </div>
                            {PLATFORMS.filter((p) => result.drafts[p.id]).map((p) => (
                                <DraftCard key={p.id} platform={p} draft={result.drafts[p.id]} />
                            ))}
                        </>
                    ) : null}
                </section>
            </div>
        </div>
    );
}

function DraftCard({ platform, draft }) {
    const navigate = useNavigate();
    const [value, setValue] = useState(draft.postText);
    const [copied, setCopied] = useState(false);
    const [slot, setSlot] = useState(null);
    const [state, setState] = useState('');
    const [error, setError] = useState('');

    useEffect(() => setValue(draft.postText), [draft.postText]);
    useEffect(() => {
        if (platform.schedulable) nextFreeSlot(platform.id).then(setSlot);
    }, [platform]);

    const copy = async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const schedule = async () => {
        setState('scheduling');
        setError('');
        try {
            await schedulePost({ platform: platform.id, caption: value, at: slot });
            setState('scheduled');
        } catch (err) {
            setError(err.message);
            setState('');
        }
    };

    const overLimit = platform.perPost ? (draft.thread || []).some((t) => t.length > platform.limit) : value.length > platform.limit;

    return (
        <article className="surface draft-card">
            <header className="draft-card__head">
                <h3>{platform.label}</h3>
                <span className={`draft-card__count ${overLimit ? 'is-over' : ''}`}>
                    {platform.perPost ? `${draft.thread.length} posts` : `${value.length.toLocaleString()} / ${platform.limit.toLocaleString()}`}
                </span>
            </header>

            {draft.script?.length ? (
                <div className="draft-card__script">
                    <span>Script</span>
                    <ol>
                        {draft.script.map((line, i) => (
                            <li key={i}>{line}</li>
                        ))}
                    </ol>
                </div>
            ) : null}

            {draft.script?.length ? <span className="draft-card__label">Caption</span> : null}
            <textarea className="input draft-card__text" value={value} onChange={(e) => setValue(e.target.value)} rows={Math.min(14, Math.max(3, Math.ceil(value.length / 70)))} />
            {draft.tags?.length ? <p className="draft-card__tags">Tags: {draft.tags.join(', ')}</p> : null}
            {error ? <p className="draft-card__error">{error}</p> : null}

            <div className="draft-card__actions">
                <button className="btn btn-secondary btn-sm" onClick={copy}>
                    {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
                </button>
                {platform.schedulable ? (
                    state === 'scheduled' ? (
                        <span className="draft-card__done">
                            <CalendarCheck size={14} /> Scheduled for {formatSlot(slot)}
                        </span>
                    ) : (
                        <button className="btn btn-primary btn-sm" onClick={schedule} disabled={!slot || state === 'scheduling'}>
                            {state === 'scheduling' ? <Loader2 size={14} className="spin" /> : <CalendarPlus size={14} />}
                            {slot ? `Schedule for ${formatSlot(slot)}` : 'Finding a slot…'}
                        </button>
                    )
                ) : null}
                {platform.calendar ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => navigate('/dashboard/scheduler', { state: { caption: value } })}>
                        <CalendarPlus size={14} /> Add a video and schedule
                    </button>
                ) : null}
            </div>
        </article>
    );
}
