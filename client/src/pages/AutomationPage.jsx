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
import { useWorkspace } from '../context/WorkspaceContext';
import { apiClient } from '../lib/api';
import './Automation.css';

const TRIGGER_TYPES = [
    { id: 'dm_keyword', label: 'DM Keyword', icon: MessageSquare },
    { id: 'comment_keyword', label: 'Comment Keyword (Coming Soon)', icon: MessageSquare, disabled: true },
    { id: 'new_follower', label: 'New Follower', icon: UserPlus },
    { id: 'story_reply', label: 'Story Reply', icon: Mail },
];

const ACTION_TYPES = [
    { id: 'send_dm', label: 'Send DM' },
    { id: 'add_lead', label: 'Add to Leads' },
    { id: 'send_email', label: 'Send Email' },
    { id: 'tag', label: 'Apply Tag' },
];

export default function AutomationPage() {
    const { currentWorkspace } = useWorkspace();
    const [automations, setAutomations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');
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
            const [data, connData] = await Promise.all([
                apiClient(`/workspaces/${currentWorkspace.id}/automations`),
                apiClient(`/workspaces/${currentWorkspace.id}/connections`)
            ]);
            setAutomations(data.automations || []);
            setAvailableConnections((connData.connections || []).filter(c => c.status === 'active'));
        } catch (err) {
            console.error('Failed to fetch automations or connections:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!newAutomation.name) return;
        setCreating(true);
        setError('');

        try {
            const payload = {
                name: newAutomation.name,
                trigger: {
                    type: newAutomation.triggerType,
                    config: {
                        ...newAutomation.triggerConfig,
                        keywords: newAutomation.triggerConfig.keywords
                            ? newAutomation.triggerConfig.keywords.split(',').map(k => k.trim())
                            : [],
                    },
                },
                action: {
                    type: newAutomation.actionType,
                    config: newAutomation.actionConfig,
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
            console.error('Toggle failed:', err);
        }
    };

    const deleteAutomation = async (id) => {
        try {
            await apiClient(`/workspaces/${currentWorkspace.id}/automations/${id}`, {
                method: 'DELETE',
            });
            await fetchAutomations();
        } catch (err) {
            console.error('Delete failed:', err);
        }
    };

    return (
        <div className="automation-page animate-fade-in">
            <div className="page-header">
                <div>
                    <h1>Social Automations</h1>
                    <p className="page-subtitle">Create smart automations to engage your audience 24/7.</p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                    <Plus size={18} /> New Automation
                </button>
            </div>

            {loading ? (
                <div className="card" style={{ padding: '60px', textAlign: 'center' }}>
                    <Loader2 size={32} className="spin" style={{ color: 'var(--accent-primary)', margin: '0 auto' }} />
                </div>
            ) : automations.length === 0 ? (
                <div className="card" style={{ padding: '60px', textAlign: 'center' }}>
                    <Zap size={48} style={{ color: 'var(--text-muted)', margin: '0 auto 16px' }} />
                    <h3>No Automations Yet</h3>
                    <p style={{ color: 'var(--text-secondary)', maxWidth: 420, margin: '8px auto 24px' }}>
                        Automate your DMs, comments, and lead capture to grow while you sleep.
                    </p>
                    <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                        <Plus size={16} /> Create First Automation
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
                <div className="modal-overlay animate-fade-in" onClick={() => setShowCreate(false)}>
                    <div className="modal card" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Create Automation</h3>
                            <button className="btn-icon btn-ghost" onClick={() => setShowCreate(false)}><X size={18} /></button>
                        </div>
                        {error && <div className="error-banner"><AlertCircle size={14} /><span>{error}</span></div>}
                        <div className="modal-body">
                            <label>Automation Name</label>
                            <input className="input" value={newAutomation.name} onChange={e => setNewAutomation({ ...newAutomation, name: e.target.value })} placeholder="e.g. DM Welcome Flow" />

                            <label>Trigger</label>
                            <select className="input" value={newAutomation.triggerType} onChange={e => setNewAutomation({ ...newAutomation, triggerType: e.target.value })}>
                                {TRIGGER_TYPES.map(t => <option key={t.id} value={t.id} disabled={t.disabled}>{t.label}</option>)}
                            </select>

                            <label style={{ marginTop: '16px' }}>Apply to Connections (Leave blank for all)</label>
                            <div className="platform-selector" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                                {availableConnections.length === 0 ? (
                                    <span className="text-xs text-muted">No active connections found.</span>
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

                            <label>Keywords (comma-separated)</label>
                            <input className="input" value={newAutomation.triggerConfig.keywords} onChange={e => setNewAutomation({ ...newAutomation, triggerConfig: { keywords: e.target.value } })} placeholder="e.g. price, info, link" />

                            <label>Action</label>
                            <select className="input" value={newAutomation.actionType} onChange={e => setNewAutomation({ ...newAutomation, actionType: e.target.value })}>
                                {ACTION_TYPES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                            </select>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', marginTop: '16px' }}>
                                <label style={{ margin: 0 }}>Message Template</label>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    <button className="btn btn-sm btn-ghost" onClick={() => setNewAutomation({ ...newAutomation, actionConfig: { message: newAutomation.actionConfig.message + '{name}' } })} type="button">+ {`{name}`}</button>
                                    <button className="btn btn-sm btn-ghost" onClick={() => setNewAutomation({ ...newAutomation, actionConfig: { message: newAutomation.actionConfig.message + '{username}' } })} type="button">+ {`{username}`}</button>
                                </div>
                            </div>
                            <textarea className="input" value={newAutomation.actionConfig.message} onChange={e => setNewAutomation({ ...newAutomation, actionConfig: { message: e.target.value } })} placeholder="Hey {name}, thanks for reaching out! Here's the link..." />
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !newAutomation.name}>
                                {creating ? <><Loader2 size={16} className="spin" /> Creating...</> : <><Zap size={16} /> Create Automation</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
