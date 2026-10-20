import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, BarChart3, Download, ExternalLink, Link2, RefreshCw } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useWorkspace } from '../../context/WorkspaceContext';
import { apiClient } from '../../lib/api';
import './AnalyticsDashboard.css';

/**
 * Analytics read live from connected accounts. Only real numbers are shown: metrics a
 * platform doesn't report show as "—", and platforms that can't be read say why.
 */

interface PlatformStats {
    platform: string;
    status: 'ok' | 'unavailable';
    error?: string;
    reach: number | null;
    impressions: number | null;
    engagementRate: number | null;
    followerGrowth: number | null;
    followers: number | null;
    postCount: number;
}

interface Post {
    id: string;
    platform: string;
    caption: string;
    thumbnail: string | null;
    url: string | null;
    publishedAt: string | null;
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
}

interface AnalyticsData {
    periodDays: number;
    connectedCount: number;
    summary: {
        totalReach: number | null;
        totalImpressions: number | null;
        avgEngagementRate: number | null;
        totalFollowerGrowth: number | null;
        platformsReporting: number;
        platformsUnavailable: number;
    };
    byPlatform: Record<string, PlatformStats>;
    topPosts: Post[];
    growthChart: Array<Record<string, number | string>>;
    bestPostingTimes?: {
        status: 'ok' | 'insufficient_data';
        timezone: string;
        minPosts: number;
        postsAnalysed: number;
        slots: { hour: number; avgEngagement: number; posts: number }[];
    };
}

// TikTok cyan is too pale on white, so it resolves per theme (see AnalyticsDashboard.css).
const PLATFORM_COLORS: Record<string, string> = {
    youtube: '#ff4e45',
    instagram: '#e4405f',
    tiktok: 'var(--analytics-tiktok)',
    facebook: '#4f8ef7',
};
const PERIODS = [
    { id: '7d', label: '7 days' },
    { id: '30d', label: '30 days' },
    { id: '90d', label: '90 days' },
];

const fmt = (n: number) => (Math.abs(n) >= 10000 ? `${(n / 1000).toFixed(Math.abs(n) >= 100000 ? 0 : 1)}k` : Math.round(n).toLocaleString());
const fmtOrDash = (n: number | null | undefined) => (typeof n === 'number' ? fmt(n) : '—');
const signed = (n: number | null | undefined) => (typeof n === 'number' ? `${n >= 0 ? '+' : ''}${fmt(n)}` : '—');
const pct = (n: number | null | undefined) => (typeof n === 'number' ? `${n.toFixed(1)}%` : '—');

export default function AnalyticsDashboard() {
    const { currentWorkspace, loading: workspaceLoading } = useWorkspace() as any;
    const workspaceId: string | undefined = currentWorkspace?.id;
    const [period, setPeriod] = useState('30d');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [data, setData] = useState<AnalyticsData | null>(null);

    const fetchAnalytics = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            setData(await apiClient(`/api/analytics/overview?period=${period}`));
        } catch (err: any) {
            setError(err.message || 'Could not load analytics.');
        } finally {
            setLoading(false);
        }
    }, [period]);

    useEffect(() => {
        if (workspaceId) fetchAnalytics();
    }, [workspaceId, fetchAnalytics]);

    const topPosts: Post[] = useMemo(() => data?.topPosts || [], [data]);
    const platforms = useMemo(
        () =>
            Object.values(data?.byPlatform || {}).sort((a, b) => {
                if (a.status !== b.status) return a.status === 'ok' ? -1 : 1;
                return (b.reach ?? 0) - (a.reach ?? 0);
            }),
        [data]
    );
    const series = useMemo(() => {
        const keys = new Set<string>();
        (data?.growthChart || []).forEach((row) => Object.keys(row).forEach((k) => k !== 'date' && typeof row[k] === 'number' && keys.add(k)));
        return [...keys];
    }, [data]);

    const s = data?.summary;
    const okPlatforms = platforms.filter((p) => p.status === 'ok');
    const unavailable = platforms.filter((p) => p.status === 'unavailable');
    const totalReach = okPlatforms.reduce((sum, p) => sum + (p.reach ?? 0), 0) || 1;
    const best = data?.bestPostingTimes;

    const exportTopPosts = () => {
        const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['Rank', 'Platform', 'Published', 'Caption', 'Views', 'Likes', 'Comments', 'Shares', 'URL'],
            ...topPosts.map((p, i) => [i + 1, p.platform, p.publishedAt ?? '', p.caption, p.views ?? '', p.likes ?? '', p.comments ?? '', p.shares ?? '', p.url ?? '']),
        ];
        const blob = new Blob([rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `kengan-top-posts-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };

    const header = (
        <header className="page-head analytics-head">
            <div>
                <h1>Analytics</h1>
                <p>Reach and engagement read live from your connected accounts.</p>
            </div>
            {workspaceId ? (
                <div className="analytics-controls">
                    <div className="segmented" role="tablist" aria-label="Period">
                        {PERIODS.map((p) => (
                            <button key={p.id} className={period === p.id ? 'is-active' : ''} onClick={() => setPeriod(p.id)} disabled={loading}>
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={fetchAnalytics} disabled={loading} aria-label="Refresh">
                        <RefreshCw size={15} className={loading ? 'spin' : ''} />
                    </button>
                </div>
            ) : null}
        </header>
    );

    if (!workspaceId) {
        return (
            <div className="analytics-dashboard">
                {header}
                <section className="surface analytics-empty">
                    <BarChart3 size={26} />
                    {workspaceLoading ? (
                        <p>Loading your workspace…</p>
                    ) : (
                        <>
                            <h3>No workspace selected</h3>
                            <p>Create or select a workspace to see its analytics.</p>
                        </>
                    )}
                </section>
            </div>
        );
    }

    return (
        <div className="analytics-dashboard">
            {header}

            {error ? (
                <div className="error-banner" role="alert">
                    <span>{error}</span>
                    <button className="btn btn-ghost btn-sm analytics-retry" onClick={fetchAnalytics} disabled={loading}>
                        Retry
                    </button>
                </div>
            ) : null}

            {loading && !data ? <p className="muted">Loading analytics…</p> : null}

            {data && data.connectedCount === 0 ? (
                <section className="surface analytics-empty">
                    <BarChart3 size={26} />
                    <h3>No accounts connected</h3>
                    <p>Connect a social account and its reach, engagement and top posts show up here.</p>
                    <div className="analytics-empty__actions">
                        <Link to="/dashboard/connections" className="btn btn-primary btn-sm">
                            <Link2 size={14} /> Connect an account
                        </Link>
                    </div>
                </section>
            ) : null}

            {data && data.connectedCount > 0 && s ? (
                <>
                    {unavailable.length ? (
                        <section className="surface analytics-unavailable" aria-label="Accounts that couldn't load">
                            <h3>
                                <AlertCircle size={16} /> {unavailable.length === 1 ? "1 account couldn't load" : `${unavailable.length} accounts couldn't load`}
                            </h3>
                            <ul>
                                {unavailable.map((p) => (
                                    <li key={p.platform}>
                                        <span className="analytics-platforms__name">
                                            <i style={{ background: PLATFORM_COLORS[p.platform] || 'var(--accent-primary)' }} />
                                            {p.platform}
                                        </span>
                                        <span>{p.error || 'Could not load this account.'}</span>
                                    </li>
                                ))}
                            </ul>
                            <Link to="/dashboard/connections" className="btn btn-secondary btn-sm">Manage connections</Link>
                        </section>
                    ) : null}

                    {okPlatforms.length ? (
                        <>
                            <section className="analytics-stats">
                                <div>
                                    <span>Reach / views</span>
                                    <strong>{fmtOrDash(s.totalReach)}</strong>
                                </div>
                                <div>
                                    <span>Impressions</span>
                                    <strong>{fmtOrDash(s.totalImpressions)}</strong>
                                </div>
                                <div>
                                    <span>Engagement rate</span>
                                    <strong>{pct(s.avgEngagementRate)}</strong>
                                </div>
                                <div>
                                    <span>New followers</span>
                                    <strong>{signed(s.totalFollowerGrowth)}</strong>
                                </div>
                            </section>

                            <div className="analytics-grid">
                                <section className="surface analytics-card">
                                    <h3>Reach over time</h3>
                                    {data.growthChart.length && series.length ? (
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
                                        <p className="muted analytics-card__empty">
                                            None of your connected platforms reported day-by-day reach for this period.
                                        </p>
                                    )}
                                </section>

                                <section className="surface analytics-card">
                                    <h3>By platform</h3>
                                    <ul className="analytics-platforms">
                                        {okPlatforms.map((p) => (
                                            <li key={p.platform}>
                                                <div className="analytics-platforms__row">
                                                    <span className="analytics-platforms__name">
                                                        <i style={{ background: PLATFORM_COLORS[p.platform] || 'var(--accent-primary)' }} />
                                                        {p.platform}
                                                    </span>
                                                    <span>{p.reach !== null ? `${fmt(p.reach)} reach` : p.impressions !== null ? `${fmt(p.impressions)} impressions` : 'Reach not reported'}</span>
                                                </div>
                                                {p.reach !== null ? (
                                                    <div className="analytics-platforms__bar">
                                                        <div style={{ width: `${Math.round((p.reach / totalReach) * 100)}%`, background: PLATFORM_COLORS[p.platform] || 'var(--accent-primary)' }} />
                                                    </div>
                                                ) : null}
                                                <small>
                                                    {pct(p.engagementRate)} engagement · {signed(p.followerGrowth)} new followers
                                                    {p.followers !== null ? ` · ${fmt(p.followers)} followers` : ''}
                                                </small>
                                            </li>
                                        ))}
                                    </ul>
                                </section>

                                <section className="surface analytics-card">
                                    <div className="analytics-card__head">
                                        <h3>Top posts</h3>
                                        {topPosts.length ? (
                                            <button className="btn btn-ghost btn-sm" onClick={exportTopPosts}>
                                                <Download size={14} /> CSV
                                            </button>
                                        ) : null}
                                    </div>
                                    {topPosts.length ? (
                                        <ol className="analytics-posts">
                                            {topPosts.map((post, i) => (
                                                <li key={post.id || i}>
                                                    {post.thumbnail ? <img src={post.thumbnail} alt="" /> : <span className="analytics-posts__thumb" />}
                                                    <div className="analytics-posts__info">
                                                        <p>{post.caption || 'Untitled post'}</p>
                                                        <small>
                                                            <span className="analytics-posts__platform">{post.platform}</span>
                                                            {post.views !== null ? <span>{fmt(post.views)} views</span> : null}
                                                            {post.likes !== null ? <span>{fmt(post.likes)} likes</span> : null}
                                                            {post.comments !== null ? <span>{fmt(post.comments)} comments</span> : null}
                                                        </small>
                                                    </div>
                                                    {post.url ? (
                                                        <a className="btn-icon btn-sm" href={post.url} target="_blank" rel="noreferrer" aria-label="Open post">
                                                            <ExternalLink size={14} />
                                                        </a>
                                                    ) : null}
                                                </li>
                                            ))}
                                        </ol>
                                    ) : (
                                        <p className="muted analytics-card__empty">
                                            No posts published in this period on a platform that shares post stats (YouTube, Instagram).
                                        </p>
                                    )}
                                </section>

                                <section className="surface analytics-card">
                                    <h3>Best hours to post</h3>
                                    {best?.status === 'ok' && best.slots.length ? (
                                        <>
                                            <ol className="analytics-hours">
                                                {best.slots.map((h) => (
                                                    <li key={h.hour}>
                                                        <strong>{String(h.hour).padStart(2, '0')}:00</strong>
                                                        <span>
                                                            {fmt(h.avgEngagement)} average interactions across {h.posts} post{h.posts === 1 ? '' : 's'}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ol>
                                            <p className="muted analytics-card__empty">
                                                Based on your last {best.postsAnalysed} posts. Times are South African time (SAST).
                                            </p>
                                        </>
                                    ) : (
                                        <p className="muted analytics-card__empty">
                                            Needs at least {best?.minPosts ?? 5} recent posts with likes or comments on YouTube or Instagram
                                            {best ? ` (found ${best.postsAnalysed})` : ''}.
                                        </p>
                                    )}
                                </section>
                            </div>
                        </>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}
