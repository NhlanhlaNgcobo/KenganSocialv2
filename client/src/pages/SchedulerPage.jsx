import { useState, useEffect } from 'react';
import {
    Calendar as CalendarIcon,
    ChevronLeft,
    ChevronRight,
    Clock,
    Instagram,
    Facebook,
    Smartphone,
    Youtube,
    Twitter,
    Linkedin,
    Loader2,
    X
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { apiClient } from '../lib/api';
import './Scheduler.css';

const PLATFORM_ICONS = {
    instagram: Instagram,
    tiktok: Smartphone,
    facebook: Facebook,
    youtube: Youtube,
    twitter: Twitter,
    linkedin: Linkedin,
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function SchedulerPage() {
    const { currentWorkspace } = useWorkspace();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [posts, setPosts] = useState([]);
    const [queue, setQueue] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    const location = useLocation();
    const navigate = useNavigate();
    const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
    const [postToSchedule, setPostToSchedule] = useState(null);
    const [selectedDate, setSelectedDate] = useState('');
    const [selectedTime, setSelectedTime] = useState('');

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();

    useEffect(() => {
        if (currentWorkspace?.id) {
            loadSchedulerData();
        }
    }, [currentWorkspace]);

    useEffect(() => {
        if (location.state?.scheduleDraftId && posts.length > 0) {
            const draftId = location.state.scheduleDraftId;
            const draft = posts.find(p => p.id === draftId);
            if (draft) {
                setPostToSchedule(draft);
                setScheduleModalOpen(true);
                navigate('.', { replace: true, state: {} });
            }
        }
    }, [location.state, posts, navigate]);

    const loadSchedulerData = async () => {
        try {
            setLoading(true);
            const [contentData, queueData, statsData] = await Promise.allSettled([
                apiClient(`/workspaces/${currentWorkspace.id}/content`),
                apiClient(`/scheduler/queue/${currentWorkspace.id}`),
                apiClient(`/scheduler/stats/${currentWorkspace.id}`),
            ]);

            setPosts(contentData.status === 'fulfilled' ? contentData.value.content || [] : []);
            setQueue(queueData.status === 'fulfilled' ? queueData.value.queue || [] : []);
            setStats(statsData.status === 'fulfilled' ? statsData.value.stats : null);
        } catch (error) {
            console.error('Scheduler load error:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleScheduleConfirm = async () => {
        if (!selectedDate || !selectedTime || !postToSchedule) return;
        try {
            const scheduledAt = new Date(`${selectedDate}T${selectedTime}`).toISOString();
            await apiClient(`/workspaces/${currentWorkspace.id}/content/${postToSchedule.id}`, {
                method: 'PUT',
                body: JSON.stringify({ status: 'scheduled', scheduledAt })
            });
            setScheduleModalOpen(false);
            setPostToSchedule(null);
            setSelectedDate('');
            setSelectedTime('');
            loadSchedulerData();
        } catch (error) {
            console.error('Failed to schedule post:', error);
        }
    };

    const getPlatformByConnectionId = (connectionId) => {
        // Find platform if we had connections loaded, otherwise fallback
        const platformObj = PLATFORM_ICONS[connectionId]; // Fast check if string is platform originally
        if (platformObj) return connectionId;
        // In reality, we could do another call to get `connections` and map `connectionId` -> `platform`
        // But for now, we'll try to guess based on ID string or fallback to instagram
        if (connectionId.includes('tiktok')) return 'tiktok';
        if (connectionId.includes('facebook')) return 'facebook';
        if (connectionId.includes('youtube')) return 'youtube';
        if (connectionId.includes('twitter')) return 'twitter';
        if (connectionId.includes('linkedin')) return 'linkedin';
        return 'instagram';
    };

    const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
    const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

    // Map posts to calendar days
    const getPostsForDay = (day) => {
        return posts.filter(post => {
            const postDate = new Date(post.scheduledAt || post.createdAt);
            return postDate.getDate() === day && postDate.getMonth() === month && postDate.getFullYear() === year;
        });
    };

    const calendarCells = [];
    for (let i = 0; i < firstDay; i++) calendarCells.push(null);
    for (let d = 1; d <= daysInMonth; d++) calendarCells.push(d);

    return (
        <div className="scheduler-page animate-fade-in">
            <div className="page-header">
                <div>
                    <h1>Content Scheduler</h1>
                    <p className="page-subtitle">Plan and manage your publishing calendar.</p>
                </div>
            </div>

            <div className="scheduler-layout">
                <div className="calendar-container card">
                    <div className="calendar-nav">
                        <button className="btn-icon btn-ghost" onClick={prevMonth}><ChevronLeft size={20} /></button>
                        <h2>{MONTHS[month]} {year}</h2>
                        <button className="btn-icon btn-ghost" onClick={nextMonth}><ChevronRight size={20} /></button>
                    </div>

                    <div className="calendar-grid">
                        {DAYS.map(day => <div key={day} className="calendar-day-header">{day}</div>)}

                        {calendarCells.map((day, idx) => {
                            const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
                            const dayPosts = day ? getPostsForDay(day) : [];

                            return (
                                <div key={idx} className={`calendar-cell ${!day ? 'empty' : ''} ${isToday ? 'today' : ''}`}>
                                    {day && (
                                        <>
                                            <span className="cell-date">{day}</span>
                                            <div className="cell-posts">
                                                {dayPosts.slice(0, 3).map((post, i) => {
                                                    const rawConnId = post.platforms?.[0] || 'instagram';
                                                    const platform = getPlatformByConnectionId(rawConnId);
                                                    const Icon = PLATFORM_ICONS[platform] || CalendarIcon;
                                                    return (
                                                        <div key={i} className={`post-pill ${post.status}`}>
                                                            <Icon size={10} />
                                                            <span>{post.caption?.substring(0, 15) || 'Post'}...</span>
                                                        </div>
                                                    );
                                                })}
                                                {dayPosts.length > 3 && <span className="more-posts">+{dayPosts.length - 3} more</span>}
                                            </div>
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="scheduler-sidebar">
                    <div className="card upcoming-queue">
                        <h3><Clock size={18} /> Upcoming Queue</h3>
                        {loading ? (
                            <div style={{ textAlign: 'center', padding: '24px' }}><Loader2 size={20} className="spin" /></div>
                        ) : queue.length > 0 ? (
                            <div className="queue-list">
                                {queue.slice(0, 5).map((post, i) => {
                                    const rawConnId = post.platforms?.[0] || 'instagram';
                                    const platform = getPlatformByConnectionId(rawConnId);
                                    const Icon = PLATFORM_ICONS[platform] || CalendarIcon;
                                    return (
                                        <div key={i} className="queue-item">
                                            <Icon size={16} />
                                            <div className="queue-info">
                                                <span className="queue-caption">{post.caption?.substring(0, 30) || 'Untitled'}...</span>
                                                <span className="queue-time">{new Date(post.scheduledAt).toLocaleString()}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '16px 0' }}>
                                No upcoming posts scheduled.
                            </p>
                        )}
                    </div>

                    {stats && (
                        <div className="card summary-card">
                            <h3>Monthly Summary</h3>
                            <div className="summary-stats">
                                <div className="summary-row">
                                    <span>Scheduled</span><strong>{stats.scheduled}</strong>
                                </div>
                                <div className="summary-row">
                                    <span>Published</span><strong>{stats.published}</strong>
                                </div>
                                <div className="summary-row">
                                    <span>Drafts</span><strong>{stats.drafts}</strong>
                                </div>
                                <div className="summary-row">
                                    <span>Failed</span><strong>{stats.failed}</strong>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Schedule Post Modal */}
            {scheduleModalOpen && postToSchedule && (
                <div className="modal-overlay animate-fade-in" onClick={() => setScheduleModalOpen(false)} style={{ zIndex: 9999 }}>
                    <div className="modal card" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Schedule Content</h3>
                            <button className="btn-icon btn-ghost" onClick={() => setScheduleModalOpen(false)}><X size={18} /></button>
                        </div>
                        <div className="modal-body">
                            <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                                Select the exact date and time you want this post to go live.
                            </p>
                            <div className="glass" style={{ padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
                                <p style={{ fontSize: '13px' }}>{postToSchedule.caption?.substring(0, 100)}...</p>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px' }}>Publish Date</label>
                                    <input
                                        type="date"
                                        className="input"
                                        value={selectedDate}
                                        onChange={e => setSelectedDate(e.target.value)}
                                        min={new Date().toISOString().split('T')[0]}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px' }}>Time</label>
                                    <input
                                        type="time"
                                        className="input"
                                        value={selectedTime}
                                        onChange={e => setSelectedTime(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setScheduleModalOpen(false)}>Cancel / Keep as Draft</button>
                            <button className="btn btn-primary" onClick={handleScheduleConfirm} disabled={!selectedDate || !selectedTime}>
                                <Clock size={16} style={{ marginRight: '8px' }} /> Schedule Time
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
