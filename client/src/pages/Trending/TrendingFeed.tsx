import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Play, Bookmark, Clock, Flame, CheckCircle, Smartphone, Info } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { apiClient } from '../../lib/api';
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
    source?: string;
}

interface TrendingResponse {
    success: boolean;
    data: TrendCard[];
    generatedAt: string | null;
    source: 'live' | 'ai-ideas';
    cached: boolean;
    refreshThrottled?: boolean;
}

function formatGeneratedAt(iso: string | null) {
    if (!iso) return 'Not generated yet';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Not generated yet';
    const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
    const when = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (mins < 1) return `Generated just now (${when})`;
    if (mins < 60) return `Generated ${mins}m ago (${when})`;
    return `Generated ${Math.floor(mins / 60)}h ${mins % 60}m ago (${when})`;
}

export default function TrendingFeed() {
    const navigate = useNavigate();
    const store = useEditorStore();

    const [cards, setCards] = useState<TrendCard[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [activePlatform, setActivePlatform] = useState('All');
    const [activeNiche, setActiveNiche] = useState('fitness');
    const [generatedAt, setGeneratedAt] = useState<string | null>(null);
    const [dataSource, setDataSource] = useState<'live' | 'ai-ideas' | null>(null);
    const [saved, setSaved] = useState<TrendCard[]>(() => {
        try {
            return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
        } catch {
            return [];
        }
    });

    // The latest request wins: switching niche mid-load aborts the older request.
    const abortRef = useRef<AbortController | null>(null);

    const fetchTrending = useCallback(async (niche: string, refresh = false) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setError('');
        setNotice('');
        try {
            const data: TrendingResponse = await apiClient(
                `/trending?niche=${encodeURIComponent(niche)}&limit=20${refresh ? '&refresh=1' : ''}`,
                { signal: controller.signal }
            );
            if (controller.signal.aborted) return;
            setCards(Array.isArray(data.data) ? data.data : []);
            setGeneratedAt(data.generatedAt || null);
            setDataSource(data.source || null);
            if (refresh && data.refreshThrottled) {
                setNotice('These ideas were generated a few minutes ago, so they were not regenerated yet. Try again shortly.');
            }
        } catch (err) {
            if ((err as Error)?.name === 'AbortError' || controller.signal.aborted) return;
            setError((err as Error)?.message ? `Could not load trends (${(err as Error).message}).` : 'Could not load trends.');
        } finally {
            if (abortRef.current === controller) {
                setLoading(false);
                abortRef.current = null;
            }
        }
    }, []);

    useEffect(() => {
        fetchTrending(activeNiche);
    }, [activeNiche, fetchTrending]);

    useEffect(() => () => abortRef.current?.abort(), []);

    const createNow = (card: TrendCard) => {
        // Preload Editor Store
        store.setViralClips([{
            startSec: 0, endSec: 5, score: card.viralityScore * 10, reason: card.hook, thumbnailUrl: ''
        }]);

        // Inject caption and hashtags as a pseudo-transcript (milliseconds, like the transcription service)
        store.setTranscription({
            words: [
                { text: card.captionPreview, start: 0, end: 5000 },
                ...(card.hashtags || []).map((h, i) => ({ text: h, start: (5 + i) * 1000, end: (5.5 + i) * 1000 }))
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
        : cards.filter(c => activePlatform === 'All' ? true : (c.platform || '').toLowerCase() === activePlatform.toLowerCase());

    const isAiIdeas = dataSource === 'ai-ideas';

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
                        <Clock size={12} /> {loading ? 'Loading…' : formatGeneratedAt(generatedAt)}
                    </span>
                    <button
                        className="tf-icon-btn"
                        onClick={() => fetchTrending(activeNiche, true)}
                        disabled={loading}
                        title="Regenerate ideas"
                        aria-label="Regenerate ideas"
                    >
                        <RefreshCw size={16} className={loading ? 'spin' : ''} />
                    </button>
                </div>
            </div>

            {/* ── CARD DECK ── */}
            <div className="card-deck">
                {error && <div className="error-banner tf-banner" role="alert">{error}</div>}
                {notice && <div className="tf-notice tf-banner" role="status"><Info size={14} /> {notice}</div>}
                {isAiIdeas && activePlatform !== 'Saved' && (
                    <div className="tf-notice tf-banner" role="note">
                        <Info size={14} />
                        <span>
                            <strong>AI-suggested ideas (no live trend data connected).</strong> These are not measured trends; scores are AI estimates.
                        </span>
                    </div>
                )}

                {filteredCards.map((card, i) => (
                    <div key={`${card.id}_${i}`} className="trend-card">

                        <div className="trend-card__header">
                            <div className="platform-badge">
                                <Smartphone size={14} />
                                {(card.platform || 'any').toUpperCase()}
                            </div>
                            <div className="trend-card__meta">
                                <span className={`difficulty ${card.difficulty}`}>{card.difficulty}</span>
                                <div className="score-dots" title={`AI estimate of how well this idea could perform: ${card.viralityScore}/10. Not a measured metric.`}>
                                    {[...Array(10)].map((_, idx) => (
                                        <div key={idx} className={`dot ${idx < card.viralityScore ? 'active' : ''}`} />
                                    ))}
                                    <span className="score-text">{card.viralityScore}/10 <Flame size={12} /></span>
                                    <span className="score-label">AI estimate</span>
                                </div>
                            </div>
                        </div>

                        <div className="trend-card__body">
                            <h3 className="trend-title">{card.videoIdea}</h3>

                            <div className="hook-chip">
                                <CheckCircle size={14} className="hook-chip__icon" />
                                <span><strong>Hook:</strong> {card.hook}</span>
                            </div>

                            <p className="caption-preview">"{card.captionPreview}"</p>

                            <div className="hashtag-row">
                                {(card.hashtags || []).map((tag, idx) => (
                                    <span key={idx} className="hashtag">{tag}</span>
                                ))}
                            </div>
                        </div>

                        <div className="trend-card__footer">
                            <button className="btn btn-primary" onClick={() => createNow(card)}>
                                <Play size={16} fill="currentColor" /> Create Now
                            </button>
                            <button
                                className={`tf-icon-btn bookmark ${isSaved(card) ? 'active' : ''}`}
                                title={isSaved(card) ? 'Remove from saved ideas' : 'Save this idea'}
                                aria-pressed={isSaved(card)}
                                onClick={() => toggleSaved(card)}
                            >
                                <Bookmark size={20} fill={isSaved(card) ? 'currentColor' : 'none'} />
                            </button>
                        </div>

                    </div>
                ))}

                {loading && <div className="loading-indicator">Loading ideas…</div>}
                {(!loading && !error && filteredCards.length === 0) && (
                    <div className="no-cards">
                        {activePlatform === 'Saved' ? 'No saved ideas yet. Use the bookmark on a card to save it.' : 'No ideas found for this niche right now.'}
                    </div>
                )}
            </div>

        </div>
    );
}
