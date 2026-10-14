import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Download, ExternalLink, Link2, RefreshCw } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useWorkspace } from '../../context/WorkspaceContext';
import { apiClient } from '../../lib/api';
import './AnalyticsDashboard.css';

/**
 * Analytics from connected accounts. Only real numbers are shown: when there is no
 * data yet the page says so and points to what unlocks it.
 */

interface AnalyticsData {
    summary: {
        totalReach: number;
        totalImpressions: number;
        avgEngagementRate: number;
        totalFollowerGrowth: number;
    };
    byPlatform: Record<string, any>;
    topPosts: any[];
    growthChart: any[];
}

const PLATFORM_COLORS: Record<string, string> = {
    youtube: '#ff4e45',
    instagram: '#e4405f',
    tiktok: '#25f4ee',
    linkedin: '#3b8ed8',
    pinterest: '#e60023',
    threads: '#b8b8be',
    facebook: '#4f8ef7',
};
const PERIODS = [
    { id: '7d', label: '7 days' },
    { id: '30d', label: '30 days' },
    { id: '90d', label: '90 days' },
];

const fmt = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : Math.round(n).toLocaleString());

/** Hours of the day with the highest average reach across top posts (needs timestamps). */
function bestHours(posts: any[]) {
    const byHour = new Map<number, { reach: number; count: number }>();
    for (const post of posts) {
        const raw = post.publishedAt || post.createdAt || post.timestamp;
        const date = raw?._seconds ? new Date(raw._seconds * 1000) : raw ? new Date(raw) : null;
        if (!date || Number.isNaN(date.getTime())) continue;
        const h = date.getHours();
        const entry = byHour.get(h) || { reach: 0, count: 0 };
        entry.reach += post.reach || 0;
        entry.count += 1;
        byHour.set(h, entry);
    }
    return [...byHour.entries()]
        .map(([hour, v]) => ({ hour, avg: v.reach / v.count, count: v.count }))
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 3);
}

export default function AnalyticsDashboard() {
    const { currentWorkspace } = useWorkspace() as any;
    const [period, setPeriod] = useState('30d');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [data, setData] = useState<AnalyticsData | null>(null);
    const topPosts: any[] = data?.topPosts || [];

    const fetchAnalytics = async () => {
        try {
            setLoading(true);
            setError('');
            setData(await apiClient(`/api/analytics/overview?period=${period}`));
        } catch (err: any) {
            setError(err.message || 'Could not load analytics.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (currentWorkspace?.id) fetchAnalytics();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentWorkspace?.id, period]);

    const platforms = useMemo(
        () =>
            Object.entries(data?.byPlatform || {})
                .map(([id, stats]: [string, any]) => ({ id, reach: stats.reach || 0, engagement: stats.engagementRate || 0, followers: stats.followerGrowth || 0 }))
                .sort((a, b) => b.reach - a.reach),
        [data]
    );
    const series = useMemo(() => {
        const keys = new Set<string>();
        (data?.growthChart || []).forEach((row) => Object.keys(row).forEach((k) => k !== 'date' && typeof row[k] === 'number' && keys.add(k)));
        return [...keys];
    }, [data]);
    const hours = useMemo(() => bestHours(topPosts), [topPosts]);

    const s = data?.summary;
    const hasData = !!s && (s.totalReach > 0 || s.totalImpressions > 0 || topPosts.length > 0 || platforms.length > 0);
    const totalReach = platforms.reduce((sum, p) => sum + p.reach, 0) || 1;

    const postUrl = (post: any): string | null => {
        if (post.url || post.permalink) return post.url || post.permalink;
        if (post.platform === 'youtube' && post.id) return `https://www.youtube.com/watch?v=${encodeURIComponent(post.id)}`;
        return null;
    };

    const exportTopPosts = () => {
        const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['Rank', 'Platform', 'Caption', 'Reach', 'Likes', 'Comments', 'Shares', 'Post ID'],
            ...topPosts.map((p, i) => [i + 1, p.platform || '', p.caption || '', p.reach || 0, p.likes || 0, p.comments || 0, p.shares || 0, p.id || '']),
        ];
        const blob = new Blob([rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `kengan-top-posts-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };

    return (
        <div className="analytics-dashboard">
            <header className="page-head analytics-head">
                <div>
                    <h1>Analytics</h1>
                    <p>Reach and engagement from your connected accounts, updated every six hours.</p>
                </div>
                <div className="analytics-controls">
                    <div className="segmented" role="tablist" aria-label="Period">
                        {PERIODS.map((p) => (
                            <button key={p.id} className={period === p.id ? 'is-active' : ''} onClick={() => setPeriod(p.id)}>
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={fetchAnalytics} disabled={loading} aria-label="Refresh">
                        <RefreshCw size={15} className={loading ? 'spin' : ''} />
                    </button>
                </div>
            </header>

            {error ? <div className="error-banner">{error}</div> : null}

            {loading && !data ? <p className="muted">Loading analytics…</p> : null}

            {!loading && data && !hasData ? (
                <section className="surface analytics-empty">
                    <BarChart3 size={26} />
                    <h3>No numbers yet</h3>
                    <p>Analytics appear once a connected account has published posts. The first sync runs within six hours of connecting.</p>
                    <div className="analytics-empty__actions">
                        <Link to="/dashboard/connections" className="btn btn-primary btn-sm">
                            <Link2 size={14} /> Connect an account
                        </Link>
                        <Link to="/dashboard/scheduler" className="btn btn-secondary btn-sm">
                            Schedule a post
                        </Link>
                    </div>
                </section>
            ) : null}

            {hasData && s ? (
                <>
                    <section className="analytics-stats">
                        <div>
                            <span>Reach</span>
                            <strong>{fmt(s.totalReach)}</strong>
                        </div>
                        <div>
                            <span>Impressions</span>
                            <strong>{fmt(s.totalImpressions)}</strong>
                        </div>
                        <div>
                            <span>Engagement rate</span>
                            <strong>{s.avgEngagementRate.toFixed(1)}%</strong>
                        </div>
                        <div>
                            <span>New followers</span>
                            <strong>{s.totalFollowerGrowth >= 0 ? '+' : ''}{fmt(s.totalFollowerGrowth)}</strong>
                        </div>
                    </section>

                    <div className="analytics-grid">
                        <section className="surface analytics-card">
                            <h3>Reach over time</h3>
                            {data?.growthChart?.length && series.length ? (
                                <div className="analytics-chart">
                                    <ResponsiveContainer>
                                        <AreaChart data={data.growthChart} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-primary)" />
                                            <XAxis
                                                dataKey="date"
                                                tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                                            />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={fmt} />
                                            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-elevated)', fontSize: 12 }} />
                                            {series.map((key) => (
                                                <Area key={key} type="monotone" dataKey={key} stroke={PLATFORM_COLORS[key] || 'var(--accent-primary)'} fill={PLATFORM_COLORS[key] || 'var(--accent-primary)'} fillOpacity={0.12} strokeWidth={2} />
                                            ))}
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <p className="muted analytics-card__empty">The chart fills in after a few daily syncs.</p>
                            )}
                        </section>

                        <section className="surface analytics-card">
                            <h3>By platform</h3>
                            {platforms.length ? (
                                <ul className="analytics-platforms">
                                    {platforms.map((p) => (
                                        <li key={p.id}>
                                            <div className="analytics-platforms__row">
                                                <span className="analytics-platforms__name">
                                                    <i style={{ background: PLATFORM_COLORS[p.id] || 'var(--accent-primary)' }} />
                                                    {p.id}
                                                </span>
                                                <span>{fmt(p.reach)} reach</span>
                                            </div>
                                            <div className="analytics-platforms__bar">
                                                <div style={{ width: `${Math.round((p.reach / totalReach) * 100)}%`, background: PLATFORM_COLORS[p.id] || 'var(--accent-primary)' }} />
                                            </div>
                                            <small>
                                                {p.engagement.toFixed(1)}% engagement, {p.followers >= 0 ? '+' : ''}
                                                {fmt(p.followers)} followers
                                            </small>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="muted analytics-card__empty">No platform data yet.</p>
                            )}
                        </section>

                        <section className="surface analytics-card">
                            <div className="analytics-card__head">
                                <h3>Top posts</h3>
                                <button className="btn btn-ghost btn-sm" onClick={exportTopPosts} disabled={!topPosts.length}>
                                    <Download size={14} /> CSV
                                </button>
                            </div>
                            {topPosts.length ? (
                                <ol className="analytics-posts">
                                    {topPosts.map((post, i) => {
                                        const url = postUrl(post);
                                        return (
                                            <li key={post.id || i}>
                                                {post.thumbnail ? <img src={post.thumbnail} alt="" /> : <span className="analytics-posts__thumb" />}
                                                <div className="analytics-posts__info">
                                                    <p>{post.caption || 'Untitled post'}</p>
                                                    <small>
                                                        <span className="analytics-posts__platform">{post.platform}</span>
                                                        <span>{fmt(post.reach || 0)} reach</span>
                                                        <span>{fmt(post.likes || 0)} likes</span>
                                                        <span>{fmt(post.comments || 0)} comments</span>
                                                    </small>
                                                </div>
                                                {url ? (
                                                    <a className="btn-icon btn-sm" href={url} target="_blank" rel="noreferrer" aria-label="Open post">
                                                        <ExternalLink size={14} />
                                                    </a>
                                                ) : null}
                                            </li>
                                        );
                                    })}
                                </ol>
                            ) : (
                                <p className="muted analytics-card__empty">Your best posts appear here after they collect views.</p>
                            )}
                        </section>

                        <section className="surface analytics-card">
                            <h3>Best hours to post</h3>
                            {hours.length >= 2 ? (
                                <ol className="analytics-hours">
                                    {hours.map((h) => (
                                        <li key={h.hour}>
                                            <strong>{String(h.hour).padStart(2, '0')}:00</strong>
                                            <span>
                                                {fmt(h.avg)} average reach across {h.count} post{h.count === 1 ? '' : 's'}
                                            </span>
                                        </li>
                                    ))}
                                </ol>
                            ) : (
                                <p className="muted analytics-card__empty">
                                    Needs a few more published posts. Until then, the scheduler suggests 09:00, 12:30 and 17:30.
                                </p>
                            )}
                        </section>
                    </div>
                </>
            ) : null}
        </div>
    );
}
