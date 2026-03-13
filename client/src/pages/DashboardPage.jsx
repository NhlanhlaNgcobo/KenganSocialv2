import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    BarChart3,
    TrendingUp,
    Users,
    FileVideo,
    Calendar,
    Sparkles,
    ArrowUpRight,
    Loader2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { apiClient } from '../lib/api';
import './Dashboard.css';

const QUICK_ACTIONS = [
    { label: 'Create Post', icon: FileVideo, path: '/dashboard/content', color: '#8b5cf6' },
    { label: 'Schedule', icon: Calendar, path: '/dashboard/scheduler', color: '#3b82f6' },
    { label: 'AI Writer', icon: Sparkles, path: '/dashboard/ai-tools', color: '#10b981' },
    { label: 'Analytics', icon: BarChart3, path: '/dashboard/analytics', color: '#f59e0b' },
];

export default function DashboardPage() {
    const { profile } = useAuth();
    const { currentWorkspace } = useWorkspace();
    const navigate = useNavigate();
    const [stats, setStats] = useState(null);
    const [connections, setConnections] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (currentWorkspace?.id) {
            loadDashboardData();
        }
    }, [currentWorkspace]);

    const loadDashboardData = async () => {
        try {
            setLoading(true);

            const [analyticsData, schedulerData, creditsData, connectionsData] = await Promise.allSettled([
                apiClient(`/analytics/${currentWorkspace.id}?period=30d`),
                apiClient(`/scheduler/stats/${currentWorkspace.id}`),
                apiClient(`/ai/credits/${currentWorkspace.id}`),
                apiClient(`/workspaces/${currentWorkspace.id}/connections`),
            ]);

            const overview = analyticsData.status === 'fulfilled' ? analyticsData.value.overview : {};
            const scheduler = schedulerData.status === 'fulfilled' ? schedulerData.value.stats : {};
            const credits = creditsData.status === 'fulfilled' ? creditsData.value.credits : 0;
            const conns = connectionsData.status === 'fulfilled' ? connectionsData.value.connections : [];

            setStats({
                totalPosts: overview.totalPosts || 0,
                scheduled: scheduler.scheduled || 0,
                engagementRate: overview.engagementRate || 0,
                credits: credits || 0,
            });
            setConnections(conns);
        } catch (error) {
            console.error('Dashboard data load error:', error);
        } finally {
            setLoading(false);
        }
    };

    const displayStats = [
        { label: 'Total Posts', value: stats?.totalPosts ?? '—', icon: FileVideo, change: null, color: '#7c3aed' },
        { label: 'Scheduled', value: stats?.scheduled ?? '—', icon: Calendar, change: null, color: '#3b82f6' },
        { label: 'Engagement', value: stats?.engagementRate ? `${stats.engagementRate}%` : '—', icon: TrendingUp, change: null, color: '#10b981' },
        { label: 'AI Credits', value: stats?.credits ?? '—', icon: Sparkles, change: null, color: '#f59e0b' },
    ];

    return (
        <div className="dashboard-page">
            <div className="dashboard-page__header">
                <div>
                    <h1>Dashboard</h1>
                    <p className="dashboard-page__subtitle">
                        Welcome back{profile?.displayName ? `, ${profile.displayName}` : ''}! Here's your social media overview.
                    </p>
                </div>
                <button className="btn btn-primary" onClick={() => navigate('/dashboard/content')}>
                    <FileVideo size={16} />
                    New Post
                </button>
            </div>

            {/* Stats Grid */}
            <div className="stats-grid stagger-children">
                {displayStats.map((stat) => (
                    <div className="stat-card card" key={stat.label}>
                        <div className="stat-card__header">
                            <div
                                className="stat-card__icon"
                                style={{ background: `${stat.color}18`, color: stat.color }}
                            >
                                <stat.icon size={20} />
                            </div>
                            {loading && <Loader2 size={14} className="spin" style={{ color: 'var(--text-muted)' }} />}
                        </div>
                        <div className="stat-card__value">{loading ? '...' : stat.value}</div>
                        <div className="stat-card__label">{stat.label}</div>
                    </div>
                ))}
            </div>

            {/* Quick Actions */}
            <section className="dashboard-section">
                <h2>Quick Actions</h2>
                <div className="quick-actions stagger-children">
                    {QUICK_ACTIONS.map((action) => (
                        <a href={action.path} className="quick-action card" key={action.label}>
                            <div
                                className="quick-action__icon"
                                style={{ background: `${action.color}18`, color: action.color }}
                            >
                                <action.icon size={24} />
                            </div>
                            <span className="quick-action__label">{action.label}</span>
                        </a>
                    ))}
                </div>
            </section>

            {/* Connected Accounts */}
            <section className="dashboard-section">
                <div className="flex items-center justify-between">
                    <h2>Connected Accounts</h2>
                    <a href="/dashboard/connections" className="btn btn-ghost btn-sm">
                        Manage
                    </a>
                </div>
                {connections.length > 0 ? (
                    <div className="connected-accounts-row">
                        {connections.map(conn => (
                            <div key={conn.id} className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span className={`status-dot ${conn.status === 'active' ? 'active' : 'expired'}`} />
                                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{conn.platform}</span>
                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>@{conn.username}</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
                        <Users size={40} style={{ color: 'var(--text-muted)', margin: '0 auto 12px' }} />
                        <p style={{ color: 'var(--text-secondary)' }}>
                            No social accounts connected yet. Connect your first platform to get started.
                        </p>
                        <a href="/dashboard/connections" className="btn btn-primary" style={{ marginTop: '16px' }}>
                            Connect Account
                        </a>
                    </div>
                )}
            </section>
        </div>
    );
}
