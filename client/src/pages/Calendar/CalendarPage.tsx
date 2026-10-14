import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    ChevronLeft,
    ChevronRight,
    Plus,
    Filter,
    MoreHorizontal,
    Calendar as CalendarIcon,
    LayoutGrid,
    List,
    Smartphone,
    Instagram,
    Youtube,
    Linkedin,
    Trello,
    MessageSquare,
    CheckCircle2,
    Image as ImageIcon,
    Video,
    Clock,
    Sparkles,
    Trash2,
    X,
    Camera,
    Upload,
    Check
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useAuth } from '../../context/AuthContext';
import { apiClient } from '../../lib/api';
import './Calendar.css';

interface ScheduledPost {
    id: string;
    postId: string;
    status: 'pending' | 'published' | 'failed' | 'partial' | 'draft';
    platforms: string[];
    mediaUrl: string;
    caption: string;
    scheduledAt: string;
    platformOptions: any;
    thumbnailUrl?: string; // Derived or explicitly sent
}

const PLATFORMS = [
    { id: 'youtube', name: 'YouTube', icon: Youtube, color: '#FF0000', limit: 5000 },
    { id: 'instagram', name: 'Instagram', icon: Instagram, color: '#E4405F', limit: 2200 },
    { id: 'tiktok', name: 'TikTok', icon: Smartphone, color: '#000000', limit: 4000 },
    { id: 'linkedin', name: 'LinkedIn', icon: Linkedin, color: '#0A66C2', limit: 3000 },
    { id: 'pinterest', name: 'Pinterest', icon: Trello, color: '#BD081C', limit: 500 },
    { id: 'threads', name: 'Threads', icon: MessageSquare, color: '#000000', limit: 500 }
];

export default function CalendarPage() {
    const { currentWorkspace } = useWorkspace() as any;
    const { plan } = useAuth();

    // ── CALENDAR STATE ──
    const [view, setView] = useState<'month' | 'week' | 'list'>('month');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [posts, setPosts] = useState<ScheduledPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterPlatform, setFilterPlatform] = useState('all');

    // ── MODAL STATE ──
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalStep, setModalStep] = useState(1);
    const [selectedDay, setSelectedDay] = useState<Date | null>(null);

    // ── FORM STATE ──
    const [mediaFile, setMediaFile] = useState<File | null>(null);
    const [mediaPreview, setMediaPreview] = useState<string | null>(null);
    const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
    const [captions, setCaptions] = useState<Record<string, string>>({});
    const [activeTab, setActiveTab] = useState('instagram');
    const [scheduledAt, setScheduledAt] = useState('');
    const [scheduledTime, setScheduledTime] = useState('12:00');
    const [status, setStatus] = useState<'pending' | 'draft'>('pending');

    // ── HANDOFF FROM OTHER PAGES (e.g. Clips → Schedule) ──
    const location = useLocation();
    const navigate = useNavigate();
    useEffect(() => {
        const state = location.state as { mediaFile?: File; caption?: string } | null;
        if (!state?.mediaFile && !state?.caption) return;
        if (state.mediaFile) {
            setMediaFile(state.mediaFile);
            setMediaPreview(URL.createObjectURL(state.mediaFile));
        }
        if (state.caption) setCaptions(Object.fromEntries(PLATFORMS.map((p) => [p.id, state.caption as string])));
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        setScheduledAt(tomorrow.toISOString().split('T')[0]);
        // With a video go straight to platforms; with only a caption, start at the media step.
        setModalStep(state.mediaFile ? 2 : 1);
        setIsModalOpen(true);
        // Clear the state so a refresh does not reopen the dialog.
        navigate(location.pathname, { replace: true, state: null });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── LOAD DATA ──
    useEffect(() => {
        if (currentWorkspace?.id) {
            fetchPosts();
        }
    }, [currentWorkspace?.id, currentDate]);

    const fetchPosts = async () => {
        try {
            setLoading(true);
            const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).toISOString();
            const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).toISOString();
            const data = await apiClient(`/schedule/calendar?start=${start}&end=${end}`);
            setPosts(data.posts || []);
        } catch (err) {
            console.error('Failed to fetch calendar posts:', err);
        } finally {
            setLoading(false);
        }
    };

    // ── DATE CALCULATIONS ──
    const daysInMonth = useMemo(() => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const days = new Date(year, month + 1, 0).getDate();
        const firstDay = new Date(year, month, 1).getDay(); // 0 is Sun

        // Start from Monday
        const offset = firstDay === 0 ? 6 : firstDay - 1;

        const arr = [];
        // Prev month padding
        const prevMonthLastDay = new Date(year, month, 0).getDate();
        for (let i = offset - 1; i >= 0; i--) {
            arr.push({ day: prevMonthLastDay - i, month: 'prev', date: new Date(year, month - 1, prevMonthLastDay - i) });
        }
        // Current month
        for (let i = 1; i <= days; i++) {
            arr.push({ day: i, month: 'current', date: new Date(year, month, i) });
        }
        // Next month padding
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

    // ── HANDLERS ──
    const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Plan limit check example
        const maxSize = plan === 'starter' ? 50 * 1024 * 1024 : 500 * 1024 * 1024;
        if (file.size > maxSize) {
            alert(`File too large for your plan. Limit is ${Math.round(maxSize / (1024 * 1024))}MB.`);
            return;
        }

        setMediaFile(file);
        setMediaPreview(URL.createObjectURL(file));
        setModalStep(2);
    };

    const handleCreatePost = async () => {
        try {
            const formData = new FormData();
            formData.append('video', mediaFile!);

            // 1. Upload Media
            const uploadRes = await apiClient(`/video/manual-edit/upload`, {
                method: 'POST',
                body: formData
            });

            // 2. Create Schedule
            const payload = {
                platforms: selectedPlatforms,
                mediaUrl: uploadRes.videoUrl, // Server should return url
                caption: captions[activeTab] || Object.values(captions)[0] || '',
                scheduledAt: new Date(`${scheduledAt}T${scheduledTime}`).toISOString(),
                platformOptions: selectedPlatforms.reduce((acc, p) => ({ ...acc, [p]: { caption: captions[p] } }), {}),
                status: status
            };

            await apiClient('/api/schedule/create', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            setIsModalOpen(false);
            resetForm();
            fetchPosts();
        } catch (err) {
            alert('Scheduling failed: ' + err);
        }
    };

    const resetForm = () => {
        setModalStep(1);
        setMediaFile(null);
        setMediaPreview(null);
        setSelectedPlatforms([]);
        setCaptions({});
        setStatus('pending');
    };

    const handleAIGenerate = async (platform: string) => {
        if (!plan || plan === 'starter') return;
        try {
            const res = await apiClient('/api/ai/generate-captions', {
                method: 'POST',
                body: JSON.stringify({ platform, prompt: 'Generate a short viral caption for this video.' })
            });
            setCaptions(prev => ({ ...prev, [platform]: res.caption }));
        } catch (err) {
            console.error(err);
        }
    };

    // ── RENDER HELPERS ──
    const getPostsForDay = (date: Date) => {
        return posts.filter(p => {
            const d = new Date(p.scheduledAt);
            return d.getDate() === date.getDate() && d.getMonth() === date.getMonth() && d.getFullYear() === date.getFullYear();
        }).filter(p => filterPlatform === 'all' || p.platforms.includes(filterPlatform));
    };

    return (
        <div className="calendar-page">
            {/* ── HEADER ── */}
            <div className="calendar-header">
                <div className="flex flex-col">
                    <h1 className="text-2xl font-bold">Calendar</h1>
                    <p className="text-sm text-gray-500">Plan the month and schedule posts to your connected accounts.</p>
                </div>

                <div className="flex items-center gap-6">
                    <div className="calendar-nav-controls">
                        <button className="p-1 hover:bg-gray-100 rounded" onClick={() => changeMonth(-1)}><ChevronLeft size={20} /></button>
                        <h2>{currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
                        <button className="p-1 hover:bg-gray-100 rounded" onClick={() => changeMonth(1)}><ChevronRight size={20} /></button>
                        <button className="text-xs font-bold uppercase tracking-wider text-accent ml-2" onClick={() => setCurrentDate(new Date())}>Today</button>
                    </div>

                    <div className="view-toggle">
                        <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>Month</button>
                        <button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>Week</button>
                        <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>List</button>
                    </div>

                    <button className="btn btn-primary flex items-center gap-2" onClick={() => setIsModalOpen(true)}>
                        <Plus size={18} /> New Post
                    </button>
                </div>
            </div>

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
            </div>

            {/* ── MESH/MONTH GRID ── */}
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
                                        <Plus
                                            size={14}
                                            className="add-post-btn-sm"
                                            onClick={() => {
                                                setSelectedDay(dayObj.date);
                                                setScheduledAt(dayObj.date.toISOString().split('T')[0]);
                                                setIsModalOpen(true);
                                            }}
                                        />
                                    </div>
                                    <div className="cell-posts">
                                        {dayPosts.slice(0, 3).map((post) => (
                                            <div key={post.id} className="post-thumb-wrapper" onClick={() => alert(`Post Detail: ${post.id}`)}>
                                                <div className="relative">
                                                    <img src={post.thumbnailUrl || 'https://via.placeholder.com/32'} className="post-thumb" alt="Post" />
                                                    <div className="post-platform-badge">
                                                        {PLATFORMS.find(p => p.id === post.platforms[0])?.icon({ size: 8 })}
                                                    </div>
                                                </div>
                                                <span className="post-caption-preview">{post.caption}</span>
                                            </div>
                                        ))}
                                        {dayPosts.length > 3 && (
                                            <span className="more-posts-chip">+{dayPosts.length - 3} more</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── MOBILE VIEW (Simplified) ── */}
            <div className="md:hidden">
                <div className="mobile-week-strip">
                    {mobileWeek.map((day) => {
                        const isActive = day.toDateString() === mobileDay.toDateString();
                        const count = getPostsForDay(day).length;
                        return (
                            <button key={day.toISOString()} className={`mobile-day-btn ${isActive ? 'active' : ''}`} onClick={() => selectMobileDay(day)}>
                                <span className="text-[10px] uppercase">{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                                <span className="text-lg font-bold">{day.getDate()}</span>
                                {count > 0 ? <span className="text-[10px]">{count}</span> : null}
                            </button>
                        );
                    })}
                </div>
                <div className="flex justify-between items-center mt-2 mb-2">
                    <button className="p-2" onClick={() => selectMobileDay(new Date(mobileDay.getTime() - 7 * 86400000))} aria-label="Previous week"><ChevronLeft size={18} /></button>
                    <span className="text-sm font-bold">{mobileDay.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                    <button className="p-2" onClick={() => selectMobileDay(new Date(mobileDay.getTime() + 7 * 86400000))} aria-label="Next week"><ChevronRight size={18} /></button>
                </div>
                <div className="mobile-posts-list">
                    {getPostsForDay(mobileDay).length === 0 ? (
                        <p className="text-sm text-gray-400 p-4">Nothing scheduled for this day.</p>
                    ) : getPostsForDay(mobileDay).map(post => (
                        <div key={post.id} className="mobile-post-card">
                            {post.thumbnailUrl
                                ? <img src={post.thumbnailUrl} alt="" className="w-16 h-16 rounded-lg object-cover" />
                                : <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center"><Video size={20} /></div>}
                            <div className="flex-1">
                                <h3 className="text-sm font-bold">{post.caption.length > 40 ? `${post.caption.substring(0, 40)}…` : post.caption}</h3>
                                <div className="flex gap-2 mt-2">
                                    {post.platforms.map(p => <span key={p} className="p-1 bg-gray-100 rounded text-[10px]">{p}</span>)}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
                <button
                    className="camera-fab"
                    aria-label="Create a post for this day"
                    onClick={() => {
                        setSelectedDay(mobileDay);
                        setScheduledAt(mobileDay.toISOString().split('T')[0]);
                        setModalStep(1);
                        setIsModalOpen(true);
                    }}
                >
                    <Camera size={24} />
                </button>
            </div>

            {/* ── MODAL ── */}
            {isModalOpen && (
                <div className="scheduler-modal-overlay">
                    <div className="scheduler-modal">
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
                            <button className="ml-auto p-2" onClick={() => setIsModalOpen(false)}><X size={20} /></button>
                        </div>

                        <div className="modal-content-scroll">
                            {modalStep === 1 && (
                                <div className="flex flex-col items-center justify-center min-h-[300px] border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50 hover:bg-white transition-colors cursor-pointer relative">
                                    <input
                                        type="file"
                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                        onChange={handleMediaUpload}
                                        accept="video/*,image/*"
                                    />
                                    <Upload size={48} className="text-gray-400 mb-4" />
                                    <h3 className="text-lg font-bold">Select Media File</h3>
                                    <p className="text-sm text-gray-400 mt-1">Video (MP4, MOV) or Image (JPG, PNG)</p>
                                    <div className="mt-8">
                                        <button className="btn btn-secondary text-xs">Browse Library</button>
                                    </div>
                                </div>
                            )}

                            {modalStep === 2 && (
                                <div className="animate-fade-in">
                                    <label className="text-xs font-bold text-gray-500 uppercase mb-3 block">1. Select Platforms</label>
                                    <div className="platform-selector-grid">
                                        {PLATFORMS.map(p => (
                                            <div
                                                key={p.id}
                                                className={`platform-check-card ${selectedPlatforms.includes(p.id) ? 'active' : ''}`}
                                                onClick={() => {
                                                    const exists = selectedPlatforms.includes(p.id);
                                                    setSelectedPlatforms(exists ? selectedPlatforms.filter(i => i !== p.id) : [...selectedPlatforms, p.id]);
                                                    if (!exists) setActiveTab(p.id);
                                                }}
                                            >
                                                <p.icon size={18} />
                                                <span className="text-xs font-bold">{p.name}</span>
                                            </div>
                                        ))}
                                    </div>

                                    {selectedPlatforms.length > 0 && (
                                        <>
                                            <label className="text-xs font-bold text-gray-500 uppercase mb-3 block">2. Write Captions</label>
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
                                                    placeholder={`Write your caption for ${activeTab}...`}
                                                    value={captions[activeTab] || ''}
                                                    onChange={(e) => setCaptions(prev => ({ ...prev, [activeTab]: e.target.value }))}
                                                />
                                                <div className="editor-footer">
                                                    <button className="ai-gen-btn" onClick={() => handleAIGenerate(activeTab)}>
                                                        <Sparkles size={14} /> AI Generate
                                                    </button>
                                                    <span className="char-limit-badge">
                                                        {captions[activeTab]?.length || 0} / {PLATFORMS.find(p => p.id === activeTab)?.limit}
                                                    </span>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {modalStep === 3 && (
                                <div className="schedule-options animate-fade-in">
                                    <div className="flex flex-col gap-6">
                                        <div className="flex flex-col">
                                            <label className="text-xs font-bold text-gray-500 uppercase mb-2">Publish Date</label>
                                            <input
                                                type="date"
                                                className="p-3 bg-gray-50 border border-gray-200 rounded-xl"
                                                value={scheduledAt}
                                                onChange={e => setScheduledAt(e.target.value)}
                                            />
                                        </div>
                                        <div className="flex flex-col">
                                            <label className="text-xs font-bold text-gray-500 uppercase mb-2">Publish Time</label>
                                            <input
                                                type="time"
                                                className="p-3 bg-gray-50 border border-gray-200 rounded-xl"
                                                value={scheduledTime}
                                                onChange={e => setScheduledTime(e.target.value)}
                                            />
                                            <p className="text-[10px] text-gray-400 mt-2 flex items-center gap-1">
                                                <Clock size={10} /> Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex flex-col">
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-2">Best times to post</label>
                                        <div className="best-times-grid">
                                            {['09:00', '12:30', '18:45', '21:00'].map(t => (
                                                <button key={t} className="time-suggestion" onClick={() => setScheduledTime(t)}>
                                                    <strong>{t}</strong>
                                                    <span className="text-[10px] text-gray-400 block">+15% Reach</span>
                                                </button>
                                            ))}
                                        </div>
                                        <div className="mt-8 flex flex-col gap-3">
                                            <label className="text-xs font-bold text-gray-500 uppercase">Post Type</label>
                                            <div className="flex gap-2">
                                                <button
                                                    className={`flex-1 p-3 rounded-xl border text-xs font-bold ${status === 'pending' ? 'bg-accent text-white border-accent' : 'bg-gray-50 border-gray-200'}`}
                                                    onClick={() => setStatus('pending')}
                                                >Schedule</button>
                                                <button
                                                    className={`flex-1 p-3 rounded-xl border text-xs font-bold ${status === 'draft' ? 'bg-accent text-white border-accent' : 'bg-gray-50 border-gray-200'}`}
                                                    onClick={() => setStatus('draft')}
                                                >Draft</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <button className="btn btn-ghost" onClick={() => modalStep > 1 ? setModalStep(modalStep - 1) : resetForm()}>
                                {modalStep === 1 ? 'Cancel' : 'Back'}
                            </button>
                            {modalStep < 3 ? (
                                <button className="btn btn-primary px-8" onClick={() => setModalStep(modalStep + 1)} disabled={modalStep === 2 && selectedPlatforms.length === 0}>
                                    Continue
                                </button>
                            ) : (
                                <button className="btn btn-primary px-10" onClick={handleCreatePost}>
                                    {status === 'pending' ? 'Schedule Content' : 'Save Draft'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
