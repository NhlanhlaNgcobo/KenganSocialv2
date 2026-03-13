import { useState, useEffect } from 'react';
import {
    Users,
    Mail,
    Search,
    Filter,
    Plus,
    MoreVertical,
    Eye,
    Pencil,
    Loader2,
    AlertCircle,
    X
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { apiClient } from '../lib/api';
import './Leads.css';

const STATUS_COLORS = {
    new: '#3b82f6',
    contacted: '#f59e0b',
    qualified: '#10b981',
    converted: '#8b5cf6',
};

export default function LeadsPage() {
    const { currentWorkspace } = useWorkspace();
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [showAddModal, setShowAddModal] = useState(false);
    const [newLead, setNewLead] = useState({ name: '', email: '', platform: 'instagram', source: 'organic' });
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (currentWorkspace?.id) {
            fetchLeads();
        }
    }, [currentWorkspace]);

    const fetchLeads = async () => {
        try {
            setLoading(true);
            const data = await apiClient(`/workspaces/${currentWorkspace.id}/leads`);
            setLeads(data.leads || []);
        } catch (err) {
            console.error('Failed to fetch leads:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleAddLead = async () => {
        if (!newLead.name || !newLead.email) return;
        setAdding(true);
        setError('');

        try {
            await apiClient(`/workspaces/${currentWorkspace.id}/leads`, {
                method: 'POST',
                body: JSON.stringify(newLead),
            });
            await fetchLeads();
            setShowAddModal(false);
            setNewLead({ name: '', email: '', platform: 'instagram', source: 'organic' });
        } catch (err) {
            setError(err.message || 'Failed to add lead');
        } finally {
            setAdding(false);
        }
    };

    const handleStatusChange = async (leadId, newStatus) => {
        try {
            await apiClient(`/workspaces/${currentWorkspace.id}/leads/${leadId}`, {
                method: 'PUT',
                body: JSON.stringify({ status: newStatus }),
            });
            await fetchLeads();
        } catch (err) {
            console.error('Status update failed:', err);
        }
    };

    const filteredLeads = leads.filter(lead => {
        const matchesSearch = lead.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            lead.email?.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesFilter = filterStatus === 'all' || lead.status === filterStatus;
        return matchesSearch && matchesFilter;
    });

    return (
        <div className="leads-page animate-fade-in">
            <div className="page-header">
                <div>
                    <h1>Leads & CRM</h1>
                    <p className="page-subtitle">Manage leads captured from your social campaigns.</p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                    <Plus size={18} /> Add Lead
                </button>
            </div>

            <div className="leads-controls card">
                <div className="search-box">
                    <Search size={18} />
                    <input
                        type="text"
                        placeholder="Search leads by name or email..."
                        className="input"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>
                <div className="filter-group">
                    <Filter size={16} />
                    {['all', 'new', 'contacted', 'qualified', 'converted'].map(status => (
                        <button
                            key={status}
                            className={`filter-btn ${filterStatus === status ? 'active' : ''}`}
                            onClick={() => setFilterStatus(status)}
                        >
                            {status.charAt(0).toUpperCase() + status.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="card" style={{ padding: '60px', textAlign: 'center' }}>
                    <Loader2 size={32} className="spin" style={{ color: 'var(--accent-primary)', margin: '0 auto' }} />
                </div>
            ) : (
                <div className="leads-table card">
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Platform</th>
                                <th>Source</th>
                                <th>Status</th>
                                <th>Date</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredLeads.length > 0 ? filteredLeads.map(lead => (
                                <tr key={lead.id}>
                                    <td className="lead-name">{lead.name}</td>
                                    <td><Mail size={12} /> {lead.email}</td>
                                    <td>{lead.platform}</td>
                                    <td>{lead.source}</td>
                                    <td>
                                        <select
                                            className="status-select"
                                            value={lead.status}
                                            onChange={(e) => handleStatusChange(lead.id, e.target.value)}
                                            style={{ color: STATUS_COLORS[lead.status] || '#888' }}
                                        >
                                            <option value="new">New</option>
                                            <option value="contacted">Contacted</option>
                                            <option value="qualified">Qualified</option>
                                            <option value="converted">Converted</option>
                                        </select>
                                    </td>
                                    <td className="lead-date">{new Date(lead.createdAt).toLocaleDateString()}</td>
                                    <td><button className="btn-icon btn-ghost"><MoreVertical size={14} /></button></td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                                        {searchQuery || filterStatus !== 'all' ? 'No leads match your filters.' : 'No leads captured yet.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Add Lead Modal */}
            {showAddModal && (
                <div className="modal-overlay animate-fade-in" onClick={() => setShowAddModal(false)}>
                    <div className="modal card" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Add New Lead</h3>
                            <button className="btn-icon btn-ghost" onClick={() => setShowAddModal(false)}><X size={18} /></button>
                        </div>
                        {error && <div className="error-banner"><AlertCircle size={14} /><span>{error}</span></div>}
                        <div className="modal-body">
                            <label>Full Name</label>
                            <input className="input" value={newLead.name} onChange={e => setNewLead({ ...newLead, name: e.target.value })} placeholder="John Doe" />
                            <label>Email</label>
                            <input className="input" type="email" value={newLead.email} onChange={e => setNewLead({ ...newLead, email: e.target.value })} placeholder="john@example.com" />
                            <label>Platform</label>
                            <select className="input" value={newLead.platform} onChange={e => setNewLead({ ...newLead, platform: e.target.value })}>
                                <option value="instagram">Instagram</option>
                                <option value="tiktok">TikTok</option>
                                <option value="facebook">Facebook</option>
                                <option value="twitter">Twitter</option>
                                <option value="linkedin">LinkedIn</option>
                            </select>
                            <label>Source</label>
                            <select className="input" value={newLead.source} onChange={e => setNewLead({ ...newLead, source: e.target.value })}>
                                <option value="organic">Organic</option>
                                <option value="dm">DM Automation</option>
                                <option value="comment">Comment</option>
                                <option value="ads">Paid Ads</option>
                            </select>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleAddLead} disabled={adding || !newLead.name || !newLead.email}>
                                {adding ? <><Loader2 size={16} className="spin" /> Adding...</> : 'Add Lead'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
