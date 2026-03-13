import { useState, useEffect } from 'react';
import {
    BarChart3,
    TrendingUp,
    Users,
    Heart,
    MessageCircle,
    Share2,
    ArrowUpRight,
    ArrowDownRight,
    Download,
    Calendar,
    Loader2
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { apiClient } from '../lib/api';
import './Analytics.css';

export default function AnalyticsPage() {
    const { currentWorkspace } = useWorkspace();
    const [period, setPeriod] = useState('30d');
    const [overview, setOverview] = useState(null);
    const [connections, setConnections] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (currentWorkspace?.id) {
            loadAnalytics();
        }
    }, [currentWorkspace, period]);

    const loadAnalytics = async () => {
        try {
            setLoading(true);
            const data = await apiClient(`/analytics/${currentWorkspace.id}?period=${period}`);
            setOverview(data.overview || {});
            setConnections(data.connections || []);
        } catch (error) {
            console.error('Analytics load error:', error);
        } finally {
            setLoading(false);
        }
    };

    const metrics = [
        { label: 'Total Engagement', value: overview?.totalEngagement ?? '—', change: null, type: 'increase', icon: Heart },
        { label: 'Profile Reach', value: overview?.totalViews ?? '—', change: null, type: 'increase', icon: TrendingUp },
        { label: 'Total Posts', value: overview?.totalPosts ?? '—', change: null, type: 'increase', icon: Users },
        { label: 'Engagement Rate', value: overview?.engagementRate ? `${overview.engagementRate}%` : '—', change: null, type: 'increase', icon: BarChart3 },
    ];

    return (
        <div className="analytics-page animate-fade-in">
            <div className="page-header">
                <div>
                    <h1>Performance Analytics</h1>
                    <p className="page-subtitle">Track your growth and engagement across all platforms.</p>
                </div>
                <div className="flex gap-md">
                    <select className="input input-sm" value={period} onChange={e => setPeriod(e.target.value)} style={{ width: 'auto' }}>
                        <option value="7d">Last 7 Days</option>
                        <option value="30d">Last 30 Days</option>
                        <option value="90d">Last 90 Days</option>
                    </select>
                    <button className="btn btn-primary"><Download size={18} /> Export Data</button>
                </div>
            </div>

            {loading ? (
                <div className="card" style={{ padding: '80px', textAlign: 'center' }}>
                    <Loader2 size={32} className="spin" style={{ color: 'var(--accent-primary)', margin: '0 auto' }} />
                    <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Loading analytics...</p>
                </div>
            ) : (
                <>
                    <div className="metrics-grid stagger-children">
                        {metrics.map((metric) => (
                            <div key={metric.label} className="metric-card card">
                                <div className="metric-header">
                                    <div className="metric-icon"><metric.icon size={20} /></div>
                                </div>
                                <div className="metric-body">
                                    <span className="metric-value">{metric.value}</span>
                                    <span className="metric-label">{metric.label}</span>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="analytics-main-grid">
                        <div className="chart-container card">
                            <div className="section-title">
                                <h3>Platform Breakdown</h3>
                            </div>
                            {overview?.platformBreakdown && Object.keys(overview.platformBreakdown).length > 0 ? (
                                <div className="platform-breakdown-list">
                                    {Object.entries(overview.platformBreakdown).map(([platform, data]) => (
                                        <div key={platform} className="breakdown-row">
                                            <span className="breakdown-platform">{platform}</span>
                                            <div className="breakdown-stats">
                                                <span><Heart size={12} /> {data.likes}</span>
                                                <span><MessageCircle size={12} /> {data.comments}</span>
                                                <span><Share2 size={12} /> {data.shares}</span>
                                                <span className="breakdown-posts">{data.posts} posts</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p style={{ color: 'var(--text-secondary)', padding: '40px 0', textAlign: 'center' }}>
                                    No platform data available yet. Publish content to see analytics.
                                </p>
                            )}
                        </div>

                        <div className="top-content card">
                            <div className="section-title">
                                <h3>Top Performing Posts</h3>
                            </div>
                            <div className="content-list">
                                {overview?.topPosts?.length > 0 ? overview.topPosts.map((post, i) => (
                                    <div key={i} className="content-item">
                                        <div className="content-thumb" />
                                        <div className="content-info">
                                            <span className="content-title">{post.caption || 'Untitled Post'}</span>
                                            <span className="content-meta">Published {new Date(post.publishedAt).toLocaleDateString()}</span>
                                        </div>
                                        <div className="content-stats">
                                            <span className="stat"><Heart size={12} /> {post.metrics?.likes || 0}</span>
                                            <span className="stat"><MessageCircle size={12} /> {post.metrics?.comments || 0}</span>
                                        </div>
                                    </div>
                                )) : (
                                    <p style={{ color: 'var(--text-secondary)', padding: '24px 0', textAlign: 'center' }}>
                                        No published posts yet.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
