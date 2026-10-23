import { useState, useEffect, useCallback } from 'react';
import {
    Zap,
    Play,
    Pause,
    Plus,
    Trash2,
    MessageSquare,
    MessagesSquare,
    ArrowRight,
    Loader2,
    AlertCircle,
    X
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { apiClient } from '../lib/api';
import './Automation.css';

// Keep in step with server/src/controllers/automation.controller.js.
const TRIGGER_TYPES = [
    { id: 'dm_keyword', label: 'Keyword in a direct message', icon: MessageSquare, help: 'A message containing any of these words starts the automation.' },
    { id: 'comment_keyword', label: 'Keyword in a comment', icon: MessagesSquare, help: 'A comment on any of your posts containing any of these words starts the automation.' },
];

const ACTION_TYPES = {
    dm_keyword: [
        { id: 'send_dm', label: 'Reply with a message' },
        { id: 'add_lead', label: 'Add the person to Leads' },
    ],
    comment_keyword: [
        { id: 'send_dm', label: 'Send a private message (comment-to-DM)' },
        { id: 'reply_comment', label: 'Reply publicly to the comment' },
        { id: 'add_lead', label: 'Add the person to Leads' },
    ],
};

const ACTION_LABEL = { send_dm: 'send message', reply_comment: 'public reply', add_lead: 'add lead' };
const TRIGGER_LABEL = { dm_keyword: 'DM keyword', comment_keyword: 'comment keyword' };
const PLATFORM_NAME = { instagram: 'Instagram', facebook: 'Facebook Page' };
const EMPTY = { name: '', triggerType: 'dm_keyword', keywords: '', actionType: 'send_dm', message: '', publicReply: '', connections: [] };
const CHANNEL_NAME = { instagram: 'Instagram', facebook: 'Messenger' };

const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dateTimeOf = (ms) => new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function AutomationPage() {
    const { currentWorkspace } = useWorkspace();
    const [automations, setAutomations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    const [form, setForm] = useState(EMPTY);
    const [availableConnections, setAvailableConnections] = useState([]);
    // Channels whose automatic sends are paused by the hourly limit ({ instagram: { until } }), and the plan.
    const [pause, setPause] = useState({});
    const [plan, setPlan] = useState(null);
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));

    const fetchAutomations = useCallback(async () => {
        try {
            setLoading(true);
            setLoadError('');
            // allSettled: a failing connections call must not hide the automations list.
            const [rules, conns] = await Promise.allSettled([
                apiClient(`/workspaces/${currentWorkspace.id}/automations`),
                apiClient(`/workspaces/${currentWorkspace.id}/connections`)
            ]);
            if (rules.status === 'fulfilled') {
                setAutomations(rules.value.automations || []);
                setPause(rules.value.pause || {});
                setPlan(rules.value.plan || null);
            } else setLoadError(`Automations could not be loaded: ${rules.reason?.message || 'unknown error'}`);
            // Rules run on Instagram and Facebook Page messages and comments.
            if (conns.status === 'fulfilled') {
                setAvailableConnections((conns.value.connections || []).filter(c => c.status === 'active' && PLATFORM_NAME[c.platform]));
            }
        } finally {
            setLoading(false);
        }
    }, [currentWorkspace]);

    useEffect(() => {
        if (currentWorkspace?.id) {
            fetchAutomations();
        }
    }, [currentWorkspace, fetchAutomations]);

    const parsedKeywords = form.keywords.split(',').map(k => k.trim()).filter(Boolean);
    const isComment = form.triggerType === 'comment_keyword';
    const needsMessage = form.actionType === 'send_dm';
    const showPublicReply = isComment && form.actionType !== 'add_lead';
    const formProblem = !form.name.trim()
        ? 'Give the automation a name.'
        : parsedKeywords.length === 0
            ? 'Add at least one keyword.'
            : needsMessage && !form.message.trim()
                ? 'Write the message to send.'
                : form.actionType === 'reply_comment' && !form.publicReply.trim()
                    ? 'Write the public reply.'
                    : '';

    const closeCreate = () => {
        if (creating) return;
        setShowCreate(false);
        setError('');
    };

    const changeTrigger = (triggerType) => {
        const allowed = ACTION_TYPES[triggerType].map(a => a.id);
        set({ triggerType, actionType: allowed.includes(form.actionType) ? form.actionType : allowed[0] });
    };

    const insert = (field, token) => set({ [field]: form[field] + token });

    const handleCreate = async () => {
        if (formProblem) {
            setError(formProblem);
            return;
        }
        setCreating(true);
        setError('');

        try {
            const config = {};
            if (needsMessage) config.message = form.message.trim();
            if (showPublicReply && form.publicReply.trim()) config.publicReply = form.publicReply.trim();
            await apiClient(`/workspaces/${currentWorkspace.id}/automations`, {
                method: 'POST',
                body: JSON.stringify({
                    name: form.name.trim(),
                    trigger: { type: form.triggerType, config: { keywords: parsedKeywords } },
                    action: { type: form.actionType, config },
                    connections: form.connections,
                }),
            });
            await fetchAutomations();
            setShowCreate(false);
            setForm(EMPTY);
        } catch (err) {
            setError(err.message || 'Failed to create automation');
        } finally {
            setCreating(false);
        }
    };

    const toggleAutomation = async (id, currentStatus) => {
        const newStatus = currentStatus === 'active' ? 'paused' : 'active';
        try {
            await apiClient(`/workspaces/${currentWorkspace.id}/automations/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ status: newStatus }),
            });
            await fetchAutomations();
        } catch (err) {
            setLoadError(`Could not change the automation: ${err.message}`);
        }
    };

    const deleteAutomation = async (id) => {
        const rule = automations.find(a => a.id === id);
        if (!window.confirm(`Delete the automation "${rule?.name || 'this automation'}"? This cannot be undone.`)) return;
        try {
            await apiClient(`/workspaces/${currentWorkspace.id}/automations/${id}`, {
                method: 'DELETE',
            });
            await fetchAutomations();
        } catch (err) {
            setLoadError(`Could not delete the automation: ${err.message}`);
        }
    };

    const platformsOf = (auto) => (auto.connections?.length ? auto.connections.map(p => PLATFORM_NAME[p] || p).join(', ') : 'Instagram and Facebook');

    return (
        <div className="automation-page animate-fade-in">
            <div className="page-header">
                <div>
                    <h1>Automation</h1>
                    <p className="page-subtitle">
                        Answer Instagram and Facebook messages and comments automatically, and turn the people who reach out into leads.
                        Replies to messages are sent only within 24 hours of the person&apos;s message, as Meta requires.
                    </p>
                    <p className="auto-help">
                        Each rule replies to the same person at most once a day, and pauses in a conversation for 12 hours after you reply by hand.
                        These rules run first; the simpler keyword auto-replies under <Link to="/dashboard/dm">Inbox → Auto-replies</Link> only answer messages no rule here answered.
                    </p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                    <Plus size={18} /> New automation
                </button>
            </div>

            {Object.entries(pause).map(([channel, p]) => (
                <div key={channel} role="status" className="error-banner" style={{ marginBottom: 16 }}>
                    <AlertCircle size={14} />
                    <span>
                        Automatic {CHANNEL_NAME[channel] || channel} replies are paused until {timeOf(p.until)}: the hourly limit for automatic messages was reached.
                        Replies you send by hand from the Inbox still go out.
                    </span>
                </div>
            ))}

            {plan === 'starter' ? (
                <div role="status" className="error-banner" style={{ marginBottom: 16 }}>
                    <AlertCircle size={14} />
                    <span>Automations are not included in the Free plan, so these rules don&apos;t run. <Link to="/dashboard/billing">See plans</Link></span>
                </div>
            ) : null}

            {loadError ? (
                <div role="alert" style={{ background: 'var(--error-bg)', color: 'var(--error)', border: '1px solid var(--error)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>{loadError}</div>
            ) : null}

            {loading ? (
                <div className="card" style={{ padding: '60px', textAlign: 'center' }}>
                    <Loader2 size={32} className="spin" style={{ color: 'var(--accent-primary)', margin: '0 auto' }} />
                </div>
            ) : automations.length === 0 ? (
                <div className="card" style={{ padding: '60px', textAlign: 'center' }}>
                    <Zap size={48} style={{ color: 'var(--text-muted)', margin: '0 auto 16px' }} />
                    <h3>No automations yet</h3>
                    <p style={{ color: 'var(--text-secondary)', maxWidth: 460, margin: '8px auto 24px' }}>
                        Try a comment-to-DM: when someone comments “price” on your post, send them your price list privately and reply “Sent you a DM!”.
                    </p>
                    <button className="btn btn-primary" style={{ margin: '0 auto' }} onClick={() => setShowCreate(true)}>
                        <Plus size={16} /> Create an automation
                    </button>
                </div>
            ) : (
                <div className="automations-list stagger-children">
                    {automations.map(auto => {
                        const TriggerIcon = TRIGGER_TYPES.find(t => t.id === auto.trigger?.type)?.icon || Zap;
                        return (
                            <div key={auto.id} className={`automation-row card ${auto.status === 'active' ? 'active' : ''}`}>
                                <div className="auto-left">
                                    <div className="trigger-icon"><TriggerIcon size={20} /></div>
                                    <div className="auto-info">
                                        <h4>{auto.name}</h4>
                                        <div className="auto-flow">
                                            <span className="flow-step trigger">{TRIGGER_LABEL[auto.trigger?.type] || auto.trigger?.type}</span>
                                            <ArrowRight size={14} />
                                            <span className="flow-step action">
                                                {ACTION_LABEL[auto.action?.type] || auto.action?.type}
                                                {auto.action?.config?.publicReply && auto.action?.type === 'send_dm' ? ' + public reply' : ''}
                                            </span>
                                        </div>
                                        <span className="auto-help">
                                            {platformsOf(auto)} · “{(auto.trigger?.config?.keywords || []).join('”, “')}” · ran {auto.runCount || 0} times
                                            {auto.failureCount ? ` · failed ${auto.failureCount} times` : ''}
                                            {auto.status !== 'active' ? ' · paused' : ''}
                                        </span>
                                        {auto.lastError ? (
                                            <span className="auto-help" role="status" style={{ color: 'var(--error)', display: 'flex', gap: 6, alignItems: 'center' }}>
                                                <AlertCircle size={12} />
                                                Last problem{auto.lastErrorAt ? ` (${dateTimeOf(auto.lastErrorAt)})` : ''}: {auto.lastError}
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                                <div className="auto-right">
                                    <button
                                        className={`toggle-btn ${auto.status === 'active' ? 'on' : 'off'}`}
                                        onClick={() => toggleAutomation(auto.id, auto.status)}
                                        title={auto.status === 'active' ? 'Pause' : 'Activate'}
                                    >
                                        {auto.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                                        {auto.status === 'active' ? 'Active' : 'Paused'}
                                    </button>
                                    <button className="btn-icon btn-ghost" onClick={() => deleteAutomation(auto.id)} title="Delete" aria-label={`Delete ${auto.name}`}>
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {showCreate && (
                <div className="modal-overlay animate-fade-in" onClick={closeCreate}>
                    <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="auto-create-title" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 id="auto-create-title">Create Automation</h3>
                            <button className="btn-icon btn-ghost" onClick={closeCreate} aria-label="Close"><X size={18} /></button>
                        </div>
                        {error && <div className="error-banner"><AlertCircle size={14} /><span>{error}</span></div>}
                        <div className="modal-body">
                            <label htmlFor="auto-name">Automation name</label>
                            <input id="auto-name" className="input" value={form.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Price list on comment" />

                            <label htmlFor="auto-trigger">Trigger</label>
                            <select id="auto-trigger" className="input" value={form.triggerType} onChange={e => changeTrigger(e.target.value)}>
                                {TRIGGER_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                            </select>

                            <label style={{ marginTop: '16px' }}>Accounts (none selected = all)</label>
                            <div className="platform-selector" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                                {availableConnections.length === 0 ? (
                                    <span className="auto-help">
                                        No Instagram account or Facebook Page is connected yet. <Link to="/dashboard/connections">Connect one</Link>
                                    </span>
                                ) : availableConnections.map(c => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        aria-pressed={form.connections.includes(c.id)}
                                        onClick={() => set({
                                            connections: form.connections.includes(c.id)
                                                ? form.connections.filter(id => id !== c.id)
                                                : [...form.connections, c.id],
                                        })}
                                        className={`btn btn-sm ${form.connections.includes(c.id) ? 'btn-primary' : 'btn-secondary'}`}
                                    >
                                        {PLATFORM_NAME[c.platform]}: {c.platform === 'instagram' ? '@' : ''}{c.username}
                                    </button>
                                ))}
                            </div>

                            <label htmlFor="auto-keywords">Keywords (comma-separated) *</label>
                            <input id="auto-keywords" className="input" value={form.keywords} onChange={e => set({ keywords: e.target.value })} placeholder="e.g. price, info, link" />
                            <span className="auto-help">{TRIGGER_TYPES.find(t => t.id === form.triggerType)?.help}</span>

                            <label htmlFor="auto-action">Action</label>
                            <select id="auto-action" className="input" value={form.actionType} onChange={e => set({ actionType: e.target.value })}>
                                {ACTION_TYPES[form.triggerType].map(a => (
                                    <option key={a.id} value={a.id} disabled={a.id === 'add_lead' && plan && plan !== 'agency'}>
                                        {a.label}{a.id === 'add_lead' && plan && plan !== 'agency' ? ' (Agency plan)' : ''}
                                    </option>
                                ))}
                            </select>

                            {needsMessage && (
                                <>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', marginTop: '16px' }}>
                                        <label htmlFor="auto-message" style={{ margin: 0 }}>{isComment ? 'Private message *' : 'Message *'}</label>
                                        <div style={{ display: 'flex', gap: '4px' }}>
                                            <button className="btn btn-sm btn-ghost" onClick={() => insert('message', '{name}')} type="button">+ {`{name}`}</button>
                                            <button className="btn btn-sm btn-ghost" onClick={() => insert('message', '{username}')} type="button">+ {`{username}`}</button>
                                        </div>
                                    </div>
                                    <textarea id="auto-message" className="input" value={form.message} onChange={e => set({ message: e.target.value })} placeholder="Hey {name}, thanks for reaching out! Here's the link..." />
                                    <span className="auto-help">
                                        {isComment
                                            ? 'Sent privately to the person who commented. Meta allows one private reply per comment, within 7 days of it.'
                                            : '{name} and {username} are replaced with the sender’s details (or “there” if Meta doesn’t share them).'}
                                    </span>
                                </>
                            )}

                            {showPublicReply && (
                                <>
                                    <label htmlFor="auto-public" style={{ marginTop: '16px' }}>{form.actionType === 'reply_comment' ? 'Public reply *' : 'Public reply (optional)'}</label>
                                    <textarea id="auto-public" className="input" value={form.publicReply} onChange={e => set({ publicReply: e.target.value })} placeholder={needsMessage ? 'Sent you a DM, {name}!' : 'Thanks {name}! Details are in our bio.'} />
                                    <span className="auto-help">Posted under the comment, where everyone can see it.</span>
                                </>
                            )}

                            {form.actionType === 'add_lead' && (
                                <span className="auto-help" style={{ marginTop: '8px' }}>The person is added to Leads as a prospect. No message is sent.</span>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeCreate} disabled={creating}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !!formProblem} title={formProblem || undefined}>
                                {creating ? <><Loader2 size={16} className="spin" /> Creating...</> : <><Zap size={16} /> Create Automation</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
