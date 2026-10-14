import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Calendar, Check, Film, Link2, Repeat2, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { apiClient } from '../lib/api';
import { clipsApi } from '../lib/clips-api';
import './Dashboard.css';

/**
 * Home: the next useful thing for a creator or agency. Turn a long video into clips,
 * see what is going out this week, pick up recent clip projects, finish setup.
 */

function greeting() {
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function toDate(value) {
    if (!value) return null;
    const d = value._seconds ? new Date(value._seconds * 1000) : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function formatWhen(date) {
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (date.toDateString() === today.toDateString()) return `Today ${time}`;
    if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
    return `${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

export default function DashboardPage() {
    const { profile } = useAuth();
    const { currentWorkspace } = useWorkspace();
    const navigate = useNavigate();
    const [stats, setStats] = useState(null);
    const [connections, setConnections] = useState([]);
    const [upcoming, setUpcoming] = useState(null);
    const [projects, setProjects] = useState(null);
    const [loading, setLoading] = useState(true);
    const [dragging, setDragging] = useState(false);
    const fileRef = useRef(null);

    useEffect(() => {
        if (!currentWorkspace?.id) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            const now = new Date();
            const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
            const [analytics, scheduler, connectionsRes, calendar, clips] = await Promise.allSettled([
                apiClient(`/analytics/${currentWorkspace.id}?period=30d`),
                apiClient(`/scheduler/stats/${currentWorkspace.id}`),
                apiClient(`/workspaces/${currentWorkspace.id}/connections`),
                apiClient(`/schedule/calendar?start=${now.toISOString()}&end=${weekAhead.toISOString()}`),
                clipsApi.list(),
            ]);
            if (cancelled) return;
            const overview = analytics.status === 'fulfilled' ? analytics.value.overview || {} : {};
            const sched = scheduler.status === 'fulfilled' ? scheduler.value.stats || {} : {};
            setStats({ totalPosts: overview.totalPosts || 0, scheduled: sched.scheduled || 0, engagementRate: overview.engagementRate || 0 });
            setConnections(connectionsRes.status === 'fulfilled' ? connectionsRes.value.connections || [] : []);
            setUpcoming(
                calendar.status === 'fulfilled'
                    ? (calendar.value.posts || [])
                          .map((p) => ({ ...p, when: toDate(p.scheduledAt) }))
                          .filter((p) => p.when && p.when >= now && p.status !== 'draft')
                          .sort((a, b) => a.when - b.when)
                          .slice(0, 5)
                    : []
            );
            setProjects(clips.status === 'fulfilled' ? (clips.value.projects || []).slice(0, 4) : []);
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [currentWorkspace?.id]);

    const startClips = (file) => {
        if (file) navigate('/dashboard/clips', { state: { file } });
    };

    const activeAccounts = connections.filter((c) => c.status === 'active');
    const setupSteps = [
        { label: 'Connect a social account', detail: 'So posts publish for you.', done: activeAccounts.length > 0, action: '/dashboard/connections' },
        { label: 'Cut your first clips', detail: 'Upload a long video in Clips.', done: (projects || []).length > 0, action: '/dashboard/clips' },
        { label: 'Schedule a post', detail: 'Put something on the calendar.', done: Boolean(stats?.scheduled) || (upcoming || []).length > 0, action: '/dashboard/scheduler' },
    ];
    const doneCount = setupSteps.filter((s) => s.done).length;
    const hasStats = stats && (stats.totalPosts > 0 || stats.engagementRate > 0);
    const firstName = (profile?.displayName || '').split(' ')[0];

    return (
        <div className="home">
            <header className="page-head">
                <div>
                    <h1>
                        {greeting()}
                        {firstName ? `, ${firstName}` : ''}
                    </h1>
                    <p>{currentWorkspace?.name || 'Your workspace'}</p>
                </div>
                <div className="home__head-actions">
                    <Link to="/dashboard/repurpose" className="btn btn-secondary">
                        <Repeat2 size={15} /> Repurpose
                    </Link>
                    <Link to="/dashboard/scheduler" className="btn btn-secondary">
                        <Calendar size={15} /> Calendar
                    </Link>
                </div>
            </header>

            <section
                className={`home-drop ${dragging ? 'is-dragging' : ''}`}
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    startClips(e.dataTransfer.files?.[0]);
                }}
            >
                <div className="home-drop__text">
                    <h2>Turn one long video into a week of posts</h2>
                    <p>Drop a podcast, interview, webinar or talk. Clips finds the strongest moments, reframes them for TikTok, Reels and Shorts, adds captions and writes the post copy.</p>
                </div>
                <div className="home-drop__action">
                    <input ref={fileRef} type="file" accept="video/*" hidden onChange={(e) => startClips(e.target.files?.[0])} />
                    <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
                        <Upload size={16} /> Choose a video
                    </button>
                    <small>or drop it here</small>
                </div>
            </section>

            {!loading && doneCount < setupSteps.length ? (
                <section className="home-setup">
                    <span className="home-setup__progress">
                        Setup {doneCount}/{setupSteps.length}
                    </span>
                    {setupSteps.map((step) => (
                        <button key={step.label} className={`home-setup__step ${step.done ? 'is-done' : ''}`} onClick={() => navigate(step.action)} disabled={step.done}>
                            <span className="home-setup__check">{step.done ? <Check size={12} /> : null}</span>
                            <span>
                                <strong>{step.label}</strong>
                                <small>{step.detail}</small>
                            </span>
                        </button>
                    ))}
                </section>
            ) : null}

            <div className="home-grid">
                <section className="surface home-panel">
                    <div className="home-panel__head">
                        <h2>Going out this week</h2>
                        <Link to="/dashboard/scheduler" className="home-link">
                            Calendar <ArrowRight size={14} />
                        </Link>
                    </div>
                    {upcoming === null ? <p className="muted">Loading…</p> : null}
                    {upcoming?.length === 0 ? (
                        <div className="home-panel__empty">
                            <p>Nothing scheduled for the next seven days.</p>
                            <div>
                                <Link to="/dashboard/repurpose" className="btn btn-secondary btn-sm">
                                    Write posts from a link
                                </Link>
                                <Link to="/dashboard/scheduler" className="btn btn-ghost btn-sm">
                                    Schedule a post
                                </Link>
                            </div>
                        </div>
                    ) : null}
                    {upcoming?.length ? (
                        <ul className="home-upcoming">
                            {upcoming.map((post) => (
                                <li key={post.id || post.postId}>
                                    <time>{formatWhen(post.when)}</time>
                                    <span className="home-upcoming__platforms">{(post.platforms || []).join(', ')}</span>
                                    <p>{post.caption || 'No caption'}</p>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </section>

                <section className="surface home-panel">
                    <div className="home-panel__head">
                        <h2>Recent clips</h2>
                        <Link to="/dashboard/clips" className="home-link">
                            All clips <ArrowRight size={14} />
                        </Link>
                    </div>
                    {projects === null ? <p className="muted">Loading…</p> : null}
                    {projects?.length === 0 ? (
                        <div className="home-panel__empty">
                            <p>Your clip projects show up here, ranked by their best clip.</p>
                        </div>
                    ) : null}
                    {projects?.length ? (
                        <ul className="home-clips">
                            {projects.map((p) => (
                                <li key={p.id}>
                                    <Link to={`/dashboard/clips?project=${p.id}`}>
                                        <span className="home-clips__thumb">{p.poster ? <img src={p.poster} alt="" /> : <Film size={16} />}</span>
                                        <span className="home-clips__meta">
                                            <strong>{p.sourceName}</strong>
                                            <small>{p.status === 'processing' ? `${p.stage || 'Processing'}…` : p.status === 'failed' ? 'Failed' : `${p.clipCount} clip${p.clipCount === 1 ? '' : 's'}`}</small>
                                        </span>
                                        {p.topScore ? <span className="home-clips__score">{p.topScore}</span> : null}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </section>
            </div>

            <section className="home-footer">
                <div className="home-accounts">
                    {activeAccounts.length ? (
                        <>
                            <span className="muted">Publishing to</span>
                            {activeAccounts.map((c) => (
                                <span key={c.id} className="home-accounts__pill">
                                    <span className="status-dot active" />
                                    {c.platform}
                                    {c.username ? <span className="muted">@{c.username}</span> : null}
                                </span>
                            ))}
                            <Link to="/dashboard/connections" className="home-link">
                                Manage
                            </Link>
                        </>
                    ) : (
                        <>
                            <span className="muted">No accounts connected yet.</span>
                            <Link to="/dashboard/connections" className="home-link">
                                <Link2 size={14} /> Connect TikTok, Instagram, YouTube or LinkedIn
                            </Link>
                        </>
                    )}
                </div>
                {hasStats ? (
                    <div className="home-stats">
                        <span>
                            <strong>{stats.totalPosts}</strong> posts published
                        </span>
                        <span>
                            <strong>{stats.scheduled}</strong> scheduled
                        </span>
                        {stats.engagementRate ? (
                            <span>
                                <strong>{stats.engagementRate}%</strong> engagement, 30 days
                            </span>
                        ) : null}
                        <Link to="/dashboard/analytics" className="home-link">
                            Analytics <ArrowRight size={14} />
                        </Link>
                    </div>
                ) : null}
            </section>
        </div>
    );
}
