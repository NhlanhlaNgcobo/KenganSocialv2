import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgeCheck, Bell, Check, CheckSquare, Copy, Eye, Film, FolderOpen, Link2, Loader2, Lock, MessageSquare, Pencil, Plus, Send, Upload, Users, XCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { APPROVAL_PLANS } from '../../utils/planLimits';
import { agencyApi, formatBytes, formatTimecode, uploadLibraryVideo } from '../../lib/agency-api';
import AssetPanel, { StatusBadge } from './AssetPanel';
import ClientModal from './ClientModal';
import SendReviewModal from './SendReviewModal';
import './Clients.css';
import { confirmDialog } from '../../lib/dialogs';

/**
 * Clients & approvals: each client brand has a video library; videos go to the client on a review
 * link (no login), the client comments and approves, and approved videos go to the calendar.
 */

/** Client feedback shows up without a reload: refreshed this often while the tab is visible, and on focus. */
const POLL_MS = 45 * 1000;
const MIN_REFRESH_GAP_MS = 10 * 1000;

const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'draft', label: 'Drafts' },
    { id: 'in_review', label: 'Waiting on client' },
    { id: 'changes_requested', label: 'Changes requested' },
    { id: 'approved', label: 'Approved' },
];

function ReviewLinks({ reviews, clients, onRevoke }) {
    const [copied, setCopied] = useState('');
    const byId = Object.fromEntries(clients.map((c) => [c.id, c]));
    if (!reviews.length) {
        return (
            <div className="surface cl-empty">
                <Link2 size={26} />
                <h3>No review links yet</h3>
                <p>Select videos in the library and choose Send for approval. Each link shows you when the client opened it and what they decided.</p>
            </div>
        );
    }
    const copy = async (r) => {
        try {
            await navigator.clipboard.writeText(r.url);
            setCopied(r.id);
            setTimeout(() => setCopied(''), 1500);
        } catch {
            /* the link is visible in the row */
        }
    };
    return (
        <div className="cl-reviews">
            {reviews.map((r) => {
                const off = r.revoked || r.expired;
                return (
                    <article key={r.id} className={`surface cl-review ${off ? 'is-off' : ''}`}>
                        <div className="cl-review__thumbs">
                            {r.assets.slice(0, 3).map((a) => (
                                <span key={a.id}>{a.posterUrl ? <img src={a.posterUrl} alt="" /> : null}</span>
                            ))}
                        </div>
                        <div className="cl-review__main">
                            <strong>{r.title}</strong>
                            <small>
                                {r.clientId && byId[r.clientId] ? `${byId[r.clientId].name} · ` : ''}
                                {r.total} video{r.total === 1 ? '' : 's'} · sent {new Date(r.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                                {r.createdByName ? ` by ${r.createdByName}` : ''}
                            </small>
                            <div className="cl-review__stats">
                                <span className="cl-stat is-success">
                                    <BadgeCheck size={13} /> {r.approved}/{r.total} approved
                                </span>
                                {r.changes ? <span className="cl-stat is-warning">{r.changes} need changes</span> : null}
                                <span className="cl-stat">
                                    <Eye size={13} /> {r.views ? `Opened ${r.views}×, last ${new Date(r.lastViewedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'Not opened yet'}
                                </span>
                                {r.reviewers.length ? <span className="cl-stat">By {r.reviewers.join(', ')}</span> : null}
                                <span className="cl-stat">{r.revoked ? 'Switched off' : r.expired ? 'Expired' : `Until ${new Date(r.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}</span>
                            </div>
                        </div>
                        {!off ? (
                            <div className="cl-review__actions">
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(r)}>
                                    {copied === r.id ? <Check size={14} /> : <Copy size={14} />} {copied === r.id ? 'Copied' : 'Copy link'}
                                </button>
                                <a className="btn btn-ghost btn-sm" href={r.url} target="_blank" rel="noreferrer">
                                    <Eye size={14} /> Preview
                                </a>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRevoke(r)}>
                                    <XCircle size={14} /> Switch off
                                </button>
                            </div>
                        ) : null}
                    </article>
                );
            })}
        </div>
    );
}

/** The bell: what clients said or decided on review links, newest first. */
function FeedbackBell({ items, unread, onOpen, onReadAll }) {
    const [open, setOpen] = useState(false);
    const wrap = useRef(null);
    useEffect(() => {
        if (!open) return undefined;
        const close = (e) => !wrap.current?.contains(e.target) && setOpen(false);
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);
    return (
        <div className="cl-notify" ref={wrap}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={unread ? `Client feedback, ${unread} new` : 'Client feedback'}>
                <Bell size={15} /> Feedback {unread ? <span className="cl-dot">{unread}</span> : null}
            </button>
            {open ? (
                <div className="cl-notify__panel" role="dialog" aria-label="Client feedback">
                    <div className="cl-notify__head">
                        <strong>Client feedback</strong>
                        {unread ? (
                            <button type="button" className="link-button" onClick={onReadAll}>
                                Mark all read
                            </button>
                        ) : null}
                    </div>
                    {items.length === 0 ? <p className="muted cl-small">Nothing yet. Comments and approvals from review links show up here.</p> : null}
                    <ul>
                        {items.map((n) => (
                            <li key={n.id}>
                                <button
                                    type="button"
                                    className={`cl-notify__item ${n.read ? '' : 'is-unread'}`}
                                    onClick={() => {
                                        setOpen(false);
                                        onOpen(n);
                                    }}
                                >
                                    <strong>{n.title}</strong>
                                    {n.message ? <small>{n.message}</small> : null}
                                    {n.createdAt ? <small>{new Date(n.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small> : null}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}

/** Shown on plans without approvals: what it does and where to upgrade. */
function UpgradePrompt() {
    return (
        <div className="clients-page">
            <header className="page-head">
                <div>
                    <h1>Clients &amp; approvals</h1>
                    <p>Keep each client's videos in one place, send them a link to approve (no login for them), and schedule what's approved.</p>
                </div>
            </header>
            <div className="surface cl-locked">
                <span className="cl-locked__icon">
                    <Lock size={20} />
                </span>
                <h2>Part of Creator Pro, Agency and Enterprise</h2>
                <ul>
                    <li>A video library for every client brand, with versions</li>
                    <li>Review links clients open on their phone, no account needed</li>
                    <li>Comments pinned to the exact moment, Approve or Request changes</li>
                    <li>Send links on WhatsApp or email, then schedule what's approved</li>
                </ul>
                <p className="muted">Creator Pro includes 5 clients. Agency and Enterprise have no limit.</p>
                <Link to="/dashboard/billing" className="btn btn-primary">
                    See plans
                </Link>
            </div>
        </div>
    );
}

export default function ClientsPage() {
    const { plan } = useAuth();
    if (!APPROVAL_PLANS.includes(plan || 'starter')) return <UpgradePrompt />;
    return <ClientsWorkspace />;
}

function ClientsWorkspace() {
    const [tab, setTab] = useState('library');
    const [clients, setClients] = useState(null);
    const [maxClients, setMaxClients] = useState(1);
    const [assets, setAssets] = useState(null);
    const [storage, setStorage] = useState(null);
    const [reviews, setReviews] = useState([]);
    const [clientFilter, setClientFilter] = useState('all');
    const [status, setStatus] = useState('all');
    const [selecting, setSelecting] = useState(false);
    const [selected, setSelected] = useState([]);
    const [searchParams, setSearchParams] = useSearchParams();
    // A notification link (/dashboard/clients?asset=<id>) opens that video.
    const [openAsset, setOpenAsset] = useState(() => searchParams.get('asset'));
    const [clientModal, setClientModal] = useState(null); // null | 'new' | client
    const [sending, setSending] = useState(null);
    const [uploads, setUploads] = useState([]);
    const [error, setError] = useState('');
    const [notifications, setNotifications] = useState({ items: [], unread: 0 });
    const fileRef = useRef(null);
    const lastRefresh = useRef(0);
    const alive = useRef(true);

    // Loads everything; later changes update local state from each response, and a light poll
    // (plus window focus) picks up client comments and decisions without a reload.
    const refresh = useCallback((initial = false) => {
        lastRefresh.current = Date.now();
        agencyApi
            .notifications()
            .then((n) => alive.current && setNotifications({ items: n.notifications || [], unread: n.unread || 0 }))
            .catch(() => {});
        return Promise.all([agencyApi.clients(), agencyApi.library(), agencyApi.reviews()])
            .then(([c, l, r]) => {
                if (!alive.current) return;
                setClients(c.clients);
                setMaxClients(c.maxClients);
                setAssets(l.assets);
                setStorage(l.storage);
                setReviews(r.reviews);
            })
            .catch((err) => {
                // A failed background poll stays quiet; the next one tries again.
                if (!alive.current || !initial) return;
                setError(err.message);
                setClients((c) => c || []);
                setAssets((a) => a || []);
            });
    }, []);

    useEffect(() => {
        alive.current = true;
        refresh(true);
        const maybeRefresh = () => document.visibilityState === 'visible' && Date.now() - lastRefresh.current > MIN_REFRESH_GAP_MS && refresh();
        const timer = setInterval(maybeRefresh, POLL_MS);
        window.addEventListener('focus', maybeRefresh);
        document.addEventListener('visibilitychange', maybeRefresh);
        return () => {
            alive.current = false;
            clearInterval(timer);
            window.removeEventListener('focus', maybeRefresh);
            document.removeEventListener('visibilitychange', maybeRefresh);
        };
    }, [refresh]);

    // Once opened, drop ?asset= so closing the drawer and reloading does not reopen it.
    const assetParam = searchParams.get('asset');
    useEffect(() => {
        if (!assetParam) return;
        setSearchParams(
            (p) => {
                p.delete('asset');
                return p;
            },
            { replace: true }
        );
    }, [assetParam, setSearchParams]);

    const openNotification = (n) => {
        if (n.assetId) {
            setTab('library');
            setOpenAsset(n.assetId);
        }
        if (!n.read) {
            setNotifications((s) => ({ items: s.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)), unread: Math.max(0, s.unread - 1) }));
            agencyApi.markNotificationsRead([n.id]).catch(() => {});
        }
    };

    const readAllNotifications = () => {
        setNotifications((s) => ({ items: s.items.map((x) => ({ ...x, read: true })), unread: 0 }));
        agencyApi.markNotificationsRead().catch(() => {});
    };

    const clientById = useMemo(() => Object.fromEntries((clients || []).map((c) => [c.id, c])), [clients]);
    const activeClient = clientFilter !== 'all' && clientFilter !== 'none' ? clientById[clientFilter] : null;

    const inClient = (assets || []).filter((a) => (clientFilter === 'all' ? true : clientFilter === 'none' ? !a.clientId : a.clientId === clientFilter));
    const visible = inClient.filter((a) => status === 'all' || a.status === status);
    const countFor = (s) => inClient.filter((a) => s === 'all' || a.status === s).length;
    const newFeedback = (assets || []).filter((a) => a.clientActivity).length;

    const upsertAsset = (next) => setAssets((list) => [next, ...(list || []).filter((a) => a.id !== next.id)]);

    const startUpload = (files) => {
        const clientId = activeClient?.id || '';
        for (const file of Array.from(files || [])) {
            if (!file.type.startsWith('video/')) {
                setError(`${file.name} is not a video.`);
                continue;
            }
            const key = `${file.name}-${Date.now()}`;
            setUploads((u) => [...u, { key, name: file.name, progress: 0 }]);
            uploadLibraryVideo(file, { clientId }, (p) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x))))
                .then((asset) => {
                    upsertAsset(asset);
                    agencyApi.library().then((l) => setStorage(l.storage)).catch(() => {});
                })
                .catch((err) => setError(`${file.name}: ${err.message}`))
                .finally(() => setUploads((u) => u.filter((x) => x.key !== key)));
        }
    };

    const saveClient = async (form) => {
        if (clientModal === 'new') {
            const { client } = await agencyApi.createClient(form);
            setClients((c) => [...(c || []), client].sort((a, b) => a.name.localeCompare(b.name)));
            setClientFilter(client.id);
        } else {
            const { client } = await agencyApi.updateClient(clientModal.id, form);
            setClients((c) => c.map((x) => (x.id === client.id ? { ...x, ...client } : x)));
        }
        setClientModal(null);
    };

    const toggleSelect = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

    const openSend = (list) => {
        const clientIds = [...new Set(list.map((a) => a.clientId || null))];
        setSending({ assets: list, client: clientIds.length === 1 && clientIds[0] ? clientById[clientIds[0]] : null });
    };

    const onSent = () => {
        setSelecting(false);
        setSelected([]);
        agencyApi.library().then((l) => setAssets(l.assets)).catch(() => {});
        agencyApi.reviews().then((r) => setReviews(r.reviews)).catch(() => {});
    };

    const revoke = async (r) => {
        if (!(await confirmDialog(`Switch off "${r.title}"? The client will no longer be able to open it.`, { confirmLabel: 'Switch off', danger: true }))) return;
        try {
            await agencyApi.revokeReview(r.id);
            setReviews((list) => list.map((x) => (x.id === r.id ? { ...x, revoked: true } : x)));
        } catch (err) {
            setError(err.message);
        }
    };

    const loading = clients === null || assets === null;
    const atLimit = maxClients !== -1 && (clients || []).length >= maxClients;
    const storagePct = storage ? Math.min(100, (storage.usedBytes / storage.limitBytes) * 100) : 0;

    return (
        <div className="clients-page">
            <header className="page-head">
                <div>
                    <h1>Clients &amp; approvals</h1>
                    <p>Keep each client's videos in one place, send them a link to approve (no login for them), and schedule what's approved.</p>
                </div>
                <div className="cl-head-actions">
                    <FeedbackBell items={notifications.items} unread={notifications.unread} onOpen={openNotification} onReadAll={readAllNotifications} />
                    <div className="segmented" role="tablist">
                        <button role="tab" aria-selected={tab === 'library'} className={tab === 'library' ? 'is-active' : ''} onClick={() => setTab('library')}>
                            <Film size={15} /> Library
                            {newFeedback ? <span className="cl-dot">{newFeedback}</span> : null}
                        </button>
                        <button role="tab" aria-selected={tab === 'reviews'} className={tab === 'reviews' ? 'is-active' : ''} onClick={() => setTab('reviews')}>
                            <Link2 size={15} /> Review links
                        </button>
                    </div>
                </div>
            </header>

            {error ? (
                <div className="error-banner" role="alert">
                    {error}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setError('')}>
                        Dismiss
                    </button>
                </div>
            ) : null}

            {loading ? (
                <p className="muted">
                    <Loader2 size={15} className="spin" /> Loading…
                </p>
            ) : tab === 'reviews' ? (
                <ReviewLinks reviews={reviews} clients={clients} onRevoke={revoke} />
            ) : (
                <div className="cl-layout">
                    <aside className="surface cl-clients">
                        <div className="cl-clients__head">
                            <h3>
                                <Users size={15} /> Clients
                            </h3>
                            <button type="button" className="btn-icon btn-ghost" onClick={() => setClientModal('new')} disabled={atLimit} title={atLimit ? `Your plan includes ${maxClients} client${maxClients === 1 ? '' : 's'}` : 'Add a client'} aria-label="Add a client">
                                <Plus size={16} />
                            </button>
                        </div>
                        <ul>
                            <li>
                                <button type="button" className={`cl-client ${clientFilter === 'all' ? 'is-active' : ''}`} onClick={() => setClientFilter('all')}>
                                    <span className="cl-client__dot is-all">
                                        <FolderOpen size={12} />
                                    </span>
                                    <span className="cl-client__name">All videos</span>
                                    <span className="cl-client__count">{assets.length}</span>
                                </button>
                            </li>
                            {clients.map((c) => (
                                <li key={c.id}>
                                    <button type="button" className={`cl-client ${clientFilter === c.id ? 'is-active' : ''}`} onClick={() => setClientFilter(c.id)}>
                                        <span className="cl-client__dot" style={{ background: c.color }}>
                                            {c.name.slice(0, 1).toUpperCase()}
                                        </span>
                                        <span className="cl-client__name">{c.name}</span>
                                        {c.counts?.newActivity ? <span className="cl-dot" title="New client feedback">{c.counts.newActivity}</span> : null}
                                        <span className="cl-client__count">{c.counts?.total || 0}</span>
                                    </button>
                                </li>
                            ))}
                            {assets.some((a) => !a.clientId) && clients.length ? (
                                <li>
                                    <button type="button" className={`cl-client ${clientFilter === 'none' ? 'is-active' : ''}`} onClick={() => setClientFilter('none')}>
                                        <span className="cl-client__dot is-all">?</span>
                                        <span className="cl-client__name">No client</span>
                                        <span className="cl-client__count">{assets.filter((a) => !a.clientId).length}</span>
                                    </button>
                                </li>
                            ) : null}
                        </ul>
                        {clients.length === 0 ? (
                            <button type="button" className="btn btn-primary btn-sm btn-block" onClick={() => setClientModal('new')}>
                                <Plus size={14} /> Add your first client
                            </button>
                        ) : null}
                        {atLimit ? <small className="muted cl-small">Your plan includes {maxClients} client{maxClients === 1 ? '' : 's'}. The Agency plan has no limit.</small> : null}
                        {storage ? (
                            <div className="cl-storage">
                                <small>
                                    Storage: {formatBytes(storage.usedBytes)} of {formatBytes(storage.limitBytes)}
                                </small>
                                <div className="progress">
                                    <div style={{ width: `${storagePct}%` }} />
                                </div>
                            </div>
                        ) : null}
                    </aside>

                    <section className="cl-main">
                        <div className="cl-toolbar">
                            <div className="cl-toolbar__title">
                                <h2>{activeClient ? activeClient.name : clientFilter === 'none' ? 'Videos without a client' : 'All videos'}</h2>
                                {activeClient ? (
                                    <button type="button" className="btn-icon btn-ghost" onClick={() => setClientModal(activeClient)} aria-label="Edit client">
                                        <Pencil size={14} />
                                    </button>
                                ) : null}
                            </div>
                            <div className="cl-toolbar__actions">
                                {selecting ? (
                                    <>
                                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setSelecting(false), setSelected([]))}>
                                            Cancel
                                        </button>
                                        <button type="button" className="btn btn-primary btn-sm" disabled={!selected.length} onClick={() => openSend(assets.filter((a) => selected.includes(a.id)))}>
                                            <Send size={14} /> Send {selected.length || ''} for approval
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelecting(true)} disabled={!visible.length}>
                                            <CheckSquare size={14} /> Select to send
                                        </button>
                                        <button type="button" className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()}>
                                            <Upload size={14} /> Upload videos
                                        </button>
                                    </>
                                )}
                                <input ref={fileRef} type="file" accept="video/*" multiple hidden onChange={(e) => (startUpload(e.target.files), (e.target.value = ''))} />
                            </div>
                        </div>

                        <div className="cl-filters">
                            {FILTERS.map((f) => (
                                <button key={f.id} type="button" className={`chip ${status === f.id ? 'is-active' : ''}`} onClick={() => setStatus(f.id)}>
                                    {f.label} <span className="cl-filter-count">{countFor(f.id)}</span>
                                </button>
                            ))}
                        </div>

                        <div
                            className="cl-grid"
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault();
                                startUpload(e.dataTransfer.files);
                            }}
                        >
                            {uploads.map((u) => (
                                <div key={u.key} className="cl-card is-uploading">
                                    <div className="cl-card__media">
                                        <Loader2 size={20} className="spin" />
                                        <small>{u.progress < 100 ? `Uploading ${u.progress}%` : 'Processing…'}</small>
                                    </div>
                                    <div className="cl-card__body">
                                        <strong>{u.name}</strong>
                                    </div>
                                </div>
                            ))}
                            {visible.map((a) => {
                                const isSelected = selected.includes(a.id);
                                const client = a.clientId ? clientById[a.clientId] : null;
                                return (
                                    <button
                                        key={a.id}
                                        type="button"
                                        className={`cl-card ${isSelected ? 'is-selected' : ''}`}
                                        onClick={() => {
                                            if (selecting) return toggleSelect(a.id);
                                            setOpenAsset(a.id);
                                            // Opening it marks the client feedback as seen (the server clears it too).
                                            if (a.clientActivity) setAssets((list) => list.map((x) => (x.id === a.id ? { ...x, clientActivity: false } : x)));
                                        }}
                                    >
                                        <div className={`cl-card__media ${a.height > a.width ? 'is-portrait' : ''}`}>
                                            {a.posterUrl ? <img src={a.posterUrl} alt="" loading="lazy" /> : <Film size={22} />}
                                            <span className="cl-card__duration">{formatTimecode(a.duration)}</span>
                                            {a.versionCount > 1 ? <span className="cl-card__version">v{a.currentVersion}</span> : null}
                                            {selecting ? <span className={`cl-card__check ${isSelected ? 'is-on' : ''}`}>{isSelected ? <Check size={14} /> : null}</span> : null}
                                            {a.clientActivity ? <span className="cl-card__new">New feedback</span> : null}
                                        </div>
                                        <div className="cl-card__body">
                                            <strong>{a.title}</strong>
                                            <div className="cl-card__meta">
                                                <StatusBadge status={a.status} />
                                                {a.openComments ? (
                                                    <span className="cl-card__comments">
                                                        <MessageSquare size={12} /> {a.openComments}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <small>
                                                {clientFilter === 'all' && client ? `${client.name} · ` : ''}
                                                {a.dueDate ? `Post ${new Date(`${a.dueDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : `Updated ${new Date(a.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
                                            </small>
                                        </div>
                                    </button>
                                );
                            })}
                            {!visible.length && !uploads.length ? (
                                <div className="cl-empty cl-empty--grid">
                                    <Upload size={26} />
                                    <h3>{inClient.length ? 'Nothing with this status' : 'Drop videos here'}</h3>
                                    <p>
                                        {inClient.length
                                            ? 'Try another filter.'
                                            : `Upload finished videos${activeClient ? ` for ${activeClient.name}` : ''}, or save clips and launch videos to the library from their pages. Then send them to the client for approval.`}
                                    </p>
                                    {!inClient.length ? (
                                        <button type="button" className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()}>
                                            <Upload size={14} /> Upload videos
                                        </button>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    </section>
                </div>
            )}

            {openAsset ? (
                <AssetPanel
                    assetId={openAsset}
                    clients={clients || []}
                    onClose={() => setOpenAsset(null)}
                    onChanged={(next) => setAssets((list) => list.map((a) => (a.id === next.id ? { ...a, ...next, clientActivity: false } : a)))}
                    onDeleted={(id) => {
                        setOpenAsset(null);
                        setAssets((list) => list.filter((a) => a.id !== id));
                        agencyApi.library().then((l) => setStorage(l.storage)).catch(() => {});
                    }}
                    onSend={(list) => openSend(list)}
                />
            ) : null}
            {clientModal ? <ClientModal client={clientModal === 'new' ? null : clientModal} onSave={saveClient} onClose={() => setClientModal(null)} /> : null}
            {sending ? <SendReviewModal assets={sending.assets} client={sending.client} onClose={() => setSending(null)} onSent={onSent} /> : null}
        </div>
    );
}
