import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { apiClient, apiFetch } from '../../lib/api';

const API_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
import { Search, Download, UploadCloud, Plus, User, FileText, Send, MoreHorizontal, Loader2, X } from 'lucide-react';
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
    followersCount?: number;
    bio?: string;
    score: number;
    tier: 'hot' | 'warm' | 'cold' | 'prospect';
    signals?: LeadSignal;
    notes?: string;
    status: 'prospect' | 'contacted' | 'negotiating' | 'closed' | 'lost';
    tags: string[];
    externalId?: string;
    source?: string;
}

const COLUMNS = ['prospect', 'contacted', 'negotiating', 'closed', 'lost'];

const PLATFORM_OPTIONS = ['instagram', 'facebook', 'tiktok', 'youtube', 'email', 'whatsapp', 'other'];

const EMPTY_NEW_LEAD = { username: '', platform: 'instagram', displayName: '', followersCount: '', notes: '' };

const PROFILE_URLS: Record<string, (u: string) => string> = {
    instagram: (u) => `https://www.instagram.com/${u}/`,
    tiktok: (u) => `https://www.tiktok.com/@${u}`,
    youtube: (u) => `https://www.youtube.com/@${u}`,
    facebook: (u) => `https://www.facebook.com/${u}`,
};

/** Public profile link built from the stored username, or null for unknown platforms. */
function profileUrl(lead: { platform: string; username: string }): string | null {
    const build = PROFILE_URLS[(lead.platform || '').toLowerCase()];
    const username = (lead.username || '').replace(/^@/, '').trim();
    return build && username ? build(encodeURIComponent(username)) : null;
}

/** Leads with a missing or unknown status still show up (in Prospect). */
function columnOf(lead: Lead) {
    return COLUMNS.includes(lead.status) ? lead.status : 'prospect';
}

function formatDate(value: any): string {
    if (!value) return 'Never';
    const d = typeof value?.toDate === 'function'
        ? value.toDate()
        : typeof value?._seconds === 'number' ? new Date(value._seconds * 1000) : new Date(value);
    return Number.isNaN(d.getTime()) ? 'Unknown' : d.toLocaleDateString();
}

const canDM = (lead: Lead) => !!lead.externalId && (lead.platform || 'instagram') === 'instagram';

export default function LeadsBoard() {
    const { user, plan } = useAuth() as any;
    const { currentWorkspace } = useWorkspace() as any;
    const leadsPath = currentWorkspace?.id ? `/workspaces/${currentWorkspace.id}/leads` : '';
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [actionError, setActionError] = useState('');
    const [actionNotice, setActionNotice] = useState('');
    const [searchTerm, setSearchTerm] = useState('');

    const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
    const [notesDraft, setNotesDraft] = useState('');
    const [panelError, setPanelError] = useState('');
    const [drafting, setDrafting] = useState(false);
    const [exporting, setExporting] = useState(false);

    const [showAdd, setShowAdd] = useState(false);
    const [newLead, setNewLead] = useState(EMPTY_NEW_LEAD);
    const [addError, setAddError] = useState('');
    const [adding, setAdding] = useState(false);

    const [draggingId, setDraggingId] = useState<string | null>(null);

    const fetchLeads = async () => {
        if (!user || !leadsPath) return;
        setLoading(true);
        setLoadError('');
        try {
            const data = await apiClient(leadsPath);
            setLeads(data.leads || []);
        } catch (err: any) {
            setLoadError(err.message || 'Leads could not be loaded.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (plan === 'agency') fetchLeads();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, leadsPath, plan]);

    const updateLeadStatus = async (id: string, newStatus: string) => {
        if (!leadsPath) return;
        const previous = leads;
        setActionError('');
        setLeads(prev => prev.map(l => l.id === id ? { ...l, status: newStatus as any } : l));
        try {
            await apiClient(`${leadsPath}/${id}`, { method: 'PATCH', body: { status: newStatus } });
        } catch (err: any) {
            setLeads(previous);
            setActionError(`Could not move the lead: ${err.message}`);
        }
    };

    const saveNotes = async () => {
        if (!selectedLead || (selectedLead.notes || '') === notesDraft || !leadsPath) return;
        setPanelError('');
        const id = selectedLead.id;
        setLeads(prev => prev.map(l => l.id === id ? { ...l, notes: notesDraft } : l));
        setSelectedLead(prev => prev && prev.id === id ? { ...prev, notes: notesDraft } : prev);
        try {
            await apiClient(`${leadsPath}/${id}`, { method: 'PATCH', body: { notes: notesDraft } });
        } catch (err: any) {
            setPanelError(`Notes were not saved: ${err.message}`);
        }
    };

    const triggerAutoDM = async (lead: Lead) => {
        if (!leadsPath || !canDM(lead)) return;
        setPanelError('');
        setDrafting(true);
        try {
            await apiClient(`${leadsPath}/${lead.id}/dm`, { method: 'POST' });
            setActionNotice('AI DM drafted. Approve it in the Inbox (DM Studio) before it is sent.');
            setSelectedLead(null);
        } catch (err: any) {
            setPanelError(`Could not draft the DM: ${err.message}`);
        } finally {
            setDrafting(false);
        }
    };

    const exportCSV = async () => {
        if (!leadsPath || !user) return;
        setActionError('');
        setExporting(true);
        try {
            const res = await apiFetch(`${API_URL}${leadsPath}/export`, {
                headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'x-workspace-id': currentWorkspace?.id || '' },
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Export failed (${res.status})`);
            const blob = new Blob([await res.text()], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'kengansocial-leads.csv';
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch (err: any) {
            setActionError(err.message || 'Export failed.');
        } finally {
            setExporting(false);
        }
    };

    const addLead = async () => {
        setAddError('');
        const username = newLead.username.trim().replace(/^@/, '');
        if (!username) {
            setAddError('Add the lead\'s username.');
            return;
        }
        const followers = newLead.followersCount === '' ? 0 : Number(newLead.followersCount);
        if (!Number.isFinite(followers) || followers < 0) {
            setAddError('Followers must be a positive number.');
            return;
        }
        if (!leadsPath) return;
        setAdding(true);
        try {
            await apiClient(leadsPath, {
                method: 'POST',
                body: {
                    username,
                    platform: newLead.platform,
                    displayName: newLead.displayName.trim(),
                    followersCount: Math.floor(followers),
                    notes: newLead.notes,
                },
            });
            setShowAdd(false);
            setNewLead(EMPTY_NEW_LEAD);
            setActionNotice(`@${username} added to Prospect.`);
            fetchLeads();
        } catch (err: any) {
            setAddError(err.message || 'Could not add the lead.');
        } finally {
            setAdding(false);
        }
    };

    const openPanel = (lead: Lead) => {
        setSelectedLead(lead);
        setNotesDraft(lead.notes || '');
        setPanelError('');
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
            const lead = leads.find(l => l.id === draggingId);
            if (lead && columnOf(lead) !== targetStatus) updateLeadStatus(draggingId, targetStatus);
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

    const sig = selectedLead?.signals;

    return (
        <div className="kanban-wrapper">

            {loadError ? <div role="alert" className="leads-banner leads-banner--error">{loadError}</div> : null}
            {actionError ? <div role="alert" className="leads-banner leads-banner--error">{actionError}</div> : null}
            {actionNotice ? (
                <div role="status" className="leads-banner leads-banner--success">
                    <span>{actionNotice}</span>
                    <button className="leads-banner__close" onClick={() => setActionNotice('')} aria-label="Dismiss"><X size={14} /></button>
                </div>
            ) : null}

            <div className="kanban-header">
                <div className="search-box">
                    <Search size={18} />
                    <input type="text" placeholder="Search leads by handle or name..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
                <div className="header-actions">
                    {loading && <span className="leads-loading"><Loader2 size={14} className="spin" /> Loading…</span>}
                    <button className="btn-outline" onClick={exportCSV} disabled={exporting}>
                        {exporting ? <Loader2 size={16} className="spin" /> : <Download size={16} />} Export CSV
                    </button>
                    <button className="btn-outline" disabled title="Importing people who engaged with a post is coming soon">
                        <UploadCloud size={16} /> Load Engagers (coming soon)
                    </button>
                    <button className="btn-primary" onClick={() => { setAddError(''); setNewLead(EMPTY_NEW_LEAD); setShowAdd(true); }}>
                        <Plus size={16} /> Add Lead
                    </button>
                </div>
            </div>

            <div className="kanban-board">
                {COLUMNS.map(col => {
                    const colLeads = filteredLeads.filter(l => columnOf(l) === col);
                    return (
                        <div
                            key={col}
                            className={`kanban-column ${col === 'lost' ? 'kanban-column--lost' : ''}`}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, col)}
                        >
                            <div className="column-header">
                                <h3>{col.charAt(0).toUpperCase() + col.slice(1)}</h3>
                                <span className="count-badge">{colLeads.length}</span>
                            </div>

                            <div className="column-body">
                                {colLeads.map(lead => (
                                    <div
                                        key={lead.id}
                                        className="lead-card"
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, lead.id)}
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
                                            <span className={`tier-badge tier-${lead.tier || 'prospect'}`}>{lead.score ?? 0} / 100</span>
                                            <span className="followers-count">{Number(lead.followersCount ?? 0).toLocaleString()} flwrs</span>
                                        </div>

                                        <div className="tag-row">
                                            {lead.tags?.slice(0, 2).map(t => <span key={t} className="tag-chip">{t}</span>)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Side Panel Drawer */}
            <div className={`side-panel ${selectedLead ? 'open' : ''}`}>
                {selectedLead && (
                    <div className="panel-content">
                        <button className="close-btn" onClick={() => setSelectedLead(null)} aria-label="Close">×</button>

                        <div className="panel-header">
                            <h2>{selectedLead.displayName || selectedLead.username}</h2>
                            <span className={`tier-badge tier-${selectedLead.tier || 'prospect'}`}>{(selectedLead.tier || 'prospect').toUpperCase()} SCORE: {selectedLead.score ?? 0}</span>
                        </div>

                        {panelError && <div role="alert" className="leads-banner leads-banner--error">{panelError}</div>}

                        <div className="panel-section">
                            <h4>Recorded signals</h4>
                            <dl className="lead-signals">
                                <dt>Followers</dt><dd>{Number(selectedLead.followersCount ?? 0).toLocaleString()}</dd>
                                <dt>Likes</dt><dd>{sig?.totalLikes ?? 0}</dd>
                                <dt>Comments</dt><dd>{sig?.totalComments ?? 0}</dd>
                                <dt>Story reply</dt><dd>{sig?.storyReply ? 'Yes' : 'No'}</dd>
                                <dt>Replied to a DM</dt><dd>{sig?.dmReplied ? 'Yes' : 'No'}</dd>
                                <dt>Clicked a link</dt><dd>{sig?.linkClicked ? 'Yes' : 'No'}</dd>
                                <dt>Last engaged</dt><dd>{formatDate(sig?.lastEngagedAt)}</dd>
                                {selectedLead.source ? <><dt>Source</dt><dd>{selectedLead.source}</dd></> : null}
                            </dl>
                        </div>

                        <div className="panel-section">
                            <h4><FileText size={16} /> Internal Notes (saves when you click away)</h4>
                            <textarea
                                className="notes-area"
                                value={notesDraft}
                                onChange={e => setNotesDraft(e.target.value)}
                                onBlur={saveNotes}
                                placeholder="E.g. Wants to charge $500 for a post, analyzing ROI..."
                            />
                        </div>

                        <div className="panel-actions">
                            <button
                                className="btn-primary full-width"
                                onClick={() => triggerAutoDM(selectedLead)}
                                disabled={drafting || !canDM(selectedLead)}
                            >
                                {drafting ? <Loader2 size={16} className="spin" /> : <Send size={16} />} Draft Custom AI Outreach DM
                            </button>
                            {!canDM(selectedLead) && (
                                <p className="lead-hint">
                                    Instagram only lets you message people who have DMed you first. Leads created by a DM automation can be messaged from here; for this lead, reach out on {selectedLead.platform || 'the platform'} directly.
                                </p>
                            )}
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

            {showAdd && (
                <div className="modal-overlay" onClick={() => !adding && setShowAdd(false)}>
                    <div className="modal card" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Add Lead</h3>
                            <button className="btn btn-ghost btn-icon" onClick={() => setShowAdd(false)} disabled={adding} aria-label="Close"><X size={18} /></button>
                        </div>
                        {addError && <div className="error-banner" role="alert">{addError}</div>}
                        <div className="modal-body">
                            <label className="field">
                                <span>Username *</span>
                                <input className="input" value={newLead.username} onChange={e => setNewLead({ ...newLead, username: e.target.value })} placeholder="@handle" autoFocus />
                            </label>
                            <label className="field">
                                <span>Platform</span>
                                <select className="input" value={newLead.platform} onChange={e => setNewLead({ ...newLead, platform: e.target.value })}>
                                    {PLATFORM_OPTIONS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                                </select>
                            </label>
                            <label className="field">
                                <span>Display name</span>
                                <input className="input" value={newLead.displayName} onChange={e => setNewLead({ ...newLead, displayName: e.target.value })} placeholder="Optional" />
                            </label>
                            <label className="field">
                                <span>Followers</span>
                                <input className="input" type="number" min={0} value={newLead.followersCount} onChange={e => setNewLead({ ...newLead, followersCount: e.target.value })} placeholder="0" />
                            </label>
                            <label className="field">
                                <span>Notes</span>
                                <textarea className="input" rows={3} value={newLead.notes} onChange={e => setNewLead({ ...newLead, notes: e.target.value })} />
                            </label>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowAdd(false)} disabled={adding}>Cancel</button>
                            <button className="btn btn-primary" onClick={addLead} disabled={adding || !newLead.username.trim()}>
                                {adding ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} Add Lead
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
