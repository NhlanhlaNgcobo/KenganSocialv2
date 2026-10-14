import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { Search, Download, UploadCloud, Plus, User, FileText, Send, MoreHorizontal } from 'lucide-react';
import './LeadsBoard.css';

interface LeadSignal {
    lastEngagedAt?: any;
    totalLikes: number;
    totalComments: number;
    dmOpened: boolean;
    dmReplied: boolean;
    linkClicked: boolean;
    bookingMade: boolean;
    storyReply: boolean;
}

interface Lead {
    id: string;
    username: string;
    platform: string;
    displayName?: string;
    avatarUrl?: string;
    followersCount: number;
    bio?: string;
    score: number;
    tier: 'hot' | 'warm' | 'cold' | 'prospect';
    signals: LeadSignal;
    notes?: string;
    status: 'prospect' | 'contacted' | 'negotiating' | 'closed' | 'lost';
    tags: string[];
}

const COLUMNS = ['prospect', 'contacted', 'negotiating', 'closed'];

const PROFILE_URLS: Record<string, (u: string) => string> = {
    instagram: (u) => `https://www.instagram.com/${u}/`,
    tiktok: (u) => `https://www.tiktok.com/@${u}`,
    youtube: (u) => `https://www.youtube.com/@${u}`,
    linkedin: (u) => `https://www.linkedin.com/in/${u}/`,
    threads: (u) => `https://www.threads.net/@${u}`,
    pinterest: (u) => `https://www.pinterest.com/${u}/`,
};

/** Public profile link built from the stored username, or null for unknown platforms. */
function profileUrl(lead: { platform: string; username: string }): string | null {
    const build = PROFILE_URLS[(lead.platform || '').toLowerCase()];
    const username = (lead.username || '').replace(/^@/, '').trim();
    return build && username ? build(encodeURIComponent(username)) : null;
}

export default function LeadsBoard() {
    const { user, plan } = useAuth();
    const { currentWorkspace } = useWorkspace();
    const API_ROOT = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api$/, '');
    const leadsBaseUrl = currentWorkspace?.id ? `${API_ROOT}/api/workspaces/${currentWorkspace.id}/leads` : '';
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
    const [notesDraft, setNotesDraft] = useState('');

    const [draggingId, setDraggingId] = useState<string | null>(null);

    const fetchLeads = async () => {
        if (!user || !leadsBaseUrl) return;
        try {
            setLoading(true);
            const token = await user?.getIdToken();
            const res = await fetch(leadsBaseUrl, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                setLeads(data.leads || []);
            }
        } catch (err) {
            console.error(err);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchLeads();
    }, [user, leadsBaseUrl]);

    const updateLeadStatus = async (id: string, newStatus: string) => {
        if (!leadsBaseUrl) return;
        setLeads(prev => prev.map(l => l.id === id ? { ...l, status: newStatus as any } : l));
        try {
            const token = await user?.getIdToken();
            await fetch(`${leadsBaseUrl}/${id}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
        } catch (err) {
            console.error('Failed to update status', err);
        }
    };

    const saveNotes = async () => {
        if (!selectedLead || selectedLead.notes === notesDraft || !leadsBaseUrl) return;
        setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, notes: notesDraft } : l));
        try {
            const token = await user?.getIdToken();
            await fetch(`${leadsBaseUrl}/${selectedLead.id}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: notesDraft })
            });
        } catch (err) { }
    };

    const triggerAutoDM = async (id: string) => {
        if (!leadsBaseUrl) return;
        try {
            const token = await user?.getIdToken();
            const res = await fetch(`${leadsBaseUrl}/${id}/dm`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                alert('AI DM drafted! Check your DM Queue to approve.');
                setSelectedLead(null);
            }
        } catch { }
    };

    const exportCSV = async () => {
        if (!leadsBaseUrl) return;
        const token = await user?.getIdToken();
        const res = await fetch(`${leadsBaseUrl}/export`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const csv = await res.text();
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'kengansocial-leads.csv';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    const importEngagers = async () => {
        if (!leadsBaseUrl) return;
        try {
            const token = await user?.getIdToken();
            const res = await fetch(`${leadsBaseUrl}/import-engagers`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ platform: 'instagram', postId: `demo_${Date.now()}` })
            });
            const data = await res.json();
            if (data.success) {
                fetchLeads();
            }
        } catch (err) {
            console.error('Failed to import engagers', err);
        }
    };

    const openPanel = (lead: Lead) => {
        setSelectedLead(lead);
        setNotesDraft(lead.notes || '');
    };

    // Drag functionality
    const handleDragStart = (e: React.DragEvent, id: string) => {
        setDraggingId(id);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent, targetStatus: string) => {
        e.preventDefault();
        if (draggingId) {
            updateLeadStatus(draggingId, targetStatus);
            setDraggingId(null);
        }
    };

    const filteredLeads = leads.filter(l =>
        (l.username || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (l.displayName || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (plan !== 'agency') {
        return (
            <div className="upgrade-lock">
                <h2>Leads</h2>
                <p>Everyone who comments on or messages your accounts lands on one board, scored by how likely they are to buy, so your team knows who to answer first. Export to your CRM when they are ready.</p>
                <p className="upgrade-lock__plan">Leads is part of the Agency plan.</p>
                <a href="/dashboard/billing" className="btn btn-primary btn-sm">See plans</a>
            </div>
        );
    }

    return (
        <div className="kanban-wrapper">

            <div className="kanban-header">
                <div className="search-box">
                    <Search size={18} />
                    <input type="text" placeholder="Search leads by handle or name..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
                <div className="header-actions">
                    <button className="btn-outline" onClick={exportCSV}><Download size={16} /> Export CSV</button>
                    <button className="btn-outline" onClick={importEngagers}><UploadCloud size={16} /> Load Engagers</button>
                    <button className="btn-primary" onClick={() => alert('Feature coming soon')}><Plus size={16} /> Add Lead</button>
                </div>
            </div>

            <div className="kanban-board">
                {COLUMNS.map(col => (
                    <div
                        key={col}
                        className="kanban-column"
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, col)}
                    >
                        <div className="column-header">
                            <h3>{col.charAt(0).toUpperCase() + col.slice(1)}</h3>
                            <span className="count-badge">{filteredLeads.filter(l => l.status === col).length}</span>
                        </div>

                        <div className="column-body">
                            {filteredLeads.filter(l => l.status === col).map(lead => (
                                <div
                                    key={lead.id}
                                    className="lead-card"
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, lead.id!)}
                                    onClick={() => openPanel(lead)}
                                >
                                    <div className="card-top">
                                        <div className="avatar-placeholder"><User size={20} /></div>
                                        <div className="card-info">
                                            <strong>{lead.displayName || lead.username}</strong>
                                            <span>@{lead.username} • {lead.platform}</span>
                                        </div>
                                        <button
                                            className="more-btn"
                                            title="Open lead details"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openPanel(lead);
                                            }}
                                        >
                                            <MoreHorizontal size={16} />
                                        </button>
                                    </div>

                                    <div className="card-metrics">
                                        <span className={`tier-badge tier-${lead.tier}`}>{lead.score} / 100</span>
                                        <span className="followers-count">{lead.followersCount.toLocaleString()} flwrs</span>
                                    </div>

                                    <div className="tag-row">
                                        {lead.tags?.slice(0, 2).map(t => <span key={t} className="tag-chip">{t}</span>)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Side Panel Drawer */}
            <div className={`side-panel ${selectedLead ? 'open' : ''}`}>
                {selectedLead && (
                    <div className="panel-content">
                        <button className="close-btn" onClick={() => setSelectedLead(null)}>×</button>

                        <div className="panel-header">
                            <h2>{selectedLead.displayName || selectedLead.username}</h2>
                            <span className={`tier-badge tier-${selectedLead.tier}`}>{selectedLead.tier.toUpperCase()} SCORE: {selectedLead.score}</span>
                        </div>

                        <div className="panel-section">
                            <h4>Signal Strength Breakdown</h4>
                            <div className="breakdown-bars">
                                <div className="bar-row">
                                    <span>Profile Fit</span>
                                    <div className="bar-bg"><div className="bar-fill profile" style={{ width: '80%' }}></div></div>
                                </div>
                                <div className="bar-row">
                                    <span>Engagement Map (<Flame /> {selectedLead.signals?.totalLikes || 0})</span>
                                    <div className="bar-bg"><div className="bar-fill engage" style={{ width: `${Math.min(100, (selectedLead.signals?.totalLikes || 0) * 10)}%` }}></div></div>
                                </div>
                                <div className="bar-row">
                                    <span>Comm Recency</span>
                                    <div className="bar-bg"><div className="bar-fill recent" style={{ width: '40%' }}></div></div>
                                </div>
                            </div>
                        </div>

                        <div className="panel-section">
                            <h4><FileText size={16} /> Internal Notes (Auto-saves)</h4>
                            <textarea
                                className="notes-area"
                                value={notesDraft}
                                onChange={e => setNotesDraft(e.target.value)}
                                onBlur={saveNotes}
                                placeholder="E.g. Wants to charge $500 for a post, analyzing ROI..."
                            />
                        </div>

                        <div className="panel-actions">
                            <button className="btn-primary full-width" onClick={() => triggerAutoDM(selectedLead.id!)}>
                                <Send size={16} /> Draft Custom AI Outreach DM
                            </button>
                            {profileUrl(selectedLead) ? (
                                <a className="btn-outline full-width" href={profileUrl(selectedLead)!} target="_blank" rel="noreferrer" style={{ textAlign: 'center', textDecoration: 'none' }}>
                                    View Profile on {selectedLead.platform}
                                </a>
                            ) : null}
                        </div>

                    </div>
                )}
            </div>
            {(selectedLead) && <div className="panel-backdrop" onClick={() => setSelectedLead(null)}></div>}

        </div>
    );
}

function Flame() {
    return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>;
}
