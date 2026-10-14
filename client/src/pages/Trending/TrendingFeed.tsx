import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { RefreshCw, Play, Bookmark, Clock, Flame, CheckCircle, Smartphone } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import './TrendingFeed.css';

const SAVED_KEY = 'kengan-saved-trend-ideas';

interface TrendCard {
    id: string;
    hook: string;
    videoIdea: string;
    captionPreview: string;
    hashtags: string[];
    platform: string;
    viralityScore: number;
    difficulty: 'easy' | 'medium' | 'hard';
}

export default function TrendingFeed() {
    const { user, plan } = useAuth();
    const API_ROOT = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api$/, '');
    const navigate = useNavigate();
    const store = useEditorStore();

    const [cards, setCards] = useState<TrendCard[]>([]);
    const [loading, setLoading] = useState(false);
    const [activePlatform, setActivePlatform] = useState('All');
    const [activeNiche, setActiveNiche] = useState('fitness'); // Should map from user profile natively
    const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
    const [page, setPage] = useState(1);
    const [saved, setSaved] = useState<TrendCard[]>(() => {
        try {
            return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
        } catch {
            return [];
        }
    });

    const fetchTrending = useCallback(async (isRefresh = false, retryNiche = activeNiche) => {
        if (loading) return;
        setLoading(true);
        try {
            const token = await user?.getIdToken();
            // Increase limit based on pagination if not a refresh
            const limit = isRefresh ? 20 : page * 20;

            const res = await fetch(`${API_ROOT}/api/trending?niche=${retryNiche}&limit=${limit}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            if (data.success) {
                setCards(data.data);
                if (isRefresh) setLastRefreshed(new Date());
            }
        } catch (err) {
            console.error('Trending fetch error:', err);
        }
        setLoading(false); // eslint-disable-next-line
    }, [user, activeNiche, page, loading]);

    // Initial setup + infinite scroll listener setup
    useEffect(() => {
        fetchTrending(true);
    }, [activeNiche]);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const bottom = e.currentTarget.scrollHeight - e.currentTarget.scrollTop === e.currentTarget.clientHeight;
        if (bottom && !loading) {
            setPage(p => p + 1);
            fetchTrending(false); // Pull next page implicitly mapping limit higher
        }
    };

    const createNow = (card: TrendCard) => {
        // Preload Editor Store
        store.setViralClips([{
            startSec: 0, endSec: 5, score: card.viralityScore * 10, reason: card.hook, thumbnailUrl: ''
        }]);

        // Inject caption and hashtags as a pseudo-transcript (milliseconds, like the transcription service)
        store.setTranscription({
            words: [
                { text: card.captionPreview, start: 0, end: 5000 },
                ...card.hashtags.map((h, i) => ({ text: h, start: (5 + i) * 1000, end: (5.5 + i) * 1000 }))
            ]
        });

        navigate('/editor');
    };

    const toggleSaved = (card: TrendCard) => {
        setSaved(prev => {
            const next = prev.some(c => c.id === card.id) ? prev.filter(c => c.id !== card.id) : [card, ...prev];
            try {
                localStorage.setItem(SAVED_KEY, JSON.stringify(next));
            } catch {
                /* storage unavailable: keep in memory only */
            }
            return next;
        });
    };
    const isSaved = (card: TrendCard) => saved.some(c => c.id === card.id);

    const filteredCards = activePlatform === 'Saved'
        ? saved
        : cards.filter(c => activePlatform === 'All' ? true : c.platform.toLowerCase() === activePlatform.toLowerCase());

    return (
        <div className="trending-feed-container">

            {/* ── STICKY FILTER BAR ── */}
            <div className="filter-bar">
                <div className="niche-selector">
                    <span className="niche-label">Niche:</span>
                    {['fitness', 'gaming', 'tech', 'comedy', 'education'].map(n => (
                        <button
                            key={n}
                            className={`pill ${activeNiche === n ? 'active' : ''}`}
                            onClick={() => setActiveNiche(n)}
                        >
                            {n.charAt(0).toUpperCase() + n.slice(1)}
                        </button>
                    ))}
                </div>

                <div className="platform-selector">
                    {['All', 'TikTok', 'Instagram', 'YouTube', 'Saved'].map(p => (
                        <button
                            key={p}
                            className={`pill ${activePlatform === p ? 'active' : ''}`}
                            onClick={() => setActivePlatform(p)}
                        >
                            {p}
                        </button>
                    ))}
                </div>

                <div className="refresh-row">
                    <span className="time-ago">
                        <Clock size={12} /> Updated {Math.floor((Date.now() - lastRefreshed.getTime()) / 60000)}m ago
                    </span>
                    <button className="btn-icon" onClick={() => fetchTrending(true)} disabled={loading}>
                        <RefreshCw size={16} className={loading ? 'spinning' : ''} />
                    </button>
                </div>
            </div>

            {/* ── CARD DECK (Mobile-first vertical scroll) ── */}
            <div className="card-deck" onScroll={handleScroll}>
                {filteredCards.map((card, i) => (
                    <div key={`${card.id}_${i}`} className="trend-card">

                        <div className="card-header">
                            <div className="platform-badge">
                                <Smartphone size={14} />
                                {card.platform.toUpperCase()}
                            </div>
                            <div className="card-meta">
                                <span className={`difficulty ${card.difficulty}`}>{card.difficulty}</span>
                                <div className="score-dots" title={`Virality: ${card.viralityScore}/10`}>
                                    {[...Array(10)].map((_, idx) => (
                                        <div key={idx} className={`dot ${idx < card.viralityScore ? 'active' : ''}`} />
                                    ))}
                                    <span className="score-text">{card.viralityScore}/10 <Flame size={12} color="#f59e0b" /></span>
                                </div>
                            </div>
                        </div>

                        <div className="card-body">
                            <h3 className="trend-title">{card.videoIdea}</h3>

                            <div className="hook-chip">
                                <CheckCircle size={14} color="#f59e0b" />
                                <span><strong>Hook:</strong> {card.hook}</span>
                            </div>

                            <p className="caption-preview">"{card.captionPreview}"</p>

                            <div className="hashtag-row">
                                {card.hashtags.map((tag, idx) => (
                                    <span key={idx} className="hashtag">{tag}</span>
                                ))}
                            </div>
                        </div>

                        <div className="card-footer">
                            <button className="btn-primary" onClick={() => createNow(card)}>
                                <Play size={16} fill="white" /> Create Now
                            </button>
                            <button
                                className={`btn-icon bookmark ${isSaved(card) ? 'active' : ''}`}
                                title={isSaved(card) ? 'Remove from saved ideas' : 'Save this idea'}
                                aria-pressed={isSaved(card)}
                                onClick={() => toggleSaved(card)}
                            >
                                <Bookmark size={20} fill={isSaved(card) ? 'currentColor' : 'none'} />
                            </button>
                        </div>

                    </div>
                ))}

                {loading && <div className="loading-indicator">Loading localized trends...</div>}
                {(!loading && filteredCards.length === 0) && (
                    <div className="no-cards">No trends found for this niche right now.</div>
                )}
            </div>

        </div>
    );
}
