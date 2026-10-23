import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, Check, CheckCircle2, Copy, Download, Loader2, Lock, MessageSquare, Pin, RotateCcw, Send, Trash2, Upload, X } from 'lucide-react';
import { agencyApi, formatTimecode, PLATFORM_LABELS, STATUS_META, uploadLibraryVideo } from '../../lib/agency-api';

/** Calendar platform ids. */
const CALENDAR_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube'];

const ACTIVITY = {
    uploaded: 'uploaded version',
    new_version: 'uploaded version',
    sent: 'sent version',
    comment: 'commented on version',
    approved: 'approved version',
    changes_requested: 'requested changes on version',
    reopened: 'reopened for review, version',
};

export function StatusBadge({ status }) {
    const meta = STATUS_META[status] || STATUS_META.draft;
    return <span className={`cl-status is-${meta.tone}`}>{meta.label}</span>;
}

/**
 * The drawer for one video: watch versions, read and answer client feedback, edit post details,
 * upload a new version, send for approval and schedule.
 */
export default function AssetPanel({ assetId, clients, onClose, onChanged, onDeleted, onSend }) {
    const navigate = useNavigate();
    const videoRef = useRef(null);
    const fileRef = useRef(null);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [version, setVersion] = useState(null);
    const [time, setTime] = useState(0);
    const [draft, setDraft] = useState(null);
    const [reply, setReply] = useState('');
    const [pin, setPin] = useState(false);
    const [internal, setInternal] = useState(false); // team-only note, never shown on the review page
    const [busy, setBusy] = useState('');
    const [upload, setUpload] = useState(null);
    const [versionNote, setVersionNote] = useState('');
    const [copied, setCopied] = useState('');
    const [allVersions, setAllVersions] = useState(true);
    const pendingSeek = useRef(null);

    const load = async () => {
        try {
            const d = await agencyApi.asset(assetId);
            setData(d);
            setVersion(d.asset.currentVersion);
            setDraft({ title: d.asset.title, caption: d.asset.caption, platforms: d.asset.platforms, dueDate: d.asset.dueDate || '', clientId: d.asset.clientId || '' });
        } catch (err) {
            setError(err.message);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [assetId]);

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

    if (!data) {
        return (
            <div className="cl-drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
                <aside className="cl-drawer">
                    <div className="cl-drawer__loading">{error ? <div className="error-banner">{error}</div> : <Loader2 size={20} className="spin" />}</div>
                </aside>
            </div>
        );
    }

    const { asset, comments, reviews } = data;
    const v = asset.versions.find((x) => x.n === version) || asset.versions[0];
    // Newest version first, then by moment in the video: earlier feedback stays visible after a new upload.
    const shown = comments
        .filter((c) => allVersions || c.version === version || c.version == null)
        .sort((a, b) => (b.version || 0) - (a.version || 0) || (a.timecode ?? 1e9) - (b.timecode ?? 1e9) || String(a.createdAt).localeCompare(String(b.createdAt)));
    const openFeedback = comments.filter((c) => c.author.kind === 'client' && !c.resolved).length;
    const dirty = draft && (draft.title !== asset.title || draft.caption !== asset.caption || draft.dueDate !== (asset.dueDate || '') || draft.clientId !== (asset.clientId || '') || draft.platforms.join() !== asset.platforms.join());

    /** Jumps to a moment; a comment on another version switches the player to that version first. */
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

    const saveDetails = () =>
        run('save', async () => {
            const { asset: next } = await agencyApi.updateAsset(asset.id, { ...draft, dueDate: draft.dueDate || null, clientId: draft.clientId || null });
            setData((d) => ({ ...d, asset: { ...d.asset, ...next } }));
            onChanged(next);
        });

    const sendReply = (e) => {
        e.preventDefault();
        if (!reply.trim()) return;
        run('reply', async () => {
            const { comment } = await agencyApi.comment(asset.id, { text: reply, version, timecode: pin && time > 0 ? time : null, internal });
            setReply('');
            setData((d) => ({ ...d, comments: [...d.comments, comment] }));
        });
    };

    /** Sends an approved (or changes-requested) video back to the client: clears the decision. */
    const reopen = () => {
        if (!window.confirm('Reopen this video for review? The current approval is cleared and the client can decide again.')) return;
        run('reopen', async () => {
            const { asset: next } = await agencyApi.updateAsset(asset.id, { status: 'in_review' });
            onChanged(next);
            await load();
        });
    };

    const toggleResolved = (c) =>
        run(`resolve-${c.id}`, async () => {
            const { comment } = await agencyApi.resolveComment(asset.id, c.id, !c.resolved);
            setData((d) => ({ ...d, comments: d.comments.map((x) => (x.id === c.id ? comment : x)) }));
        });

    const newVersion = (file) => {
        if (!file) return;
        setUpload(0);
        setError('');
        uploadLibraryVideo(file, { assetId: asset.id, note: versionNote }, setUpload)
            .then(async (next) => {
                setUpload(null);
                setVersionNote('');
                onChanged(next);
                await load();
            })
            .catch((err) => {
                setUpload(null);
                setError(err.message);
            });
    };

    const schedule = () =>
        run('schedule', async () => {
            const response = await fetch(v.url);
            if (!response.ok) throw new Error('Could not load the video to schedule it.');
            const blob = await response.blob();
            const name = `${asset.title.replace(/[^\w-]+/g, '-').toLowerCase() || 'video'}.mp4`;
            navigate('/dashboard/scheduler', {
                state: {
                    mediaFile: new File([blob], name, { type: blob.type || 'video/mp4' }),
                    caption: asset.caption || asset.title,
                    platforms: asset.platforms.filter((p) => CALENDAR_PLATFORMS.includes(p)),
                },
            });
        });

    const remove = () => {
        if (!window.confirm(`Delete "${asset.title}" and all its versions and comments? Review links will stop showing it.`)) return;
        run('delete', async () => {
            await agencyApi.deleteAsset(asset.id);
            onDeleted(asset.id);
        });
    };

    const copyLink = async (url, id) => {
        try {
            await navigator.clipboard.writeText(url);
            setCopied(id);
            setTimeout(() => setCopied(''), 1500);
        } catch {
            setError("Couldn't copy the link.");
        }
    };

    const approvedNow = asset.approval?.status === 'approved' && asset.approval.version === asset.currentVersion;
    const portrait = v?.width && v?.height && v.height > v.width;

    return (
        <div className="cl-drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <aside className="cl-drawer" role="dialog" aria-label={asset.title}>
                <header className="cl-drawer__head">
                    <div>
                        <StatusBadge status={asset.status} />
                        <h2>{asset.title}</h2>
                    </div>
                    <button type="button" className="btn-icon btn-ghost" onClick={onClose} aria-label="Close">
                        <X size={18} />
                    </button>
                </header>

                <div className="cl-drawer__body">
                    <div className={`cl-player ${portrait ? 'is-portrait' : ''}`}>
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

                    <div className="cl-versions">
                        <div className="segmented">
                            {asset.versions.map((x) => (
                                <button key={x.n} type="button" className={version === x.n ? 'is-active' : ''} onClick={() => setVersion(x.n)}>
                                    v{x.n}
                                </button>
                            ))}
                        </div>
                        <input ref={fileRef} type="file" accept="video/*" hidden onChange={(e) => newVersion(e.target.files?.[0])} />
                        {upload !== null ? (
                            <span className="cl-upload-pill">
                                <Loader2 size={13} className="spin" /> {upload < 100 ? `Uploading ${upload}%` : 'Processing…'}
                            </span>
                        ) : (
                            <div className="cl-newversion">
                                <input className="input" placeholder="What changed? (optional)" value={versionNote} onChange={(e) => setVersionNote(e.target.value)} maxLength={300} />
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
                                    <Upload size={14} /> New version
                                </button>
                            </div>
                        )}
                    </div>
                    {v?.note ? <p className="muted cl-small">v{v.n}: {v.note}</p> : null}

                    {approvedNow ? (
                        <div className="cl-approved">
                            <CheckCircle2 size={16} /> Approved by {asset.approval.by} on {new Date(asset.approval.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            <button type="button" className="btn btn-ghost btn-sm" onClick={reopen} disabled={busy === 'reopen'}>
                                {busy === 'reopen' ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />} Reopen
                            </button>
                        </div>
                    ) : asset.approval?.status === 'changes_requested' ? (
                        <div className="cl-changes">
                            <RotateCcw size={16} /> {asset.approval.by} asked for changes on v{asset.approval.version}. Upload a new version when it's fixed; the client's link updates automatically.
                        </div>
                    ) : null}

                    <div className="cl-drawer__actions">
                        <button type="button" className="btn btn-primary" onClick={() => onSend([asset])}>
                            <Send size={15} /> {reviews.some((r) => !r.revoked) ? 'Send again' : 'Send for approval'}
                        </button>
                        <button type="button" className={`btn ${approvedNow ? 'btn-primary' : 'btn-secondary'}`} onClick={() => (approvedNow || window.confirm('This version is not approved yet. Schedule it anyway?')) && schedule()} disabled={busy === 'schedule'}>
                            {busy === 'schedule' ? <Loader2 size={15} className="spin" /> : <CalendarPlus size={15} />} Schedule
                        </button>
                        <a className="btn btn-ghost" href={v?.url} download target="_blank" rel="noreferrer" aria-label="Download">
                            <Download size={15} />
                        </a>
                    </div>

                    {error ? <div className="error-banner">{error}</div> : null}

                    {/* Feedback */}
                    <section className="cl-section">
                        <div className="cl-section__head">
                            <h3>
                                <MessageSquare size={15} /> Feedback {openFeedback ? <span className="cl-dot">{openFeedback} open</span> : null}
                            </h3>
                            {asset.versions.length > 1 ? (
                                <div className="segmented cl-mini-seg">
                                    <button type="button" className={allVersions ? 'is-active' : ''} onClick={() => setAllVersions(true)}>
                                        All versions
                                    </button>
                                    <button type="button" className={!allVersions ? 'is-active' : ''} onClick={() => setAllVersions(false)}>
                                        v{version} only
                                    </button>
                                </div>
                            ) : null}
                        </div>
                        {shown.length === 0 ? <p className="muted cl-small">No comments yet. When the client comments on their link, it shows here.</p> : null}
                        <ul className="cl-comments">
                            {shown.map((c) => (
                                <li key={c.id} className={`${c.author.kind === 'client' ? 'is-client' : 'is-team'} ${c.resolved ? 'is-resolved' : ''} ${c.internal ? 'is-internal' : ''}`}>
                                    <div className="cl-comment__head">
                                        <strong>{c.author.name}</strong>
                                        <span className="cl-who">{c.author.kind === 'client' ? 'Client' : c.internal ? 'Internal note' : 'Team'}</span>
                                        {asset.versions.length > 1 && c.version ? <span className="cl-vtag">v{c.version}</span> : null}
                                        {c.timecode != null ? (
                                            <button type="button" className="cl-time" onClick={() => seek(c.timecode, c.version || version)}>
                                                {formatTimecode(c.timecode)}
                                            </button>
                                        ) : null}
                                        <span className="cl-when">{c.createdAt ? new Date(c.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                                        {c.author.kind === 'client' ? (
                                            <button type="button" className={`cl-resolve ${c.resolved ? 'is-done' : ''}`} onClick={() => toggleResolved(c)} disabled={busy === `resolve-${c.id}`}>
                                                <Check size={12} /> {c.resolved ? 'Done' : 'Mark done'}
                                            </button>
                                        ) : null}
                                    </div>
                                    <p>{c.text}</p>
                                </li>
                            ))}
                        </ul>
                        <form className="cl-reply" onSubmit={sendReply}>
                            <textarea className="input" rows={2} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={internal ? 'Note for the team (the client never sees this)…' : 'Reply to the client (they see this on their review page)…'} />
                            <div className="cl-reply__row">
                                <label className="check">
                                    <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /> <Pin size={13} /> At {formatTimecode(time)}
                                </label>
                                <label className="check">
                                    <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> <Lock size={13} /> Internal note
                                </label>
                                <button type="submit" className="btn btn-primary btn-sm" disabled={!reply.trim() || busy === 'reply'}>
                                    {busy === 'reply' ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {internal ? 'Add note' : 'Reply'}
                                </button>
                            </div>
                        </form>
                    </section>

                    {/* Post details */}
                    <section className="cl-section">
                        <h3>Post details</h3>
                        <label className="field">
                            <span>Title</span>
                            <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={120} />
                        </label>
                        <div className="field-row">
                            <label className="field">
                                <span>Client</span>
                                <select className="input" value={draft.clientId} onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}>
                                    <option value="">No client</option>
                                    {clients.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="field">
                                <span>Planned post date</span>
                                <input className="input" type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
                            </label>
                        </div>
                        <div className="field">
                            <span>Platforms</span>
                            <div className="cl-chips">
                                {Object.entries(PLATFORM_LABELS).map(([id, label]) => (
                                    <button
                                        key={id}
                                        type="button"
                                        className={`chip ${draft.platforms.includes(id) ? 'is-active' : ''}`}
                                        onClick={() => setDraft({ ...draft, platforms: draft.platforms.includes(id) ? draft.platforms.filter((p) => p !== id) : [...draft.platforms, id] })}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <label className="field">
                            <span>Caption</span>
                            <textarea className="input" rows={4} maxLength={2200} value={draft.caption} onChange={(e) => setDraft({ ...draft, caption: e.target.value })} placeholder="The client sees this caption with the video." />
                        </label>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={saveDetails} disabled={!dirty || busy === 'save'}>
                            {busy === 'save' ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Save details
                        </button>
                    </section>

                    {reviews.length ? (
                        <section className="cl-section">
                            <h3>Review links</h3>
                            <ul className="cl-links">
                                {reviews.map((r) => (
                                    <li key={r.id} className={r.revoked ? 'is-off' : ''}>
                                        <span>
                                            {r.title}
                                            <small>{r.revoked ? 'Switched off' : r.expiresAt ? `Works until ${new Date(r.expiresAt).toLocaleDateString()}` : ''}</small>
                                        </span>
                                        {!r.revoked ? (
                                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyLink(r.url, r.id)}>
                                                {copied === r.id ? <Check size={14} /> : <Copy size={14} />}
                                            </button>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ) : null}

                    {asset.activity?.length ? (
                        <section className="cl-section">
                            <h3>History</h3>
                            <ul className="cl-activity">
                                {asset.activity.slice(0, 12).map((a, i) => (
                                    <li key={i}>
                                        <strong>{a.by}</strong> {ACTIVITY[a.type] || a.type} {a.version}
                                        <small>{new Date(a.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ) : null}

                    <button type="button" className="btn btn-ghost btn-sm cl-delete" onClick={remove} disabled={busy === 'delete'}>
                        <Trash2 size={14} /> Delete video
                    </button>
                </div>
            </aside>
        </div>
    );
}
