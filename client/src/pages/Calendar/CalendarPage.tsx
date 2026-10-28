import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    ChevronLeft,
    ChevronRight,
    Plus,
    Smartphone,
    Instagram,
    Youtube,
    Facebook,
    Image as ImageIcon,
    Video,
    Clock,
    Sparkles,
    Trash2,
    X,
    Camera,
    Upload,
    Check,
    Loader2,
    Send,
    Save,
    AlertTriangle,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useAuth } from '../../context/AuthContext';
import { apiClient } from '../../lib/api';
import './Calendar.css';
import { TikTokConsent, TikTokPostSettings, tiktokProblem, useTikTokCreatorInfo, useVideoSeconds, YouTubePostSettings, youtubeProblem, type TikTokOptions, type YouTubeOptions } from './PlatformPostSettings';
import { confirmDialog } from '../../lib/dialogs';

type PostStatus = 'pending' | 'published' | 'failed' | 'partial' | 'draft' | 'cancelled';

interface ScheduledPost {
    id: string;
    postId: string;
    status: PostStatus;
    platforms: string[];
    mediaUrl: string;
    caption: string;
    scheduledAt: string;
    platformOptions: any;
    thumbnailUrl?: string;
}

interface Notice {
    tone: 'success' | 'warning' | 'error';
    text: string;
}

const PLATFORMS = [
    { id: 'youtube', name: 'YouTube', icon: Youtube, color: '#FF0000', limit: 5000 },
    { id: 'instagram', name: 'Instagram', icon: Instagram, color: '#E4405F', limit: 2200 },
    { id: 'tiktok', name: 'TikTok', icon: Smartphone, color: 'var(--text-primary)', limit: 4000 },
    { id: 'facebook', name: 'Facebook', icon: Facebook, color: '#1877F2', limit: 63206 },
];

const STATUS_LABELS: Record<string, { label: string; badge: string }> = {
    pending: { label: 'Scheduled', badge: 'badge-info' },
    draft: { label: 'Draft', badge: '' },
    published: { label: 'Published', badge: 'badge-success' },
    partial: { label: 'Partly published', badge: 'badge-warning' },
    failed: { label: 'Failed', badge: 'badge-error' },
};

// Matches the multer cap on POST /workspaces/:id/media/upload (server/src/routes/media.routes.js).
const MAX_UPLOAD_MB = 250;
const SUGGESTED_TIMES = ['09:00', '12:30', '18:00', '21:00'];

const QUEUE_WARNING =
    'Saved, but auto-publishing is offline right now (the publish queue is unreachable). It will not go out automatically until the queue is back.';

// Local yyyy-mm-dd (toISOString() would shift the date in timezones ahead of / behind UTC).
function toLocalDateInput(d: Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toLocalTimeInput(d: Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function combineLocal(date: string, time: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
    const d = new Date(`${date}T${time}`);
    return Number.isNaN(d.getTime()) ? null : d;
}

function isImageUrl(url?: string) {
    return !!url && /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i.test(url);
}

function friendlyError(err: unknown, fallback: string) {
    // apiClient puts the server's code on error.code and a sentence in error.message; check both.
    const msg = `${(err as any)?.code || ''} ${(err as Error)?.message || ''} ${(err as any)?.status === 413 ? '413' : ''}`;
    if (/FEATURE_LOCKED/.test(msg)) return 'This feature is not included in your plan. Upgrade in Billing to use it.';
    if (/PLAN_LIMIT_EXCEEDED/.test(msg)) return 'You have reached this month\'s limit for your plan. Upgrade in Billing for more.';
    if (/INVALID_SCHEDULED_AT/.test(msg)) return 'Pick a valid publish date and time.';
    if (/PLATFORMS_REQUIRED/.test(msg)) return 'Pick at least one platform.';
    if (/413/.test(msg)) return `That file is larger than the ${MAX_UPLOAD_MB}MB upload limit.`;
    return msg ? `${fallback} (${msg})` : fallback;
}

function PostThumb({ post, size = 'sm' }: { post: ScheduledPost; size?: 'sm' | 'md' }) {
    const src = post.thumbnailUrl || (isImageUrl(post.mediaUrl) ? post.mediaUrl : '');
    const cls = size === 'sm' ? 'post-thumb' : 'post-thumb post-thumb--md';
    if (src) return <img src={src} className={cls} alt="" />;
    return (
        <div className={`${cls} cal-thumb-placeholder`} aria-hidden="true">
            {post.mediaUrl ? <Video size={size === 'sm' ? 14 : 20} /> : <ImageIcon size={size === 'sm' ? 14 : 20} />}
        </div>
    );
}

function PlatformIcon({ id, size }: { id: string; size: number }) {
    const Icon = PLATFORMS.find(p => p.id === id)?.icon;
    return Icon ? <Icon size={size} /> : null;
}

export default function CalendarPage() {
    const { currentWorkspace } = useWorkspace() as any;
    const { plan } = useAuth() as any;

    // ── CALENDAR STATE ──
    const [view, setView] = useState<'month' | 'list'>('month');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [posts, setPosts] = useState<ScheduledPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [filterPlatform, setFilterPlatform] = useState('all');
    const [notice, setNotice] = useState<Notice | null>(null);
    const [connectedPlatforms, setConnectedPlatforms] = useState<string[] | null>(null);

    // ── CREATE MODAL STATE ──
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalStep, setModalStep] = useState(1);

    // ── FORM STATE ──
    const [mediaFile, setMediaFile] = useState<File | null>(null);
    const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
    const [captions, setCaptions] = useState<Record<string, string>>({});
    // Per-platform post settings chosen by the person (TikTok and YouTube have no defaults).
    const [tiktokOptions, setTiktokOptions] = useState<TikTokOptions>({});
    const [youtubeOptions, setYoutubeOptions] = useState<YouTubeOptions>({});
    const [activeTab, setActiveTab] = useState('instagram');
    const [scheduledAt, setScheduledAt] = useState('');
    const [scheduledTime, setScheduledTime] = useState('12:00');
    const [status, setStatus] = useState<'pending' | 'draft'>('pending');
    const [formError, setFormError] = useState('');
    const [submitStage, setSubmitStage] = useState<'' | 'uploading' | 'saving'>('');
    const [aiBusy, setAiBusy] = useState(false);
    const [aiMessage, setAiMessage] = useState('');

    // ── DETAIL PANEL STATE ──
    const [detail, setDetail] = useState<{ day: Date; postId: string | null } | null>(null);
    const [editDate, setEditDate] = useState('');
    const [editTime, setEditTime] = useState('');
    const [editCaption, setEditCaption] = useState('');
    const [detailBusy, setDetailBusy] = useState('');
    const [detailError, setDetailError] = useState('');

    const openCreate = (day?: Date) => {
        setScheduledAt(toLocalDateInput(day || new Date()));
        setFormError('');
        setModalStep(1);
        setIsModalOpen(true);
    };

    // ── HANDOFF FROM OTHER PAGES (e.g. Clips → Schedule) ──
    const location = useLocation();
    const navigate = useNavigate();
    useEffect(() => {
        const state = location.state as { mediaFile?: File; caption?: string; platforms?: string[] } | null;
        if (!state?.mediaFile && !state?.caption) return;
        if (state.mediaFile) setMediaFile(state.mediaFile);
        const known = (state.platforms || []).filter((id) => PLATFORMS.some((p) => p.id === id));
        if (known.length) setSelectedPlatforms(known);
        if (state.caption) setCaptions(Object.fromEntries(PLATFORMS.map((p) => [p.id, state.caption as string])));
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        setScheduledAt(toLocalDateInput(tomorrow));
        // With a video go straight to platforms; with only a caption, start at the media step.
        setModalStep(state.mediaFile ? 2 : 1);
        setIsModalOpen(true);
        // Clear the state so a refresh does not reopen the dialog.
        navigate(location.pathname, { replace: true, state: null });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── LOAD DATA ──
    const fetchSeq = useRef(0);
    const fetchPosts = useCallback(async () => {
        if (!currentWorkspace?.id) return;
        const seq = ++fetchSeq.current;
        try {
            setLoading(true);
            setLoadError('');
            // Whole month: from the 1st to the start of the next month.
            const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).toISOString();
            const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1).toISOString();
            const data = await apiClient(`/schedule/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
            if (seq !== fetchSeq.current) return;
            setPosts((data.posts || []).filter((p: ScheduledPost) => p.status !== 'cancelled' && p.scheduledAt));
        } catch (err) {
            if (seq !== fetchSeq.current) return;
            setLoadError(friendlyError(err, 'Could not load scheduled posts.'));
        } finally {
            if (seq === fetchSeq.current) setLoading(false);
        }
    }, [currentWorkspace?.id, currentDate]);

    useEffect(() => {
        fetchPosts();
    }, [fetchPosts]);

    useEffect(() => {
        if (!currentWorkspace?.id) return;
        let cancelled = false;
        apiClient(`/workspaces/${currentWorkspace.id}/connections`)
            .then((data: any) => {
                if (cancelled) return;
                const ids = (data.connections || []).map((c: any) => c.platform).filter(Boolean);
                setConnectedPlatforms(Array.from(new Set(ids)) as string[]);
            })
            .catch(() => { if (!cancelled) setConnectedPlatforms([]); });
        return () => { cancelled = true; };
    }, [currentWorkspace?.id]);

    const availablePlatforms = useMemo(
        () => PLATFORMS.filter(p => (connectedPlatforms || []).includes(p.id)),
        [connectedPlatforms]
    );

    // ── DATE CALCULATIONS ──
    const daysInMonth = useMemo(() => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const days = new Date(year, month + 1, 0).getDate();
        const firstDay = new Date(year, month, 1).getDay(); // 0 is Sun

        // Start from Monday
        const offset = firstDay === 0 ? 6 : firstDay - 1;

        const arr = [];
        const prevMonthLastDay = new Date(year, month, 0).getDate();
        for (let i = offset - 1; i >= 0; i--) {
            arr.push({ day: prevMonthLastDay - i, month: 'prev', date: new Date(year, month - 1, prevMonthLastDay - i) });
        }
        for (let i = 1; i <= days; i++) {
            arr.push({ day: i, month: 'current', date: new Date(year, month, i) });
        }
        const remaining = 42 - arr.length;
        for (let i = 1; i <= remaining; i++) {
            arr.push({ day: i, month: 'next', date: new Date(year, month + 1, i) });
        }
        return arr;
    }, [currentDate]);

    const changeMonth = (offset: number) => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1));
    };

    // ── MOBILE WEEK STRIP ──
    const [mobileDay, setMobileDay] = useState(() => new Date());
    const mobileWeek = useMemo(() => {
        const monday = new Date(mobileDay.getFullYear(), mobileDay.getMonth(), mobileDay.getDate() - ((mobileDay.getDay() + 6) % 7));
        return Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
    }, [mobileDay]);
    const selectMobileDay = (day: Date) => {
        setMobileDay(day);
        // Posts are loaded per month, so follow the selected day across month boundaries.
        if (day.getMonth() !== currentDate.getMonth() || day.getFullYear() !== currentDate.getFullYear()) {
            setCurrentDate(new Date(day.getFullYear(), day.getMonth(), 1));
        }
    };

    // ── CREATE HANDLERS ──
    const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
            setFormError(`That file is ${Math.round(file.size / (1024 * 1024))}MB. The upload limit is ${MAX_UPLOAD_MB}MB.`);
            return;
        }

        setFormError('');
        setMediaFile(file);
        setModalStep(2);
    };

    const resetForm = () => {
        setModalStep(1);
        setMediaFile(null);
        setSelectedPlatforms([]);
        setCaptions({});
        setTiktokOptions({});
        setYoutubeOptions({});
        setStatus('pending');
        setScheduledTime('12:00');
        setFormError('');
        setAiMessage('');
    };

    const tiktokInfo = useTikTokCreatorInfo(isModalOpen && selectedPlatforms.includes('tiktok'));
    const videoSeconds = useVideoSeconds(mediaFile);
    /** What still blocks scheduling (drafts may be saved without the platform settings). */
    const platformSettingsProblem = (forStatus: string) => {
        if (forStatus === 'draft') return '';
        if (selectedPlatforms.includes('tiktok')) {
            const problem = tiktokProblem(tiktokOptions, tiktokInfo, videoSeconds);
            if (problem) return problem;
        }
        if (selectedPlatforms.includes('youtube')) {
            const problem = youtubeProblem(youtubeOptions);
            if (problem) return problem;
        }
        return '';
    };

    const closeModal = () => {
        if (submitStage) return;
        setIsModalOpen(false);
        resetForm();
    };

    const handleCreatePost = async () => {
        setFormError('');
        const when = combineLocal(scheduledAt, scheduledTime);
        if (!when) {
            setFormError('Pick a publish date and time.');
            return;
        }
        if (status === 'pending' && when.getTime() < Date.now() - 60_000) {
            setFormError('That time has already passed. Pick a time in the future.');
            return;
        }
        if (selectedPlatforms.length === 0) {
            setFormError('Pick at least one platform.');
            return;
        }
        const settingsProblem = platformSettingsProblem(status);
        if (settingsProblem) {
            setFormError(settingsProblem);
            return;
        }

        try {
            // 1. Upload the media to durable storage. Platforms fetch it from this URL when the post goes out.
            let mediaUrl = '';
            if (mediaFile) {
                setSubmitStage('uploading');
                const formData = new FormData();
                formData.append('file', mediaFile);
                const uploadRes = await apiClient(`/workspaces/${currentWorkspace.id}/media/upload`, {
                    method: 'POST',
                    body: formData
                });
                mediaUrl = uploadRes.url;
            }

            // 2. Create the post (drafts are stored but never queued).
            setSubmitStage('saving');
            const firstCaption = captions[selectedPlatforms[0]] || Object.values(captions).find(Boolean) || '';
            const payload = {
                platforms: selectedPlatforms,
                mediaUrl,
                caption: firstCaption,
                scheduledAt: when.toISOString(),
                platformOptions: selectedPlatforms.reduce((acc, p) => ({
                    ...acc,
                    [p]: {
                        caption: captions[p] ?? firstCaption,
                        ...(p === 'tiktok' ? { title: captions.tiktok ?? firstCaption, ...tiktokOptions } : {}),
                        ...(p === 'youtube' ? youtubeOptions : {}),
                    },
                }), {}),
                status
            };

            const res = await apiClient('/schedule/create', { method: 'POST', body: JSON.stringify(payload) });

            setIsModalOpen(false);
            resetForm();
            if (res?.warning === 'QUEUE_UNAVAILABLE') {
                setNotice({ tone: 'warning', text: QUEUE_WARNING });
            } else {
                setNotice({ tone: 'success', text: status === 'draft' ? 'Draft saved to the calendar.' : 'Post scheduled.' });
            }
            fetchPosts();
        } catch (err) {
            setFormError(friendlyError(err, 'Scheduling failed.'));
        } finally {
            setSubmitStage('');
        }
    };

    const handleAIGenerate = async (platform: string) => {
        setAiMessage('');
        if (!plan || plan === 'starter') {
            setAiMessage('AI captions are available on Nano and above. Upgrade in Billing to use them.');
            return;
        }
        const context = (captions[platform] || Object.values(captions).find(Boolean) || '').trim()
            || (mediaFile ? `A short social video post (file: ${mediaFile.name}).` : 'A short social media post.');
        setAiBusy(true);
        try {
            const res = await apiClient('/ai/generate-captions', {
                method: 'POST',
                body: JSON.stringify({ transcript: context, platforms: [platform], stream: false })
            });
            const caption = res?.captions?.[platform];
            if (!caption) {
                setAiMessage('The AI did not return a caption. Try again, or write a few words first for it to work from.');
                return;
            }
            setCaptions(prev => ({ ...prev, [platform]: caption }));
        } catch (err) {
            setAiMessage(friendlyError(err, 'Could not generate a caption.'));
        } finally {
            setAiBusy(false);
        }
    };

    // ── DETAIL PANEL ──
    const detailPost = detail?.postId ? posts.find(p => p.id === detail.postId) || null : null;

    const openPost = (post: ScheduledPost) => {
        const d = new Date(post.scheduledAt);
        setDetail({ day: d, postId: post.id });
        setEditDate(toLocalDateInput(d));
        setEditTime(toLocalTimeInput(d));
        setEditCaption(post.caption || '');
        setDetailError('');
    };

    const openDay = (day: Date) => {
        setDetail({ day, postId: null });
        setDetailError('');
    };

    const closeDetail = () => {
        if (detailBusy) return;
        setDetail(null);
    };

    const runDetailAction = async (action: string, fn: () => Promise<any>, successText: string) => {
        setDetailBusy(action);
        setDetailError('');
        try {
            const res = await fn();
            setNotice(res?.warning === 'QUEUE_UNAVAILABLE' ? { tone: 'warning', text: QUEUE_WARNING } : { tone: 'success', text: successText });
            setDetail(null);
            fetchPosts();
        } catch (err) {
            setDetailError(friendlyError(err, 'That did not work.'));
        } finally {
            setDetailBusy('');
        }
    };

    const savePostChanges = (post: ScheduledPost, makeScheduled = false) => {
        const when = combineLocal(editDate, editTime);
        if (!when) {
            setDetailError('Pick a valid date and time.');
            return;
        }
        if ((post.status === 'pending' || makeScheduled) && when.getTime() < Date.now() - 60_000) {
            setDetailError('That time has already passed. Pick a time in the future, or use Publish now.');
            return;
        }
        // Per-platform captions override the main caption when publishing, so keep them in sync.
        const platformOptions = { ...(post.platformOptions || {}) };
        post.platforms.forEach(p => { platformOptions[p] = { ...(platformOptions[p] || {}), caption: editCaption }; });
        runDetailAction(
            makeScheduled ? 'schedule' : 'save',
            () => apiClient(`/schedule/${post.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    scheduledAt: when.toISOString(),
                    caption: editCaption,
                    platformOptions,
                    ...(makeScheduled ? { status: 'pending' } : {}),
                })
            }),
            makeScheduled ? 'Draft scheduled.' : 'Post updated.'
        );
    };

    const publishNow = async (post: ScheduledPost) => {
        if (!(await confirmDialog('Publish this post to all its platforms now?', { confirmLabel: 'Publish now' }))) return;
        runDetailAction('publish', () => apiClient(`/schedule/publish-now/${post.id}`, { method: 'POST' }), 'Publishing started.');
    };

    const cancelPost = async (post: ScheduledPost) => {
        const draft = post.status === 'draft';
        if (!(await confirmDialog(draft ? 'Delete this draft?' : 'Cancel this scheduled post? It will not be published.', { confirmLabel: draft ? 'Delete draft' : 'Cancel post', cancelLabel: 'Keep it', danger: true }))) return;
        runDetailAction('cancel', () => apiClient(`/schedule/${post.id}`, { method: 'DELETE' }), post.status === 'draft' ? 'Draft deleted.' : 'Post cancelled.');
    };

    // ── RENDER HELPERS ──
    const visiblePosts = useMemo(
        () => posts
            .filter(p => filterPlatform === 'all' || (p.platforms || []).includes(filterPlatform))
            .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()),
        [posts, filterPlatform]
    );

    const getPostsForDay = (date: Date) => visiblePosts.filter(p => {
        const d = new Date(p.scheduledAt);
        return d.getDate() === date.getDate() && d.getMonth() === date.getMonth() && d.getFullYear() === date.getFullYear();
    });

    const statusBadge = (s: string) => {
        const meta = STATUS_LABELS[s] || { label: s, badge: '' };
        return <span className={`badge ${meta.badge}`}>{meta.label}</span>;
    };

    const formatTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    const renderPostRow = (post: ScheduledPost, showDate = false) => (
        <button key={post.id} type="button" className="cal-post-row" onClick={() => openPost(post)}>
            <PostThumb post={post} size="md" />
            <div className="cal-post-row__body">
                <div className="cal-post-row__meta">
                    <span className="cal-text-secondary">
                        {showDate ? new Date(post.scheduledAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' : ''}
                        {formatTime(post.scheduledAt)}
                    </span>
                    {statusBadge(post.status)}
                </div>
                <p className="cal-post-row__caption">{post.caption || <em className="cal-text-muted">No caption</em>}</p>
                <div className="cal-post-row__platforms">
                    {(post.platforms || []).map(p => (
                        <span key={p} className="cal-chip"><PlatformIcon id={p} size={12} /> {PLATFORMS.find(x => x.id === p)?.name || p}</span>
                    ))}
                </div>
            </div>
        </button>
    );

    const isSubmitting = submitStage !== '';
    const editable = detailPost && ['pending', 'draft', 'failed'].includes(detailPost.status);

    return (
        <div className="calendar-page">
            {/* ── HEADER ── */}
            <div className="calendar-header">
                <div className="calendar-header__title">
                    <h1>Calendar</h1>
                    <p className="cal-text-secondary">Plan the month and schedule posts to your connected accounts.</p>
                </div>

                <div className="calendar-header__actions">
                    <div className="calendar-nav-controls">
                        <button className="cal-icon-btn" onClick={() => changeMonth(-1)} aria-label="Previous month"><ChevronLeft size={20} /></button>
                        <h2>{currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
                        <button className="cal-icon-btn" onClick={() => changeMonth(1)} aria-label="Next month"><ChevronRight size={20} /></button>
                        <button className="cal-accent-text cal-today-btn" onClick={() => setCurrentDate(new Date())}>Today</button>
                    </div>

                    <div className="view-toggle">
                        <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>Month</button>
                        <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>List</button>
                    </div>

                    <button className="btn btn-primary" onClick={() => openCreate()}>
                        <Plus size={18} /> New Post
                    </button>
                </div>
            </div>

            {notice && (
                <div className={`cal-notice cal-notice--${notice.tone}`} role="status">
                    {notice.tone === 'warning' ? <AlertTriangle size={16} /> : notice.tone === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
                    <span>{notice.text}</span>
                    <button className="cal-icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={14} /></button>
                </div>
            )}
            {loadError && <div className="error-banner" role="alert">{loadError}</div>}

            {/* ── FILTERS ── */}
            <div className="platform-filters">
                <button className={`filter-chip ${filterPlatform === 'all' ? 'active' : ''}`} onClick={() => setFilterPlatform('all')}>All Platforms</button>
                {PLATFORMS.map(p => (
                    <button
                        key={p.id}
                        className={`filter-chip ${filterPlatform === p.id ? 'active' : ''}`}
                        onClick={() => setFilterPlatform(p.id)}
                    >
                        <p.icon size={14} /> {p.name}
                    </button>
                ))}
                {loading && <span className="cal-loading"><Loader2 size={14} className="spin" /> Loading…</span>}
            </div>

            {/* ── MONTH GRID ── */}
            {view === 'month' && (
                <div className="calendar-grid-container">
                    <div className="calendar-grid-header">
                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                            <div key={d} className="grid-header-cell">{d}</div>
                        ))}
                    </div>
                    <div className="calendar-grid-body">
                        {daysInMonth.map((dayObj, i) => {
                            const isToday = dayObj.date.toDateString() === new Date().toDateString();
                            const dayPosts = getPostsForDay(dayObj.date);

                            return (
                                <div key={i} className={`calendar-day-cell ${dayObj.month !== 'current' ? 'other-month' : ''} ${isToday ? 'today' : ''}`}>
                                    <div className="cell-header">
                                        <span className="date-number">{dayObj.day}</span>
                                        <button
                                            type="button"
                                            className="add-post-btn-sm"
                                            aria-label={`New post on ${dayObj.date.toDateString()}`}
                                            onClick={() => openCreate(dayObj.date)}
                                        >
                                            <Plus size={14} />
                                        </button>
                                    </div>
                                    <div className="cell-posts">
                                        {dayPosts.slice(0, 3).map((post) => (
                                            <button type="button" key={post.id} className="post-thumb-wrapper" onClick={() => openPost(post)}>
                                                <div className="post-thumb-holder">
                                                    <PostThumb post={post} />
                                                    <div className="post-platform-badge">
                                                        <PlatformIcon id={post.platforms?.[0]} size={8} />
                                                    </div>
                                                </div>
                                                <span className="post-caption-preview">
                                                    {post.status === 'draft' ? 'Draft · ' : ''}{post.caption || formatTime(post.scheduledAt)}
                                                </span>
                                            </button>
                                        ))}
                                        {dayPosts.length > 3 && (
                                            <button type="button" className="more-posts-chip" onClick={() => openDay(dayObj.date)}>
                                                +{dayPosts.length - 3} more
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── LIST VIEW ── */}
            {view === 'list' && (
                <div className="cal-list-view">
                    {visiblePosts.length === 0 ? (
                        <p className="cal-text-muted cal-empty">
                            {loading ? 'Loading…' : `Nothing scheduled in ${currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}.`}
                        </p>
                    ) : visiblePosts.map(post => renderPostRow(post, true))}
                </div>
            )}

            {/* ── MOBILE VIEW (≤768px only) ── */}
            <div className="cal-mobile">
                <div className="mobile-week-strip">
                    {mobileWeek.map((day) => {
                        const isActive = day.toDateString() === mobileDay.toDateString();
                        const count = getPostsForDay(day).length;
                        return (
                            <button key={day.toISOString()} className={`mobile-day-btn ${isActive ? 'active' : ''}`} onClick={() => selectMobileDay(day)}>
                                <span className="mobile-day-btn__weekday">{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                                <span className="mobile-day-btn__date">{day.getDate()}</span>
                                {count > 0 ? <span className="mobile-day-btn__count">{count}</span> : null}
                            </button>
                        );
                    })}
                </div>
                <div className="cal-mobile__nav">
                    <button className="cal-icon-btn" onClick={() => selectMobileDay(new Date(mobileDay.getTime() - 7 * 86400000))} aria-label="Previous week"><ChevronLeft size={18} /></button>
                    <strong>{mobileDay.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
                    <button className="cal-icon-btn" onClick={() => selectMobileDay(new Date(mobileDay.getTime() + 7 * 86400000))} aria-label="Next week"><ChevronRight size={18} /></button>
                </div>
                <div className="mobile-posts-list">
                    {getPostsForDay(mobileDay).length === 0 ? (
                        <p className="cal-text-muted cal-empty">Nothing scheduled for this day.</p>
                    ) : getPostsForDay(mobileDay).map(post => renderPostRow(post))}
                </div>
                <button
                    className="camera-fab"
                    aria-label="Create a post for this day"
                    onClick={() => openCreate(mobileDay)}
                >
                    <Camera size={24} />
                </button>
            </div>

            {/* ── POST DETAIL / DAY LIST PANEL ── */}
            {detail && (
                <div className="scheduler-modal-overlay" onClick={closeDetail}>
                    <div className="scheduler-modal cal-detail" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
                        <div className="cal-detail__header">
                            {detailPost && getPostsForDay(detail.day).length > 1 ? (
                                <button className="btn btn-ghost btn-sm" onClick={() => setDetail({ day: detail.day, postId: null })} disabled={!!detailBusy}>
                                    <ChevronLeft size={14} /> All posts
                                </button>
                            ) : <span />}
                            <h3>
                                {detailPost
                                    ? new Date(detailPost.scheduledAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                                    : detail.day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                            </h3>
                            <button className="cal-icon-btn" onClick={closeDetail} aria-label="Close"><X size={18} /></button>
                        </div>

                        <div className="cal-detail__body">
                            {!detailPost ? (
                                <div className="cal-list-view">
                                    {getPostsForDay(detail.day).length === 0
                                        ? <p className="cal-text-muted cal-empty">Nothing scheduled for this day.</p>
                                        : getPostsForDay(detail.day).map(post => renderPostRow(post))}
                                </div>
                            ) : (
                                <>
                                    <div className="cal-detail__summary">
                                        <PostThumb post={detailPost} size="md" />
                                        <div>
                                            <div className="cal-post-row__meta">{statusBadge(detailPost.status)}</div>
                                            <div className="cal-post-row__platforms">
                                                {(detailPost.platforms || []).map(p => (
                                                    <span key={p} className="cal-chip"><PlatformIcon id={p} size={12} /> {PLATFORMS.find(x => x.id === p)?.name || p}</span>
                                                ))}
                                            </div>
                                            {detailPost.mediaUrl && (
                                                <a className="cal-media-link" href={detailPost.mediaUrl} target="_blank" rel="noreferrer">Open media</a>
                                            )}
                                        </div>
                                    </div>

                                    {detailError && <div className="error-banner" role="alert">{detailError}</div>}

                                    {editable ? (
                                        <>
                                            <div className="field-row">
                                                <label className="field">
                                                    <span>Date</span>
                                                    <input type="date" className="input" value={editDate} onChange={e => setEditDate(e.target.value)} />
                                                </label>
                                                <label className="field">
                                                    <span>Time</span>
                                                    <input type="time" className="input" value={editTime} onChange={e => setEditTime(e.target.value)} />
                                                </label>
                                            </div>
                                            <label className="field">
                                                <span>Caption <em>(applies to every platform on this post)</em></span>
                                                <textarea className="input" rows={6} value={editCaption} onChange={e => setEditCaption(e.target.value)} />
                                            </label>
                                        </>
                                    ) : (
                                        <p className="cal-detail__caption">{detailPost.caption || <em className="cal-text-muted">No caption</em>}</p>
                                    )}
                                </>
                            )}
                        </div>

                        {detailPost && editable && (
                            <div className="cal-detail__footer">
                                <button className="btn btn-ghost cal-danger-text" onClick={() => cancelPost(detailPost)} disabled={!!detailBusy}>
                                    {detailBusy === 'cancel' ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                                    {detailPost.status === 'draft' ? 'Delete draft' : 'Cancel post'}
                                </button>
                                <div className="cal-detail__footer-right">
                                    <button className="btn btn-secondary" onClick={() => publishNow(detailPost)} disabled={!!detailBusy}>
                                        {detailBusy === 'publish' ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Publish now
                                    </button>
                                    {detailPost.status === 'draft' && (
                                        <button className="btn btn-secondary" onClick={() => savePostChanges(detailPost, true)} disabled={!!detailBusy}>
                                            {detailBusy === 'schedule' ? <Loader2 size={14} className="spin" /> : <Clock size={14} />} Schedule draft
                                        </button>
                                    )}
                                    <button className="btn btn-primary" onClick={() => savePostChanges(detailPost)} disabled={!!detailBusy}>
                                        {detailBusy === 'save' ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Save changes
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── CREATE MODAL ── */}
            {isModalOpen && (
                <div className="scheduler-modal-overlay">
                    <div className="scheduler-modal" role="dialog" aria-modal="true">
                        <div className="modal-stepper">
                            <div className={`step-item ${modalStep === 1 ? 'active' : 'completed'}`}>
                                <div className="step-number">{modalStep > 1 ? <Check size={14} /> : '1'}</div>
                                <span className="step-label">Media</span>
                            </div>
                            <div className={`step-item ${modalStep === 2 ? 'active' : modalStep > 2 ? 'completed' : ''}`}>
                                <div className="step-number">{modalStep > 2 ? <Check size={14} /> : '2'}</div>
                                <span className="step-label">Content</span>
                            </div>
                            <div className={`step-item ${modalStep === 3 ? 'active' : ''}`}>
                                <div className="step-number">3</div>
                                <span className="step-label">Schedule</span>
                            </div>
                            <button className="cal-icon-btn cal-modal-close" onClick={closeModal} disabled={isSubmitting} aria-label="Close"><X size={20} /></button>
                        </div>

                        <div className="modal-content-scroll">
                            {formError && <div className="error-banner" role="alert">{formError}</div>}

                            {modalStep === 1 && (
                                <label className="cal-dropzone">
                                    <input
                                        type="file"
                                        className="cal-dropzone__input"
                                        onChange={handleMediaUpload}
                                        accept="video/*,image/*"
                                    />
                                    <Upload size={48} className="cal-text-muted" />
                                    <h3>{mediaFile ? mediaFile.name : 'Select Media File'}</h3>
                                    <p className="cal-text-muted">Video (MP4, MOV) or Image (JPG, PNG), up to {MAX_UPLOAD_MB}MB</p>
                                    <p className="cal-text-muted cal-dropzone__hint">Click to choose a file, or press Continue for a text-only post.</p>
                                </label>
                            )}

                            {modalStep === 2 && (
                                <div className="animate-fade-in">
                                    <label className="cal-section-label">1. Select Platforms</label>
                                    {connectedPlatforms === null ? (
                                        <p className="cal-text-muted cal-loading"><Loader2 size={14} className="spin" /> Loading your connected accounts…</p>
                                    ) : availablePlatforms.length === 0 ? (
                                        <div className="cal-notice cal-notice--warning">
                                            <AlertTriangle size={16} />
                                            <span>No accounts are connected yet. <Link to="/dashboard/connections">Connect a platform</Link> first, then come back to schedule.</span>
                                        </div>
                                    ) : (
                                        <div className="platform-selector-grid">
                                            {availablePlatforms.map(p => (
                                                <button
                                                    type="button"
                                                    key={p.id}
                                                    className={`platform-check-card ${selectedPlatforms.includes(p.id) ? 'active' : ''}`}
                                                    onClick={() => {
                                                        const exists = selectedPlatforms.includes(p.id);
                                                        const next = exists ? selectedPlatforms.filter(i => i !== p.id) : [...selectedPlatforms, p.id];
                                                        setSelectedPlatforms(next);
                                                        if (!exists) setActiveTab(p.id);
                                                        else if (activeTab === p.id && next.length) setActiveTab(next[0]);
                                                    }}
                                                >
                                                    <p.icon size={18} />
                                                    <span>{p.name}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {availablePlatforms.length > 0 && availablePlatforms.length < PLATFORMS.length && (
                                        <p className="cal-text-muted cal-hint">Only connected accounts are shown. <Link to="/dashboard/connections">Manage connections</Link></p>
                                    )}

                                    {selectedPlatforms.length > 0 && (
                                        <>
                                            <label className="cal-section-label">2. Write Captions</label>
                                            <div className="platform-tab-switcher">
                                                {selectedPlatforms.map(pId => (
                                                    <button
                                                        key={pId}
                                                        className={`platform-tab ${activeTab === pId ? 'active' : ''}`}
                                                        onClick={() => setActiveTab(pId)}
                                                    >
                                                        {PLATFORMS.find(p => p.id === pId)?.name}
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="caption-editor-container">
                                                <textarea
                                                    placeholder={`Write your caption for ${PLATFORMS.find(p => p.id === activeTab)?.name || activeTab}...`}
                                                    value={captions[activeTab] || ''}
                                                    onChange={(e) => setCaptions(prev => ({ ...prev, [activeTab]: e.target.value }))}
                                                />
                                                <div className="editor-footer">
                                                    <button className="ai-gen-btn" onClick={() => handleAIGenerate(activeTab)} disabled={aiBusy}>
                                                        {aiBusy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                                                        {aiBusy ? 'Generating…' : 'AI Generate'}
                                                    </button>
                                                    <span className="char-limit-badge">
                                                        {captions[activeTab]?.length || 0} / {PLATFORMS.find(p => p.id === activeTab)?.limit}
                                                    </span>
                                                </div>
                                            </div>
                                            {aiMessage && (
                                                <p className="cal-hint cal-text-secondary">
                                                    {aiMessage}{' '}
                                                    {/Billing/.test(aiMessage) && <Link to="/dashboard/billing">Open Billing</Link>}
                                                </p>
                                            )}
                                            {selectedPlatforms.includes('tiktok') && (
                                                <>
                                                    <label className="cal-section-label">TikTok post settings</label>
                                                    <TikTokPostSettings value={tiktokOptions} onChange={setTiktokOptions} info={tiktokInfo} mediaFile={mediaFile} videoSeconds={videoSeconds} />
                                                </>
                                            )}
                                            {selectedPlatforms.includes('youtube') && (
                                                <>
                                                    <label className="cal-section-label">YouTube post settings</label>
                                                    <YouTubePostSettings value={youtubeOptions} onChange={setYoutubeOptions} />
                                                </>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {modalStep === 3 && (
                                <div className="schedule-options animate-fade-in">
                                    <div className="cal-stack">
                                        <label className="field">
                                            <span>Publish Date</span>
                                            <input
                                                type="date"
                                                className="input"
                                                value={scheduledAt}
                                                onChange={e => { setScheduledAt(e.target.value); setFormError(''); }}
                                                required
                                            />
                                        </label>
                                        <label className="field">
                                            <span>Publish Time</span>
                                            <input
                                                type="time"
                                                className="input"
                                                value={scheduledTime}
                                                onChange={e => { setScheduledTime(e.target.value); setFormError(''); }}
                                                required
                                            />
                                            <small><Clock size={10} /> Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
                                        </label>
                                    </div>
                                    <div className="cal-stack">
                                        <div className="field">
                                            <span>Suggested times</span>
                                            <div className="best-times-grid">
                                                {SUGGESTED_TIMES.map(t => (
                                                    <button key={t} type="button" className={`time-suggestion ${scheduledTime === t ? 'active' : ''}`} onClick={() => setScheduledTime(t)}>
                                                        <strong>{t}</strong>
                                                    </button>
                                                ))}
                                            </div>
                                            <small>Common posting slots, not based on your analytics.</small>
                                        </div>
                                        <div className="field">
                                            <span>Post Type</span>
                                            <div className="cal-toggle-row">
                                                <button
                                                    type="button"
                                                    className={`cal-toggle-btn ${status === 'pending' ? 'active' : ''}`}
                                                    onClick={() => setStatus('pending')}
                                                >Schedule</button>
                                                <button
                                                    type="button"
                                                    className={`cal-toggle-btn ${status === 'draft' ? 'active' : ''}`}
                                                    onClick={() => setStatus('draft')}
                                                >Draft</button>
                                            </div>
                                            <small>{status === 'draft' ? 'Drafts appear on the calendar but are never published automatically.' : 'Published automatically at the chosen time.'}</small>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <button
                                className="btn btn-ghost"
                                disabled={isSubmitting}
                                onClick={() => { setFormError(''); if (modalStep > 1) setModalStep(modalStep - 1); else closeModal(); }}
                            >
                                {modalStep === 1 ? 'Cancel' : 'Back'}
                            </button>
                            {modalStep < 3 ? (
                                <button
                                    className="btn btn-primary"
                                    onClick={async () => {
                                        const problem = modalStep === 2 ? platformSettingsProblem('pending') : '';
                                        if (problem && !(await confirmDialog(`${problem}\n\nYou can still save a draft, but scheduling needs this.`, { title: 'Continue anyway?', confirmLabel: 'Continue anyway' }))) {
                                            setFormError(problem);
                                            return;
                                        }
                                        setFormError('');
                                        setModalStep(modalStep + 1);
                                    }}
                                    disabled={modalStep === 2 && selectedPlatforms.length === 0}
                                >
                                    Continue
                                </button>
                            ) : (
                                <>
                                {selectedPlatforms.includes('tiktok') && status === 'pending' && tiktokInfo?.mode !== 'inbox' ? <TikTokConsent options={tiktokOptions} /> : null}
                                <button className="btn btn-primary" onClick={handleCreatePost} disabled={isSubmitting}>
                                    {isSubmitting && <Loader2 size={16} className="spin" />}
                                    {submitStage === 'uploading'
                                        ? 'Uploading media…'
                                        : submitStage === 'saving'
                                            ? 'Saving…'
                                            : status === 'pending' ? 'Schedule Content' : 'Save Draft'}
                                </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
