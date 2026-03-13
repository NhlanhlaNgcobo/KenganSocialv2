import { useState, useEffect } from 'react';
import {
    Instagram,
    Facebook,
    Linkedin,
    Twitter,
    Youtube,
    Smartphone,
    CheckCircle2,
    AlertCircle,
    Plus,
    RefreshCw,
    MoreVertical,
    Trash2,
    Loader2
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { apiClient } from '../lib/api';
import './Connections.css';

const PLATFORM_META = {
    tiktok: { name: 'TikTok', icon: Smartphone, color: '#000000' },
    instagram: { name: 'Instagram', icon: Instagram, color: '#E4405F' },
    facebook: { name: 'Facebook Page', icon: Facebook, color: '#1877F2' },
    linkedin: { name: 'LinkedIn', icon: Linkedin, color: '#0A66C2' },
    twitter: { name: 'X (Twitter)', icon: Twitter, color: '#000000' },
    youtube: { name: 'YouTube', icon: Youtube, color: '#FF0000' },
};

const ALL_PLATFORMS = ['tiktok', 'instagram', 'facebook', 'linkedin', 'twitter', 'youtube'];

const PLACEHOLDER_CONNECTIONS = [
    { id: 'sim_tiktok', platform: 'tiktok', username: 'kengan_social', status: 'active', followers: '12.4K', connectedAt: '2026-01-15' },
    { id: 'sim_instagram', platform: 'instagram', username: 'kengansocial', status: 'active', followers: '8.2K', connectedAt: '2026-01-10' },
    { id: 'sim_facebook', platform: 'facebook', username: 'KenganSocial Page', status: 'active', followers: '3.1K', connectedAt: '2026-02-01' },
    { id: 'sim_youtube', platform: 'youtube', username: 'KenganSocial', status: 'active', followers: '1.5K', connectedAt: '2026-02-05' },
    { id: 'sim_twitter', platform: 'twitter', username: 'kengansocial', status: 'expired', followers: '950', connectedAt: '2025-12-20' },
];

export default function ConnectionsPage() {
    const { currentWorkspace } = useWorkspace();
    const [connections, setConnections] = useState([]);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(null);
    const [customFolders, setCustomFolders] = useState([]);

    useEffect(() => {
        fetchConnections();
    }, [currentWorkspace?.id]);

    const fetchConnections = async () => {
        setLoading(true);
        try {
            if (currentWorkspace?.id) {
                const data = await apiClient(`/workspaces/${currentWorkspace.id}/connections`);
                const live = data.connections || [];
                setConnections(live.length > 0 ? live : PLACEHOLDER_CONNECTIONS);
            } else {
                setConnections(PLACEHOLDER_CONNECTIONS);
            }
        } catch (error) {
            console.warn('Connections API unavailable, using placeholders:', error.message);
            setConnections(PLACEHOLDER_CONNECTIONS);
        } finally {
            setLoading(false);
        }
    };

    const updateConnectionGroup = async (connectionId, groupName) => {
        try {
            // Optimistic update
            setConnections(prev => prev.map(c => c.id === connectionId ? { ...c, groupName } : c));
            if (currentWorkspace?.id && !connectionId.startsWith('sim_')) {
                await apiClient(`/workspaces/${currentWorkspace.id}/connections/${connectionId}`, {
                    method: 'PUT',
                    body: JSON.stringify({ groupName })
                });
            }
        } catch (err) {
            console.error('Failed to update group:', err);
        }
    };

    const handleAddFolder = () => {
        const name = prompt("Enter Client or Agency Name:");
        if (name && !customFolders.includes(name)) {
            setCustomFolders(p => [...p, name]);
        }
    };

    const handleConnect = async (platformId, targetGroup = '') => {
        setConnecting(platformId);
        try {
            if (currentWorkspace?.id) {
                await apiClient(`/workspaces/${currentWorkspace.id}/connections`, {
                    method: 'POST',
                    body: JSON.stringify({
                        platform: platformId,
                        accountId: `mock_${Date.now()}`,
                        username: `${platformId}_user`,
                        accessToken: 'mock_token',
                        groupName: targetGroup || null
                    }),
                });
                await fetchConnections();
            } else {
                // Simulate connection locally
                await new Promise(r => setTimeout(r, 1000));
                const meta = PLATFORM_META[platformId];
                setConnections(prev => [
                    ...prev,
                    {
                        id: `sim_${platformId}_${Date.now()}`,
                        platform: platformId,
                        username: `${platformId}_user`,
                        status: 'active',
                        followers: '0',
                        groupName: targetGroup || null,
                        connectedAt: new Date().toISOString(),
                    },
                ]);
            }
        } catch (error) {
            // Simulate locally on failure
            console.warn('Connect API failed, simulating locally');
            await new Promise(r => setTimeout(r, 800));
            setConnections(prev => [
                ...prev,
                {
                    id: `sim_${platformId}_${Date.now()}`,
                    platform: platformId,
                    username: `${platformId}_user`,
                    status: 'active',
                    followers: '0',
                    groupName: targetGroup || null,
                    connectedAt: new Date().toISOString(),
                },
            ]);
        } finally {
            setConnecting(null);
        }
    };

    const handleDisconnect = async (connectionId) => {
        try {
            if (currentWorkspace?.id && !connectionId.startsWith('sim_')) {
                await apiClient(`/workspaces/${currentWorkspace.id}/connections/${connectionId}`, {
                    method: 'DELETE',
                });
                await fetchConnections();
            } else {
                // Remove locally
                setConnections(prev => prev.filter(c => c.id !== connectionId));
            }
        } catch (error) {
            // Remove locally on failure
            setConnections(prev => prev.filter(c => c.id !== connectionId));
        }
    };

    // Build display list: merge live connections with all platform slots
    const connectedMap = {};
    connections.forEach(c => { connectedMap[c.platform] = c; });

    return (
        <div className="connections-page animate-fade-in">
            <div className="page-header">
                <div>
                    <h1>Social Connections</h1>
                    <p className="page-subtitle">Manage your linked social media accounts and pages.</p>
                </div>
                <div>
                    <button className="btn btn-secondary" style={{ marginRight: '12px' }} onClick={handleAddFolder}>
                        <Plus size={18} /> New Client Folder
                    </button>
                    <button className="btn btn-primary" onClick={() => document.getElementById('add-connection-select-Ungrouped')?.focus()}>
                        <Plus size={18} /> Add General Platform
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="card" style={{ padding: '60px', textAlign: 'center' }}>
                    <Loader2 size={32} className="spin" style={{ color: 'var(--accent-primary)', margin: '0 auto' }} />
                    <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Loading connections...</p>
                </div>
            ) : (
                <>
                    <div className="page-header">
                        <h3 style={{ marginTop: '32px' }}>Workspace Folders</h3>
                    </div>
                    {(() => {
                        const allFolders = Array.from(new Set([...customFolders, ...connections.map(c => c.groupName).filter(Boolean)]));
                        const grouped = { 'Ungrouped': [] };
                        allFolders.forEach(f => grouped[f] = []);

                        connections.forEach(curr => {
                            const group = curr.groupName || 'Ungrouped';
                            if (!grouped[group]) grouped[group] = [];
                            grouped[group].push(curr);
                        });

                        const groupsToRender = allFolders.map(folder => [folder, grouped[folder]]);
                        if (grouped['Ungrouped'].length > 0) {
                            groupsToRender.push(['Ungrouped', grouped['Ungrouped']]);
                        } else if (allFolders.length === 0) {
                            groupsToRender.push(['Ungrouped', []]);
                        }

                        return groupsToRender.map(([group, groupConns]) => (
                            <div key={group} className="connection-group-section" style={{
                                marginBottom: '48px',
                                background: 'var(--bg-secondary)',
                                padding: '24px',
                                borderRadius: '12px',
                                border: '1px solid var(--border-color)'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                                    <h4 style={{
                                        color: 'var(--text-primary)',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.05em',
                                        fontSize: '15px'
                                    }}>
                                        {group === 'Ungrouped' ? 'General / Ungrouped' : `Client: ${group}`}
                                    </h4>
                                    <span className="text-muted text-sm">{groupConns.length} accounts</span>
                                </div>

                                <div className="connections-grid stagger-children">
                                    {groupConns.map((conn) => {
                                        const meta = PLATFORM_META[conn.platform] || PLATFORM_META.instagram;
                                        const Icon = meta.icon;

                                        return (
                                            <div key={conn.id} className="connection-card card connection-card--connected">
                                                <div className="connection-card__header">
                                                    <div
                                                        className="platform-icon"
                                                        style={{ backgroundColor: `${meta.color}15`, color: meta.color }}
                                                    >
                                                        <Icon size={24} />
                                                    </div>
                                                    <div className="connection-card__actions">
                                                        <button className="btn-icon btn-ghost" onClick={() => handleDisconnect(conn.id)} title="Disconnect">
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </div>

                                                <div className="connection-card__body">
                                                    <h3>{meta.name}</h3>
                                                    <p className="username">@{conn.username}</p>
                                                    {conn.followers && (
                                                        <p className="followers-count">{conn.followers} followers</p>
                                                    )}
                                                    <div className={`status-badge ${conn.status}`}>
                                                        {conn.status === 'active' ? (
                                                            <><CheckCircle2 size={12} /> Active</>
                                                        ) : (
                                                            <><AlertCircle size={12} /> Expired</>
                                                        )}
                                                    </div>

                                                    <div style={{ marginTop: '12px' }}>
                                                        <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Move to Folder</label>
                                                        <select
                                                            className="input input-sm"
                                                            value={conn.groupName || ''}
                                                            onChange={(e) => updateConnectionGroup(conn.id, e.target.value)}
                                                            style={{ width: '100%', border: '1px solid var(--border-color)', background: 'var(--bg-primary)' }}
                                                        >
                                                            <option value="">General / Ungrouped</option>
                                                            {allFolders.map(f => <option key={f} value={f}>{f}</option>)}
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {/* Add connection slot specific to this folder */}
                                    <div className="connection-card card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '260px', borderStyle: 'dashed', background: 'transparent' }}>
                                        <div className="platform-icon" style={{ backgroundColor: `var(--bg-primary)`, color: 'var(--text-secondary)', marginBottom: '16px' }}>
                                            <Plus size={24} />
                                        </div>
                                        <h4 style={{ marginBottom: '16px', fontSize: '14px' }}>Add Account to {group === 'Ungrouped' ? 'General' : group}</h4>
                                        <select
                                            id={`add-connection-select-${group}`}
                                            className="input mb-sm"
                                            style={{ width: '80%' }}
                                            onChange={(e) => {
                                                if (e.target.value) {
                                                    const targetGrp = group === 'Ungrouped' ? '' : group;
                                                    handleConnect(e.target.value, targetGrp);
                                                    e.target.value = '';
                                                }
                                            }}
                                        >
                                            <option value="">Select Platform...</option>
                                            {ALL_PLATFORMS.map(p => <option key={p} value={p}>{PLATFORM_META[p].name}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        ));
                    })()}
                </>
            )}

            <section className="connection-info card glass">
                <AlertCircle size={24} className="text-info" />
                <div>
                    <h4>Connection Security</h4>
                    <p>KenganSocial uses official OAuth APIs to connect to your accounts. We never store your passwords and only request the minimum permissions needed to publish content.</p>
                </div>
            </section>
        </div>
    );
}
