import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, CalendarDays, Check, CheckCircle2, Download, Loader2, MessageSquare, Pin, RefreshCw, RotateCcw, Send } from 'lucide-react';
import { formatTimecode, PLATFORM_LABELS, reviewApi, STATUS_META } from '../../lib/agency-api';
import './Review.css';

/**
 * Client review page (/review/:token). No account: the link is the access. Clients watch each
 * video, leave comments pinned to a moment, and approve or request changes.
 */

function useReviewer(token) {
    const key = `kengan_reviewer_${token}`;
    const [who, setWho] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem(key) || 'null') || { name: '', email: '' };
        } catch {
            return { name: '', email: '' };
        }
    });
    const save = (next) => {
        setWho(next);
        try {
            localStorage.setItem(key, JSON.stringify(next));
        } catch {
            /* private browsing */
        }
    };
    return [who, save];
}

function StatusPill({ status }) {
    const meta = STATUS_META[status] || STATUS_META.draft;
    return <span className={`rv-pill is-${meta.tone}`}>{status === 'in_review' ? 'Waiting for you' : meta.label}</span>;
}

function NameGate({ who, onSave }) {
    const [name, setName] = useState(who.name);
    const [email, setEmail] = useState(who.email);
    return (
        <form
            className="rv-gate"
            onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) onSave({ name: name.trim(), email: email.trim() });
            }}
        >
            <div>
                <strong>Who's reviewing?</strong>
                <small>Your name appears next to your comments and approvals.</small>
            </div>
            <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required aria-label="Your name" />
            <input className="input" type="email" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} aria-label="Email" />
            <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
                Continue
            </button>
        </form>
    );
}

function AssetReview({ token, asset, agencyName, who, needName, allowDownload, onChange, onRefresh }) {
    const videoRef = useRef(null);
    const [version, setVersion] = useState(asset.currentVersion);
    const [time, setTime] = useState(0);
    const [text, setText] = useState('');
    const [pin, setPin] = useState(true);
    const [mode, setMode] = useState(null); // 'changes' while writing a change request
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [stale, setStale] = useState(false); // the server said this view is out of date (409)
    const [showCaption, setShowCaption] = useState(false);
    const pendingSeek = useRef(null);

    const v = asset.versions.find((x) => x.n === version) || asset.versions[0];
    const latest = version === asset.currentVersion;
    // All versions' comments (newest version first), so earlier notes stay visible after a new upload.
    const comments = useMemo(
        () =>
            asset.comments
                .slice()
                .sort((a, b) => (b.version || 0) - (a.version || 0) || (a.timecode ?? 1e9) - (b.timecode ?? 1e9) || String(a.createdAt).localeCompare(String(b.createdAt))),
        [asset.comments]
    );
    const approvedThis = asset.approval?.status === 'approved' && asset.approval.version === asset.currentVersion;

    const seek = (t, onVersion = version) => {
        if (onVersion !== version) {
            pendingSeek.current = t;
            setVersion(onVersion);
            return;
        }
        if (!videoRef.current) return;
        videoRef.current.currentTime = t;
        videoRef.current.play().catch(() => {});
    };

    const run = async (label, fn) => {
        if (!who.name) {
            needName();
            return;
        }
        setBusy(label);
        setError('');
        setStale(false);
        try {
            await fn();
        } catch (err) {
            setError(err.message);
            setStale(err.status === 409);
        } finally {
            setBusy('');
        }
    };

    const sendComment = (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        run('comment', async () => {
            const { comment } = await reviewApi.comment(token, asset.id, { name: who.name, email: who.email, text, version, timecode: pin && time > 0 ? time : null });
            setText('');
            onChange({ ...asset, comments: [...asset.comments, comment] });
        });
    };

    const decide = (decision) =>
        run(decision, async () => {
            // The version on screen: the server refuses (409) if a newer one was uploaded meanwhile.
            const { approval, status } = await reviewApi.decide(token, asset.id, { name: who.name, email: who.email, decision, version, note: decision === 'changes_requested' ? note : '' });
            const extra = decision === 'changes_requested' && note.trim()
                ? [{ id: `local-${Date.now()}`, text: note.trim(), timecode: null, version: asset.currentVersion, author: { kind: 'client', name: who.name }, resolved: false, createdAt: new Date().toISOString() }]
                : [];
            setMode(null);
            setNote('');
            onChange({ ...asset, status, approval, comments: [...asset.comments, ...extra] });
        });

    const ratio = v?.width && v?.height ? v.width / v.height : 9 / 16;
    const markers = comments.filter((c) => c.timecode != null && v?.duration && (c.version || version) === version);

    return (
        <article className="rv-asset surface" id={`asset-${asset.id}`}>
            <header className="rv-asset__head">
                <div>
                    <h2>{asset.title}</h2>
                    <div className="rv-asset__meta">
                        <StatusPill status={asset.status} />
                        {asset.dueDate ? (
                            <span>
                                <CalendarDays size={13} /> Planned for {new Date(`${asset.dueDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                            </span>
                        ) : null}
                        {asset.platforms.length ? <span>{asset.platforms.map((p) => PLATFORM_LABELS[p] || p).join(' · ')}</span> : null}
                    </div>
                </div>
                {asset.versions.length > 1 ? (
                    <select className="input rv-version" value={version} onChange={(e) => setVersion(Number(e.target.value))} aria-label="Version">
                        {asset.versions.map((x) => (
                            <option key={x.n} value={x.n}>
                                Version {x.n}
                                {x.n === asset.currentVersion ? ' (latest)' : ''}
                            </option>
                        ))}
                    </select>
                ) : null}
            </header>

            <div className={`rv-player ${ratio < 1 ? 'is-portrait' : ''}`} style={{ '--ratio': ratio }}>
                <video
                    ref={videoRef}
                    key={v?.url}
                    src={v?.url}
                    poster={v?.posterUrl || undefined}
                    controls
                    playsInline
                    preload="metadata"
                    onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                    onLoadedMetadata={(e) => {
                        if (pendingSeek.current == null) return;
                        e.currentTarget.currentTime = pendingSeek.current;
                        pendingSeek.current = null;
                        e.currentTarget.play().catch(() => {});
                    }}
                />
            </div>
            {markers.length ? (
                <div className="rv-markers" aria-label="Comments on the timeline">
                    {markers.map((c) => (
                        <button
                            key={c.id}
                            type="button"
                            className={`rv-marker ${c.author.kind === 'client' ? 'is-client' : ''}`}
                            style={{ left: `${Math.min(100, (c.timecode / v.duration) * 100)}%` }}
                            onClick={() => seek(c.timecode)}
                            title={`${formatTimecode(c.timecode)} ${c.author.name}: ${c.text}`}
                            aria-label={`Comment at ${formatTimecode(c.timecode)}`}
                        />
                    ))}
                </div>
            ) : null}
            {!latest ? <p className="rv-note">You're looking at an older version. Switch to the latest to approve.</p> : null}
            {v?.note && latest ? <p className="rv-note">What changed: {v.note}</p> : null}

            {asset.caption ? (
                <div className="rv-caption">
                    <span>Post caption</span>
                    <p className={showCaption ? '' : 'is-clamped'}>{asset.caption}</p>
                    {asset.caption.length > 160 ? (
                        <button type="button" className="link-button" onClick={() => setShowCaption((s) => !s)}>
                            {showCaption ? 'Show less' : 'Show all'}
                        </button>
                    ) : null}
                </div>
            ) : null}

            {/* Decision */}
            {approvedThis ? (
                <div className="rv-approved">
                    <CheckCircle2 size={18} /> Approved by {asset.approval.by} on{' '}
                    {new Date(asset.approval.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}. Thank you!
                </div>
            ) : mode === 'changes' ? (
                <div className="rv-changes">
                    <label className="field">
                        <span>What should change?</span>
                        <textarea className="input" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Use the new logo, and shorten the intro." autoFocus />
                    </label>
                    <div className="rv-actions">
                        <button className="btn btn-ghost" type="button" onClick={() => setMode(null)} disabled={!!busy}>
                            Cancel
                        </button>
                        <button className="btn btn-primary rv-btn-changes" type="button" onClick={() => decide('changes_requested')} disabled={!note.trim() || !!busy}>
                            {busy === 'changes_requested' ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />} Send change request
                        </button>
                    </div>
                </div>
            ) : (
                <div className="rv-actions">
                    <button className="btn btn-secondary" type="button" onClick={() => (who.name ? setMode('changes') : needName())} disabled={!latest || !!busy}>
                        <RotateCcw size={15} /> Request changes
                    </button>
                    <button className="btn btn-primary rv-btn-approve" type="button" onClick={() => decide('approved')} disabled={!latest || !!busy}>
                        {busy === 'approved' ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Approve
                    </button>
                </div>
            )}
            {asset.status === 'changes_requested' && !mode ? <p className="rv-note">You asked for changes. The team will upload a new version to this same link.</p> : null}
            {error ? (
                <div className="error-banner" role="alert">
                    {error}
                    {stale ? (
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={async () => {
                                setError('');
                                setStale(false);
                                setMode(null);
                                const next = await onRefresh();
                                if (next) setVersion(next.currentVersion);
                            }}
                        >
                            <RefreshCw size={14} /> Refresh
                        </button>
                    ) : null}
                </div>
            ) : null}

            {/* Comments */}
            <section className="rv-comments">
                <h3>
                    <MessageSquare size={15} /> Comments {comments.length ? `(${comments.length})` : ''}
                </h3>
                {comments.length === 0 ? <p className="muted">No comments yet. Pause the video where something needs attention and write it below.</p> : null}
                <ul>
                    {comments.map((c) => (
                        <li key={c.id} className={c.author.kind === 'client' ? 'is-client' : 'is-team'}>
                            <div className="rv-comment__head">
                                <strong>{c.author.kind === 'team' ? `${c.author.name} · ${agencyName}` : c.author.name}</strong>
                                {asset.versions.length > 1 && c.version ? <span className="rv-vtag">v{c.version}</span> : null}
                                {c.timecode != null ? (
                                    <button type="button" className="rv-time" onClick={() => seek(c.timecode, c.version || version)}>
                                        {formatTimecode(c.timecode)}
                                    </button>
                                ) : null}
                                {c.resolved ? <span className="rv-resolved">Done</span> : null}
                            </div>
                            <p>{c.text}</p>
                        </li>
                    ))}
                </ul>
                <form className="rv-composer" onSubmit={sendComment}>
                    <textarea
                        className="input"
                        rows={2}
                        maxLength={2000}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder={who.name ? 'Write a comment…' : 'Add your name to comment'}
                        onFocus={() => !who.name && needName()}
                        aria-label="Comment"
                    />
                    <div className="rv-composer__row">
                        <label className="check">
                            <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />
                            <Pin size={13} /> At {formatTimecode(time)}
                        </label>
                        <button className="btn btn-primary btn-sm" type="submit" disabled={!text.trim() || !!busy}>
                            {busy === 'comment' ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Send
                        </button>
                    </div>
                </form>
            </section>

            {allowDownload && v?.url ? (
                <a className="btn btn-ghost btn-sm rv-download" href={v.url} download target="_blank" rel="noreferrer">
                    <Download size={14} /> Download this version
                </a>
            ) : null}
        </article>
    );
}

export default function ReviewPage() {
    const { token } = useParams();
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [who, setWho] = useReviewer(token);
    const [askName, setAskName] = useState(false);
    const gateRef = useRef(null);

    useEffect(() => {
        reviewApi
            .get(token)
            .then(setData)
            .catch((err) => setError(err.message));
    }, [token]);

    /** Reloads the review after a conflict; returns the fresh copy of one video (or null). */
    const refreshAsset = async (assetId) => {
        try {
            const next = await reviewApi.get(token);
            setData(next);
            return next.assets.find((a) => a.id === assetId) || null;
        } catch (err) {
            setError(err.message);
            return null;
        }
    };

    useEffect(() => {
        if (data?.agency?.name) document.title = `Review · ${data.agency.name}`;
    }, [data]);

    const needName = () => {
        setAskName(true);
        setTimeout(() => gateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    };

    if (error) {
        return (
            <div className="rv-page rv-page--center">
                <div className="surface rv-empty">
                    <AlertTriangle size={28} />
                    <h1>This link can't be opened</h1>
                    <p>{error}</p>
                </div>
            </div>
        );
    }
    if (!data) {
        return (
            <div className="rv-page rv-page--center">
                <Loader2 size={24} className="spin" />
            </div>
        );
    }

    const { agency, review, assets } = data;
    const approved = assets.filter((a) => a.status === 'approved').length;
    const update = (next) => setData((d) => ({ ...d, assets: d.assets.map((a) => (a.id === next.id ? next : a)) }));

    return (
        <div className="rv-page">
            <header className="rv-top">
                <div className="rv-brand">
                    {agency.logo ? <img src={agency.logo} alt="" /> : <span className="rv-brand__mark">{agency.name.slice(0, 1)}</span>}
                    <strong>{agency.name}</strong>
                </div>
                <span className="rv-top__label">Content review</span>
            </header>

            <main className="rv-main">
                <section className="rv-intro">
                    {review.clientName ? <span className="rv-kicker">For {review.clientName}</span> : null}
                    <h1>{review.title}</h1>
                    {review.message ? (
                        <blockquote>
                            {review.message}
                            {review.sentBy ? <cite>{review.sentBy}</cite> : null}
                        </blockquote>
                    ) : null}
                    <p className="muted">
                        Watch each video, leave comments on the exact moment, then approve it or ask for changes.
                        {review.expiresAt ? ` This link works until ${new Date(review.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}.` : ''}
                    </p>
                </section>

                {!who.name || askName ? (
                    <div ref={gateRef}>
                        <NameGate
                            who={who}
                            onSave={(next) => {
                                setWho(next);
                                setAskName(false);
                            }}
                        />
                    </div>
                ) : (
                    <p className="rv-signed">
                        Reviewing as <strong>{who.name}</strong>.{' '}
                        <button type="button" className="link-button" onClick={() => setAskName(true)}>
                            Not you?
                        </button>
                    </p>
                )}

                {assets.length === 0 ? <div className="surface rv-empty">The videos in this review were removed by the agency.</div> : null}
                {assets.map((a) => (
                    <AssetReview key={a.id} token={token} asset={a} agencyName={agency.name} who={who} needName={needName} allowDownload={review.allowDownload} onChange={update} onRefresh={() => refreshAsset(a.id)} />
                ))}
            </main>

            {assets.length > 1 ? (
                <footer className="rv-progress">
                    <span>
                        {approved} of {assets.length} approved
                    </span>
                    <div className="progress">
                        <div style={{ width: `${(approved / assets.length) * 100}%` }} />
                    </div>
                </footer>
            ) : null}
            <p className="rv-powered">Shared with KenganSocial</p>
        </div>
    );
}
