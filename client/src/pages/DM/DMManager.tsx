import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { apiClient } from '../../lib/api';
import { Settings2, Inbox, Send, ToggleLeft, ToggleRight, Trash2, Check, X, RefreshCw, PenSquare, Loader2, MessagesSquare, Lock, Clock } from 'lucide-react';
import './DMManager.css';
import { confirmDialog } from '../../lib/dialogs';

interface Automation {
    id: string;
    platform: string;
    trigger: string;
    keyword: string | null;
    replyTemplate: string;
    isActive: boolean;
    sentCount: number;
    lastError?: string | null;
    lastErrorAt?: number | null;
    failureCount?: number;
}

interface QueuedMsg {
    id: string;
    senderId: string;
    senderName: string;
    originalMessage: string;
    aiSuggestedReply: string;
    platform: string;
    status: string;
    windowEndsAt?: number | null;
}

interface InboxComment {
    id: string;
    platform: string;
    fromName: string;
    fromUsername: string;
    text: string;
    createdAt: number;
    replies: { text: string; kind: 'public' | 'private'; by: string; at: number }[];
    automation: { ruleName: string } | null;
    privateReplySent: boolean;
    privateReplyOpen: boolean;
}

const CHANNEL_LABEL: Record<string, string> = { instagram: 'Instagram', facebook: 'Messenger' };
const COMMENT_LABEL: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook' };

/** "Reply within 5h" / "closed": Meta allows replies only within 24 hours of the person's last message. */
function windowLabel(endsAt?: number | null) {
    if (!endsAt) return null;
    const left = endsAt - Date.now();
    if (left <= 0) return { open: false, text: 'Reply window closed' };
    const h = Math.floor(left / 3600000);
    return { open: true, text: h >= 1 ? `Reply within ${h}h` : `Reply within ${Math.max(1, Math.round(left / 60000))} min` };
}

const QUEUE_PLANS = ['creator', 'agency'];
const EMPTY_RULE = { platform: 'instagram', trigger: 'keyword', keyword: '', replyTemplate: '' };

export default function DMManager() {
    const { user, plan } = useAuth() as any;

    const [activeTab, setActiveTab] = useState<'automations' | 'inbox' | 'comments'>('inbox');
    const [comments, setComments] = useState<InboxComment[]>([]);
    const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
    const [automations, setAutomations] = useState<Automation[]>([]);
    const [queue, setQueue] = useState<QueuedMsg[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    // Channels whose automatic sends are paused by the hourly limit.
    const [pause, setPause] = useState<Record<string, { until: number }>>({});
    const [actionError, setActionError] = useState('');
    const [busyId, setBusyId] = useState<string | null>(null);

    // Create Modal state
    const [showCreate, setShowCreate] = useState(false);
    const [newAuto, setNewAuto] = useState(EMPTY_RULE);
    const [createError, setCreateError] = useState('');
    const [creating, setCreating] = useState(false);

    // Edit Message State
    const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState('');

    const hasQueue = QUEUE_PLANS.includes(plan || '');

    const fetchState = async () => {
        setLoading(true);
        setLoadError('');
        try {
            if (hasQueue) {
                const qData = await apiClient('/dm/queue');
                setQueue(qData.queue || []);
            } else {
                setQueue([]);
            }
            const [aData, cData] = await Promise.all([apiClient('/dm/automations'), apiClient('/dm/comments')]);
            setAutomations(aData.automations || []);
            setPause(aData.pause || {});
            setComments(cData.comments || []);
        } catch (err: any) {
            setLoadError(err.message || 'The inbox could not be loaded.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user) fetchState();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, plan]);

    const toggleAuto = async (id: string, current: boolean) => {
        setActionError('');
        setBusyId(id);
        try {
            await apiClient(`/dm/automations/${id}`, { method: 'PUT', body: { isActive: !current } });
            setAutomations(prev => prev.map(a => a.id === id ? { ...a, isActive: !current } : a));
        } catch (err: any) {
            setActionError(err.message || 'Could not update the rule.');
        } finally {
            setBusyId(null);
        }
    };

    const createAutomation = async () => {
        setCreateError('');
        if (plan === 'starter') {
            setCreateError('Upgrade to Creator Starter or higher to create auto-replies.');
            return;
        }
        if (!newAuto.keyword.trim()) {
            setCreateError('Add the keyword that should trigger this reply.');
            return;
        }
        if (!newAuto.replyTemplate.trim()) {
            setCreateError('Write the reply to send.');
            return;
        }
        setCreating(true);
        try {
            await apiClient('/dm/automations', { method: 'POST', body: newAuto });
            setShowCreate(false);
            setNewAuto(EMPTY_RULE);
            fetchState();
        } catch (err: any) {
            setCreateError(err.message || 'Could not create the rule.');
        } finally {
            setCreating(false);
        }
    };

    const handleDeleteAuto = async (a: Automation) => {
        if (!(await confirmDialog(`Delete the auto-reply for "${a.keyword || a.trigger}"? This cannot be undone.`, { confirmLabel: 'Delete', danger: true }))) return;
        setActionError('');
        setBusyId(a.id);
        try {
            await apiClient(`/dm/automations/${a.id}`, { method: 'DELETE' });
            setAutomations(prev => prev.filter(x => x.id !== a.id));
        } catch (err: any) {
            setActionError(err.message || 'Could not delete the rule.');
        } finally {
            setBusyId(null);
        }
    };

    const processMsg = async (id: string, action: 'send' | 'dismiss' | 'edit-send', text?: string) => {
        setActionError('');
        if (action !== 'dismiss' && !(text || '').trim()) {
            setActionError('The reply is empty. Write a message before sending.');
            return;
        }
        setBusyId(id);
        try {
            // edit-send always carries the edited text, even when it matches the suggestion.
            const body = action === 'dismiss' ? undefined : { text: (text || '').trim() };
            await apiClient(`/dm/queue/${id}/${action}`, { method: 'POST', ...(body ? { body } : {}) });
            setQueue(prev => prev.filter(q => q.id !== id));
            setEditingMsgId(null);
        } catch (err: any) {
            setActionError(err.message || 'That message could not be sent.');
        } finally {
            setBusyId(null);
        }
    };

    const commentAction = async (c: InboxComment, action: 'reply' | 'private-reply' | 'dismiss') => {
        setActionError('');
        const text = (commentDrafts[c.id] || '').trim();
        if (action !== 'dismiss' && !text) {
            setActionError('Write a reply first.');
            return;
        }
        setBusyId(c.id);
        try {
            await apiClient(`/dm/comments/${encodeURIComponent(c.id)}/${action}`, { method: 'POST', ...(action === 'dismiss' ? {} : { body: { text } }) });
            setComments(prev => prev.filter(x => x.id !== c.id));
            setCommentDrafts(prev => ({ ...prev, [c.id]: '' }));
        } catch (err: any) {
            setActionError(err.message || 'The reply could not be sent.');
        } finally {
            setBusyId(null);
        }
    };

    const openCreate = () => {
        setCreateError('');
        setNewAuto(EMPTY_RULE);
        setShowCreate(true);
    };

    return (
        <div className="dm-manager-container">
            <div className="dm-sidebar">
                <div className="dm-nav">
                    <h2>Inbox</h2>
                    <button className={`nav-btn ${activeTab === 'inbox' ? 'active' : ''}`} onClick={() => setActiveTab('inbox')}>
                        <Inbox size={18} /> Review Inbox {queue.length > 0 && <span className="dm-count-badge">{queue.length}</span>}
                    </button>
                    <button className={`nav-btn ${activeTab === 'comments' ? 'active' : ''}`} onClick={() => setActiveTab('comments')}>
                        <MessagesSquare size={18} /> Comments {comments.length > 0 && <span className="dm-count-badge">{comments.length}</span>}
                    </button>
                    <button className={`nav-btn ${activeTab === 'automations' ? 'active' : ''}`} onClick={() => setActiveTab('automations')}>
                        <Settings2 size={18} /> Auto-replies
                    </button>
                </div>
            </div>

            <div className="dm-main-content">
                <div className="content-inner">
                    {loadError ? <div role="alert" className="dm-error">{loadError}</div> : null}
                    {actionError ? <div role="alert" className="dm-error">{actionError}</div> : null}
                    {Object.entries(pause).map(([channel, p]) => (
                        <div key={channel} role="status" className="dm-error">
                            Automatic {CHANNEL_LABEL[channel] || channel} replies are paused until{' '}
                            {new Date(p.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: the hourly limit for automatic messages was reached.
                            Replies you send from here still go out.
                        </div>
                    ))}

                    {/* ── INBOX VIEW ── */}
                    {activeTab === 'inbox' && (
                        <div className="inbox-view">
                            <div className="view-header">
                                <h3>Messages to review</h3>
                                <button className="btn-icon" onClick={fetchState} disabled={loading} aria-label="Reload" title="Reload">
                                    <RefreshCw size={16} className={loading ? 'spin' : ''} />
                                </button>
                            </div>

                            {!hasQueue ? (
                                <div className="empty-state">
                                    <p>
                                        {plan === 'nano'
                                            ? 'You are on Creator Starter: upgrade to Creator Pro for the reply queue.'
                                            : 'The AI reply queue is available on Creator Pro and Agency plans.'}
                                    </p>
                                    <p className="dm-hint">
                                        Keyword auto-replies still work on Creator Starter. <Link to="/dashboard/billing">See plans</Link>
                                    </p>
                                </div>
                            ) : loading && queue.length === 0 ? (
                                <div className="empty-state"><Loader2 size={20} className="spin" /> Loading messages…</div>
                            ) : queue.length === 0 ? (
                                <div className="empty-state">No pending messages in smart queue.</div>
                            ) : (
                                <div className="queue-list">
                                    {queue.map(msg => {
                                        const suggestion = (msg.aiSuggestedReply || '').trim();
                                        const isEditing = editingMsgId === msg.id;
                                        const busy = busyId === msg.id;
                                        const win = windowLabel(msg.windowEndsAt);
                                        const closed = win ? !win.open : false;
                                        return (
                                            <div key={msg.id} className="queue-card">
                                                <div className="msg-header">
                                                    <span className="platform-tag">{CHANNEL_LABEL[msg.platform] || msg.platform}</span>
                                                    <strong>{msg.senderName}</strong>
                                                    {win && (
                                                        <span className={`dm-window ${win.open ? '' : 'is-closed'}`} title="Meta allows replies only within 24 hours of the person's last message.">
                                                            <Clock size={12} /> {win.text}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="original-msg">"{msg.originalMessage}"</p>

                                                <div className="reply-box">
                                                    <span className="ai-badge">Suggested reply</span>
                                                    {isEditing ? (
                                                        <textarea
                                                            className="edit-textarea"
                                                            value={editDraft}
                                                            onChange={e => setEditDraft(e.target.value)}
                                                            placeholder="Write your reply…"
                                                        />
                                                    ) : suggestion ? (
                                                        <p className="ai-reply">{msg.aiSuggestedReply}</p>
                                                    ) : (
                                                        <p className="dm-hint dm-hint--warning">No reply was suggested for this message. Use Edit to write one.</p>
                                                    )}
                                                </div>

                                                <div className="action-row">
                                                    {isEditing ? (
                                                        <>
                                                            <button
                                                                className="btn-primary"
                                                                onClick={() => processMsg(msg.id, 'edit-send', editDraft)}
                                                                disabled={busy || closed || !editDraft.trim()}
                                                            >
                                                                {busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Send Edit
                                                            </button>
                                                            <button className="btn-ghost" onClick={() => setEditingMsgId(null)} disabled={busy}>Cancel</button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button
                                                                className="btn-primary"
                                                                onClick={() => processMsg(msg.id, 'send', suggestion)}
                                                                disabled={busy || closed || !suggestion}
                                                                title={closed ? 'The 24-hour reply window has closed' : suggestion ? undefined : 'Edit the reply first'}
                                                            >
                                                                {busy ? <Loader2 size={14} className="spin" /> : <Check size={16} />} Approve & Send
                                                            </button>
                                                            <button className="btn-outline" onClick={() => { setEditingMsgId(msg.id); setEditDraft(msg.aiSuggestedReply || ''); }} disabled={busy}>
                                                                <PenSquare size={14} /> Edit
                                                            </button>
                                                            <button className="btn-ghost" onClick={() => processMsg(msg.id, 'dismiss')} disabled={busy}>
                                                                <X size={16} /> Dismiss
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── COMMENTS VIEW ── */}
                    {activeTab === 'comments' && (
                        <div className="inbox-view">
                            <div className="view-header">
                                <h3>Comments</h3>
                                <button className="btn-icon" onClick={fetchState} disabled={loading} aria-label="Reload" title="Reload">
                                    <RefreshCw size={16} className={loading ? 'spin' : ''} />
                                </button>
                            </div>
                            <p className="dm-hint">
                                New comments on your Instagram posts and Facebook Page appear here. Reply publicly, or send the one private message Meta allows per comment (within 7 days).
                            </p>
                            {loading && comments.length === 0 ? (
                                <div className="empty-state"><Loader2 size={20} className="spin" /> Loading comments…</div>
                            ) : comments.length === 0 ? (
                                <div className="empty-state">No comments waiting for a reply.</div>
                            ) : (
                                <div className="queue-list">
                                    {comments.map(c => {
                                        const busy = busyId === c.id;
                                        const draft = commentDrafts[c.id] || '';
                                        return (
                                            <div key={c.id} className="queue-card">
                                                <div className="msg-header">
                                                    <span className="platform-tag">{COMMENT_LABEL[c.platform] || c.platform}</span>
                                                    <strong>{c.fromUsername ? `@${c.fromUsername}` : c.fromName || 'Someone'}</strong>
                                                    <span className="dm-window">{new Date(c.createdAt).toLocaleString()}</span>
                                                </div>
                                                <p className="original-msg">"{c.text}"</p>
                                                <label className="sr-only" htmlFor={`reply-${c.id}`}>Your reply</label>
                                                <textarea
                                                    id={`reply-${c.id}`}
                                                    className="edit-textarea"
                                                    value={draft}
                                                    onChange={e => setCommentDrafts(prev => ({ ...prev, [c.id]: e.target.value }))}
                                                    placeholder="Write your reply…"
                                                />
                                                <div className="action-row">
                                                    <button className="btn-primary" onClick={() => commentAction(c, 'reply')} disabled={busy || !draft.trim()}>
                                                        {busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Reply publicly
                                                    </button>
                                                    <button
                                                        className="btn-outline"
                                                        onClick={() => commentAction(c, 'private-reply')}
                                                        disabled={busy || !draft.trim() || !c.privateReplyOpen}
                                                        title={c.privateReplySent ? 'A private reply was already sent' : !c.privateReplyOpen ? 'Private replies are allowed within 7 days of the comment' : undefined}
                                                    >
                                                        <Lock size={14} /> Reply privately
                                                    </button>
                                                    <button className="btn-ghost" onClick={() => commentAction(c, 'dismiss')} disabled={busy}>
                                                        <X size={16} /> Dismiss
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── AUTOMATION VIEW ── */}
                    {activeTab === 'automations' && (
                        <div className="auto-view">
                            <div className="view-header">
                                <h3>Keyword auto-replies</h3>
                                <button className="btn-primary" onClick={openCreate}>+ New Rule</button>
                            </div>
                            <p className="dm-hint">
                                A simple keyword → reply for direct messages. They answer only messages that no rule on the{' '}
                                <Link to="/dashboard/automation">Automations page</Link> answered (that page also handles comments and leads).
                                Each replies to the same person at most once a day, and pauses in a conversation for 12 hours after you reply by hand.
                            </p>

                            {loading && automations.length === 0 ? (
                                <div className="empty-state"><Loader2 size={20} className="spin" /> Loading rules…</div>
                            ) : automations.length === 0 ? (
                                <div className="empty-state">No active keyword rules.</div>
                            ) : (
                                <div className="auto-grid">
                                    {automations.map(a => (
                                        <div key={a.id} className={`auto-card ${a.isActive ? 'active' : 'paused'}`}>
                                            <div className="card-top">
                                                <div>
                                                    <span className="platform-tag">{CHANNEL_LABEL[a.platform] || a.platform}</span>
                                                    <h4 style={{ margin: '8px 0' }}>Trigger: {(a.trigger || 'keyword').replace('_', ' ')}</h4>
                                                    {a.keyword && <span className="keyword-chip">"{a.keyword}"</span>}
                                                </div>
                                                <button
                                                    className="btn-icon"
                                                    onClick={() => toggleAuto(a.id, a.isActive)}
                                                    disabled={busyId === a.id}
                                                    aria-label={a.isActive ? 'Pause rule' : 'Activate rule'}
                                                    title={a.isActive ? 'Pause rule' : 'Activate rule'}
                                                >
                                                    {a.isActive ? <ToggleRight className="dm-toggle-on" size={28} /> : <ToggleLeft className="dm-toggle-off" size={28} />}
                                                </button>
                                            </div>

                                            <div className="reply-preview">
                                                <small>Auto-Reply:</small>
                                                <p>{a.replyTemplate}</p>
                                            </div>

                                            {a.lastError ? (
                                                <p role="status" className="dm-error" style={{ margin: '8px 0' }}>
                                                    Last problem{a.lastErrorAt ? ` (${new Date(a.lastErrorAt).toLocaleString()})` : ''}: {a.lastError}
                                                </p>
                                            ) : null}

                                            <div className="card-footer">
                                                <span>
                                                    Stats: <strong>{a.sentCount || 0}</strong> sent
                                                    {a.failureCount ? <> · <strong>{a.failureCount}</strong> failed</> : null}
                                                    {!a.isActive ? ' · paused' : ''}
                                                </span>
                                                <button
                                                    className="btn-icon danger"
                                                    onClick={() => handleDeleteAuto(a)}
                                                    disabled={busyId === a.id}
                                                    aria-label="Delete rule"
                                                    title="Delete rule"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {showCreate && (
                <div className="modal-overlay" onClick={() => !creating && setShowCreate(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <h3>New Automation Rule</h3>

                        {createError && <div role="alert" className="dm-error">{createError}</div>}

                        <div className="form-group">
                            <label>Platform</label>
                            <select value={newAuto.platform} onChange={e => setNewAuto({ ...newAuto, platform: e.target.value })} className="input-dark">
                                <option value="instagram">Instagram DMs</option>
                                <option value="facebook">Facebook Messenger</option>
                            </select>
                        </div>

                        <div className="form-group">
                            <label>Trigger Type</label>
                            <select value={newAuto.trigger} onChange={e => setNewAuto({ ...newAuto, trigger: e.target.value })} className="input-dark">
                                <option value="keyword">Specific Keyword Match</option>
                                <option value="new_follower" disabled>New Follower Welcome (coming soon)</option>
                            </select>
                        </div>

                        <div className="form-group">
                            <label>Trigger Keyword</label>
                            <input type="text" className="input-dark" placeholder="e.g. GROW" value={newAuto.keyword} onChange={e => setNewAuto({ ...newAuto, keyword: e.target.value })} />
                        </div>

                        <div className="form-group">
                            <label>Auto-Reply Message</label>
                            <textarea className="input-dark" rows={4} placeholder="Hey! Here's the link..." value={newAuto.replyTemplate} onChange={e => setNewAuto({ ...newAuto, replyTemplate: e.target.value })} />
                        </div>

                        <div className="modal-actions" style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                            <button className="btn-ghost" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</button>
                            <button
                                className="btn-primary"
                                onClick={createAutomation}
                                style={{ flex: 1, justifyContent: 'center' }}
                                disabled={creating || !newAuto.keyword.trim() || !newAuto.replyTemplate.trim()}
                            >
                                {creating && <Loader2 size={14} className="spin" />} Create Rule
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
