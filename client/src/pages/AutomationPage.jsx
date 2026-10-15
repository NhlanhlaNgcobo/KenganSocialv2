import { useState, useEffect } from 'react';
import {
    Zap,
    Play,
    Pause,
    Plus,
    Trash2,
    MoreVertical,
    MessageSquare,
    UserPlus,
    Mail,
    Settings,
    ArrowRight,
    Loader2,
    AlertCircle,
    X
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { apiClient } from '../lib/api';
import './Automation.css';

const TRIGGER_TYPES = [
    { id: 'dm_keyword', label: 'DM Keyword', icon: MessageSquare },
    { id: 'comment_keyword', label: 'Comment Keyword (Coming Soon)', icon: MessageSquare, disabled: true },
    { id: 'new_follower', label: 'New Follower (Coming Soon)', icon: UserPlus, disabled: true },
    { id: 'story_reply', label: 'Story Reply (Coming Soon)', icon: Mail, disabled: true },
];

const ACTION_TYPES = [
    { id: 'send_dm', label: 'Send DM' },
    { id: 'add_lead', label: 'Add to Leads' },
    { id: 'send_email', label: 'Send Email (Coming Soon)', disabled: true },
    { id: 'tag', label: 'Apply Tag (Coming Soon)', disabled: true },
];

export default function AutomationPage() {
    const { currentWorkspace } = useWorkspace();
    const [automations, setAutomations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    const [newAutomation, setNewAutomation] = useState({
        name: '',
        triggerType: 'dm_keyword',
        triggerConfig: { keywords: '' },
        actionType: 'send_dm',
        actionConfig: { message: '' },
        connections: [], // List of connection IDs this appies to
    });
    const [availableConnections, setAvailableConnections] = useState([]);

    useEffect(() => {
        if (currentWorkspace?.id) {
            fetchAutomations();
        }
    }, [currentWorkspace]);

    const fetchAutomations = async () => {
        try {
            setLoading(true);
            setLoadError('');
            // allSettled: a failing connections call must not hide the automations list.
            const [rules, conns] = await Promise.allSettled([
                apiClient(`/workspaces/${currentWorkspace.id}/automations`),
                apiClient(`/workspaces/${currentWorkspace.id}/connections`)
            ]);
            if (rules.status === 'fulfilled') setAutomations(rules.value.automations || []);
            else setLoadError(`Automations could not be loaded: ${rules.reason?.message || 'unknown error'}`);
            // Rules only run on Instagram DMs, so only Instagram accounts can be targeted.
            if (conns.status === 'fulfilled') {
                setAvailableConnections((conns.value.connections || []).filter(c => c.status === 'active' && c.platform === 'instagram'));
            }
        } finally {
            setLoading(false);
        }
    };

    const parsedKeywords = newAutomation.triggerConfig.keywords
        .split(',')
        .map(k => k.trim())
        .filter(Boolean);
    const needsMessage = newAutomation.actionType === 'send_dm';
    const formProblem = !newAutomation.name.trim()
        ? 'Give the automation a name.'
        : parsedKeywords.length === 0
            ? 'Add at least one keyword.'
            : needsMessage && !newAutomation.actionConfig.message.trim()
                ? 'Write the message to send.'
                : '';

    const closeCreate = () => {
        if (creating) return;
        setShowCreate(false);
        setError('');
    };

    const handleCreate = async () => {
        if (formProblem) {
            setError(formProblem);
            return;
        }
        setCreating(true);
        setError('');

        try {
            const payload = {
                name: newAutomation.name.trim(),
                trigger: {
                    type: newAutomation.triggerType,
                    config: { keywords: parsedKeywords },
                },
                action: {
                    type: newAutomation.actionType,
                    config: needsMessage ? { message: newAutomation.actionConfig.message.trim() } : {},
                },
                connections: newAutomation.connections,
            };

            await apiClient(`/workspaces/${currentWorkspace.id}/automations`, {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            await fetchAutomations();
            setShowCreate(false);
            setNewAutomation({ name: '', triggerType: 'dm_keyword', triggerConfig: { keywords: '' }, actionType: 'send_dm', actionConfig: { message: '' }, connections: [] });
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

    return (
        <div className="automation-page animate-fade-in">
            <div className="page-header">
                <div>
                    <h1>Automation</h1>
                    <p className="page-subtitle">Reply to Instagram DMs automatically and turn the people who message you into leads. Rules run once Instagram is connected and its DM webhook is set up.</p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                    <Plus size={18} /> New automation
                </button>
            </div>

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
                    <p style={{ color: 'var(--text-secondary)', maxWidth: 420, margin: '8px auto 24px' }}>
                        Start with a keyword reply: when someone DMs you “price”, send them your price list automatically.
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
                                            <span className="flow-step trigger">{auto.trigger?.type?.replace('_', ' ')}</span>
                                            <ArrowRight size={14} />
                                            <span className="flow-step action">{auto.action?.type?.replace('_', ' ')}</span>
                                        </div>
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
                                    <button className="btn-icon btn-ghost" onClick={() => deleteAutomation(auto.id)} title="Delete">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Create Modal */}
            {showCreate && (
                <div className="modal-overlay animate-fade-in" onClick={closeCreate}>
                    <div className="modal card" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Create Automation</h3>
                            <button className="btn-icon btn-ghost" onClick={closeCreate} aria-label="Close"><X size={18} /></button>
                        </div>
                        {error && <div className="error-banner"><AlertCircle size={14} /><span>{error}</span></div>}
                        <div className="modal-body">
                            <label>Automation Name</label>
                            <input className="input" value={newAutomation.name} onChange={e => setNewAutomation({ ...newAutomation, name: e.target.value })} placeholder="e.g. DM Welcome Flow" />

                            <label>Trigger</label>
                            <select className="input" value={newAutomation.triggerType} onChange={e => setNewAutomation({ ...newAutomation, triggerType: e.target.value })}>
                                {TRIGGER_TYPES.map(t => <option key={t.id} value={t.id} disabled={t.disabled}>{t.label}</option>)}
                            </select>

                            <label style={{ marginTop: '16px' }}>Apply to Instagram accounts (leave blank for all)</label>
                            <div className="platform-selector" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                                {availableConnections.length === 0 ? (
                                    <span className="auto-help">
                                        No Instagram account is connected. Automations only run on Instagram DMs. <Link to="/dashboard/connections">Connect Instagram</Link>
                                    </span>
                                ) : availableConnections.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => {
                                            const conns = newAutomation.connections.includes(c.id)
                                                ? newAutomation.connections.filter(id => id !== c.id)
                                                : [...newAutomation.connections, c.id];
                                            setNewAutomation({ ...newAutomation, connections: conns });
                                        }}
                                        className={`btn btn-sm ${newAutomation.connections.includes(c.id) ? 'btn-primary' : 'btn-secondary'}`}
                                        title={`@${c.username}`}
                                    >
                                        {c.groupName ? `${c.groupName} - ` : ''}@{c.username}
                                    </button>
                                ))}
                            </div>

                            <label>Keywords (comma-separated) *</label>
                            <input className="input" value={newAutomation.triggerConfig.keywords} onChange={e => setNewAutomation({ ...newAutomation, triggerConfig: { keywords: e.target.value } })} placeholder="e.g. price, info, link" />
                            <span className="auto-help">A DM containing any of these words triggers the automation.</span>

                            <label>Action</label>
                            <select className="input" value={newAutomation.actionType} onChange={e => setNewAutomation({ ...newAutomation, actionType: e.target.value })}>
                                {ACTION_TYPES.map(a => <option key={a.id} value={a.id} disabled={a.disabled}>{a.label}</option>)}
                            </select>

                            {needsMessage ? (
                                <>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', marginTop: '16px' }}>
                                        <label style={{ margin: 0 }}>Message Template *</label>
                                        <div style={{ display: 'flex', gap: '4px' }}>
                                            <button className="btn btn-sm btn-ghost" onClick={() => setNewAutomation({ ...newAutomation, actionConfig: { message: newAutomation.actionConfig.message + '{name}' } })} type="button">+ {`{name}`}</button>
                                            <button className="btn btn-sm btn-ghost" onClick={() => setNewAutomation({ ...newAutomation, actionConfig: { message: newAutomation.actionConfig.message + '{username}' } })} type="button">+ {`{username}`}</button>
                                        </div>
                                    </div>
                                    <textarea className="input" value={newAutomation.actionConfig.message} onChange={e => setNewAutomation({ ...newAutomation, actionConfig: { message: e.target.value } })} placeholder="Hey {name}, thanks for reaching out! Here's the link..." />
                                    <span className="auto-help">{'{name}'} and {'{username}'} are replaced with the sender&apos;s details (or &quot;there&quot; if Instagram doesn&apos;t share them).</span>
                                </>
                            ) : (
                                <span className="auto-help" style={{ marginTop: '8px' }}>The sender is added to Leads as a prospect. No message is sent.</span>
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
