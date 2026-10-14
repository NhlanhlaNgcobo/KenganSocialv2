import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Settings2, Inbox, Send, ToggleLeft, ToggleRight, Trash2, Check, X, RefreshCw, PenSquare } from 'lucide-react';
import './DMManager.css';

interface Automation {
    id: string;
    platform: string;
    trigger: string;
    keyword: string | null;
    replyTemplate: string;
    isActive: boolean;
    sentCount: number;
}

interface QueuedMsg {
    id: string;
    senderId: string;
    senderName: string;
    originalMessage: string;
    aiSuggestedReply: string;
    platform: string;
    status: string;
}

export default function DMManager() {
    const { user, plan } = useAuth();
    const API_ROOT = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api$/, '');

    const [activeTab, setActiveTab] = useState<'automations' | 'inbox' | 'sent'>('inbox');
    const [automations, setAutomations] = useState<Automation[]>([]);
    const [queue, setQueue] = useState<QueuedMsg[]>([]);
    const [loading, setLoading] = useState(true);

    // Create Modal state
    const [showCreate, setShowCreate] = useState(false);
    const [newAuto, setNewAuto] = useState({ platform: 'instagram', trigger: 'keyword', keyword: '', replyTemplate: '' });

    // Edit Message State
    const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState('');

    const fetchState = async () => {
        setLoading(true);
        try {
            const token = await user?.getIdToken();
            // Fetch queue
            if (['creator', 'agency'].includes(plan || '')) {
                const qRes = await fetch(`${API_ROOT}/api/dm/queue`, { headers: { 'Authorization': `Bearer ${token}` } });
                const qData = await qRes.json();
                if (qData.success) setQueue(qData.queue);
            }
            // Fetch auto
            const aRes = await fetch(`${API_ROOT}/api/dm/automations`, { headers: { 'Authorization': `Bearer ${token}` } });
            const aData = await aRes.json();
            if (aData.success) setAutomations(aData.automations);
        } catch (err) {
            console.error(err);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchState();
    }, [user, plan]);

    const toggleAuto = async (id: string, current: boolean) => {
        try {
            const token = await user?.getIdToken();
            await fetch(`${API_ROOT}/api/dm/automations/${id}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: !current })
            });
            setAutomations(prev => prev.map(a => a.id === id ? { ...a, isActive: !current } : a));
        } catch { }
    };

    const createAutomation = async () => {
        if (plan === 'starter') return alert('Upgrade to Nano+ to create automations');
        try {
            const token = await user?.getIdToken();
            const res = await fetch(`${API_ROOT}/api/dm/automations`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(newAuto)
            });
            const data = await res.json();
            if (data.success) {
                setShowCreate(false);
                fetchState();
            } else {
                alert(data.error);
            }
        } catch { }
    };

    const handleDeleteAuto = async (id: string) => {
        try {
            const token = await user?.getIdToken();
            await fetch(`${API_ROOT}/api/dm/automations/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setAutomations(prev => prev.filter(a => a.id !== id));
        } catch { }
    };

    const processMsg = async (id: string, action: 'send' | 'dismiss' | 'edit-send', text?: string) => {
        try {
            const token = await user?.getIdToken();
            const payload = text ? JSON.stringify({ text }) : null;

            const res = await fetch(`${API_ROOT}/api/dm/queue/${id}/${action}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, ...(payload && { 'Content-Type': 'application/json' }) },
                body: payload
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            setQueue(prev => prev.filter(q => q.id !== id));
            setEditingMsgId(null);
        } catch (err: any) {
            alert(`Error: ${err.message}`);
        }
    };

    return (
        <div className="dm-manager-container">
            <div className="dm-sidebar">
                <div className="dm-nav">
                    <h2>DM Studio</h2>
                    <button className={`nav-btn ${activeTab === 'inbox' ? 'active' : ''}`} onClick={() => setActiveTab('inbox')}>
                        <Inbox size={18} /> Review Inbox {queue.length > 0 && <span className="badge">{queue.length}</span>}
                    </button>
                    <button className={`nav-btn ${activeTab === 'automations' ? 'active' : ''}`} onClick={() => setActiveTab('automations')}>
                        <Settings2 size={18} /> Keyword Automations
                    </button>
                </div>
            </div>

            <div className="dm-main-content">
                <div className="content-inner">

                    {/* ── INBOX VIEW ── */}
                    {activeTab === 'inbox' && (
                        <div className="inbox-view">
                            <div className="view-header">
                                <h3>AI Smart Queue {plan === 'starter' && '(Creator+ required)'}</h3>
                                <button className="btn-icon" onClick={fetchState}><RefreshCw size={16} /></button>
                            </div>

                            {queue.length === 0 ? (
                                <div className="empty-state">No pending messages in smart queue.</div>
                            ) : (
                                <div className="queue-list">
                                    {queue.map(msg => (
                                        <div key={msg.id} className="queue-card">
                                            <div className="msg-header">
                                                <span className="platform-tag">{msg.platform}</span>
                                                <strong>{msg.senderName}</strong>
                                            </div>
                                            <p className="original-msg">"{msg.originalMessage}"</p>

                                            <div className="reply-box">
                                                <span className="ai-badge">Suggested reply</span>
                                                {editingMsgId === msg.id ? (
                                                    <textarea
                                                        className="edit-textarea"
                                                        value={editDraft}
                                                        onChange={e => setEditDraft(e.target.value)}
                                                    />
                                                ) : (
                                                    <p className="ai-reply">{msg.aiSuggestedReply}</p>
                                                )}
                                            </div>

                                            <div className="action-row">
                                                {editingMsgId === msg.id ? (
                                                    <>
                                                        <button className="btn-primary" onClick={() => processMsg(msg.id, 'edit-send', editDraft)}>
                                                            <Send size={14} /> Send Edit
                                                        </button>
                                                        <button className="btn-ghost" onClick={() => setEditingMsgId(null)}>Cancel</button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button className="btn-primary" onClick={() => processMsg(msg.id, 'send', msg.aiSuggestedReply)}>
                                                            <Check size={16} /> Approve & Send
                                                        </button>
                                                        <button className="btn-outline" onClick={() => { setEditingMsgId(msg.id); setEditDraft(msg.aiSuggestedReply); }}>
                                                            <PenSquare size={14} /> Edit
                                                        </button>
                                                        <button className="btn-ghost" onClick={() => processMsg(msg.id, 'dismiss')}>
                                                            <X size={16} /> Dismiss
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── AUTOMATION VIEW ── */}
                    {activeTab === 'automations' && (
                        <div className="auto-view">
                            <div className="view-header">
                                <h3>Automation Rules</h3>
                                <button className="btn-primary" onClick={() => setShowCreate(true)}>+ New Rule</button>
                            </div>

                            {automations.length === 0 ? (
                                <div className="empty-state">No active keyword rules.</div>
                            ) : (
                                <div className="auto-grid">
                                    {automations.map(a => (
                                        <div key={a.id} className={`auto-card ${a.isActive ? 'active' : 'paused'}`}>
                                            <div className="card-top">
                                                <div>
                                                    <span className="platform-tag">{a.platform}</span>
                                                    <h4 style={{ margin: '8px 0' }}>Trigger: {a.trigger.replace('_', ' ')}</h4>
                                                    {a.keyword && <span className="keyword-chip">"{a.keyword}"</span>}
                                                </div>
                                                <button className="btn-icon" onClick={() => toggleAuto(a.id, a.isActive)}>
                                                    {a.isActive ? <ToggleRight color="#10b981" size={28} /> : <ToggleLeft color="#666" size={28} />}
                                                </button>
                                            </div>

                                            <div className="reply-preview">
                                                <small>Auto-Reply:</small>
                                                <p>{a.replyTemplate}</p>
                                            </div>

                                            <div className="card-footer">
                                                <span>Stats: <strong>{a.sentCount}</strong> sent</span>
                                                <button className="btn-icon danger" onClick={() => handleDeleteAuto(a.id)}><Trash2 size={16} /></button>
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
                <div className="modal-overlay" onClick={() => setShowCreate(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <h3>New Automation Rule</h3>

                        <div className="form-group">
                            <label>Platform</label>
                            <select value={newAuto.platform} onChange={e => setNewAuto({ ...newAuto, platform: e.target.value })} className="input-dark">
                                <option value="instagram">Instagram</option>
                            </select>
                        </div>

                        <div className="form-group">
                            <label>Trigger Type</label>
                            <select value={newAuto.trigger} onChange={e => setNewAuto({ ...newAuto, trigger: e.target.value })} className="input-dark">
                                <option value="keyword">Specific Keyword Match</option>
                                <option value="new_follower">New Follower Welcome</option>
                            </select>
                        </div>

                        {newAuto.trigger === 'keyword' && (
                            <div className="form-group">
                                <label>Trigger Keyword</label>
                                <input type="text" className="input-dark" placeholder="e.g. GROW" value={newAuto.keyword} onChange={e => setNewAuto({ ...newAuto, keyword: e.target.value })} />
                            </div>
                        )}

                        <div className="form-group">
                            <label>Auto-Reply Message</label>
                            <textarea className="input-dark" rows={4} placeholder="Hey! Here's the link..." value={newAuto.replyTemplate} onChange={e => setNewAuto({ ...newAuto, replyTemplate: e.target.value })} />
                        </div>

                        <div className="modal-actions" style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                            <button className="btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
                            <button className="btn-primary" onClick={createAutomation} style={{ flex: 1 }}>Create Rule</button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
