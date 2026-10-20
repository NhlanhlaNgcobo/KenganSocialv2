import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Play, Bookmark, Clock, Flame, CheckCircle, Smartphone, Info, Search } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { apiClient } from '../../lib/api';
import './TrendingFeed.css';

const SAVED_KEY = 'kengan-saved-trend-ideas';
const NICHES = ['fitness', 'food', 'beauty', 'business', 'tech', 'gaming', 'comedy', 'education'];
const PLATFORM_FILTERS = ['All', 'TikTok', 'Instagram', 'YouTube', 'Facebook', 'Saved'];
const PLATFORM_NAMES: Record<string, string> = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', facebook: 'Facebook' };
const platformName = (p?: string) => PLATFORM_NAMES[(p || '').toLowerCase()] || (p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Any platform');

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
    const [customNiche, setCustomNiche] = useState('');
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
        <div className="trending-page animate-fade-in">
            <header className="page-head">
                <div>
                    <h1>Trending ideas</h1>
                    <p>Short-form video ideas for your niche, each with a hook, caption and hashtags. Open one in the editor or save it for later.</p>
                </div>
                <button className="btn btn-secondary" onClick={() => fetchTrending(activeNiche, true)} disabled={loading}>
                    <RefreshCw size={16} className={loading ? 'spin' : ''} /> {loading ? 'Loading…' : 'New ideas'}
                </button>
            </header>

            <section className="surface tf-toolbar">
                <div className="tf-toolbar__row">
                    <span className="tf-toolbar__label">Niche</span>
                    <div className="tf-chips">
                        {NICHES.map(n => (
                            <button key={n} className={`chip ${activeNiche === n ? "is-active" : ""}`} onClick={() => setActiveNiche(n)}>
                                {n.charAt(0).toUpperCase() + n.slice(1)}
                            </button>
                        ))}
                        {!NICHES.includes(activeNiche) && (
                            <button className="chip is-active">{activeNiche}</button>
                        )}
                    </div>
                    <form
                        className="tf-custom"
                        onSubmit={(e) => {
                            e.preventDefault();
                            const value = customNiche.trim().toLowerCase();
                            if (value) setActiveNiche(value.slice(0, 60));
                            setCustomNiche('');
                        }}
                    >
                        <input
                            className="input"
                            value={customNiche}
                            onChange={(e) => setCustomNiche(e.target.value)}
                            placeholder="Your niche, e.g. coffee shops"
                            aria-label="Your own niche"
                        />
                        <button type="submit" className="btn btn-secondary" disabled={!customNiche.trim()}>
                            <Search size={15} /> Go
                        </button>
                    </form>
                </div>
                <div className="tf-toolbar__row tf-toolbar__row--split">
                    <div className="segmented" role="tablist" aria-label="Platform">
                        {PLATFORM_FILTERS.map(p => (
                            <button key={p} role="tab" aria-selected={activePlatform === p} className={activePlatform === p ? 'is-active' : ''} onClick={() => setActivePlatform(p)}>
                                {p === 'Saved' && <Bookmark size={13} />}
                                {p}{p === 'Saved' && saved.length ? ` (${saved.length})` : ''}
                            </button>
                        ))}
                    </div>
                    <span className="time-ago">
                        <Clock size={13} /> {loading ? 'Loading…' : formatGeneratedAt(generatedAt)}
                    </span>
                </div>
            </section>

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

            <div className="tf-grid">
                {loading && !filteredCards.length && [...Array(6)].map((_, i) => <div key={`sk_${i}`} className="trend-card trend-card--skeleton" aria-hidden="true" />)}

                {filteredCards.map((card, i) => (
                    <article key={`${card.id}_${i}`} className="trend-card">
                        <div className="trend-card__header">
                            <span className="platform-badge">
                                <Smartphone size={13} />
                                {platformName(card.platform)}
                            </span>
                            <span className={`difficulty ${card.difficulty}`}>{card.difficulty}</span>
                        </div>

                        <h3 className="trend-title">{card.videoIdea}</h3>

                        <div className="hook-chip">
                            <CheckCircle size={14} className="hook-chip__icon" />
                            <span><strong>Hook:</strong> {card.hook}</span>
                        </div>

                        <p className="caption-preview">{card.captionPreview}</p>

                        <div className="hashtag-row">
                            {(card.hashtags || []).map((tag, idx) => (
                                <span key={idx} className="hashtag">{tag}</span>
                            ))}
                        </div>

                        <div className="trend-card__footer">
                            <div className="score" title={`AI estimate of how well this idea could perform: ${card.viralityScore}/10. Not a measured metric.`}>
                                <div className="score__bar"><div style={{ width: `${Math.max(0, Math.min(10, card.viralityScore)) * 10}%` }} /></div>
                                <span className="score__text"><Flame size={12} /> {card.viralityScore}/10</span>
                                <span className="score__label">AI estimate</span>
                            </div>
                            <div className="trend-card__actions">
                                <button
                                    className={`tf-icon-btn bookmark ${isSaved(card) ? 'active' : ''}`}
                                    title={isSaved(card) ? 'Remove from saved ideas' : 'Save this idea'}
                                    aria-label={isSaved(card) ? 'Remove from saved ideas' : 'Save this idea'}
                                    aria-pressed={isSaved(card)}
                                    onClick={() => toggleSaved(card)}
                                >
                                    <Bookmark size={17} fill={isSaved(card) ? 'currentColor' : 'none'} />
                                </button>
                                <button className="btn btn-primary btn-sm" onClick={() => createNow(card)}>
                                    <Play size={14} fill="currentColor" /> Create now
                                </button>
                            </div>
                        </div>
                    </article>
                ))}
            </div>

            {(!loading && !error && filteredCards.length === 0) && (
                <div className="surface no-cards">
                    {activePlatform === 'Saved' ? 'No saved ideas yet. Use the bookmark on a card to save it.' : 'No ideas for this niche and platform yet. Try another platform or press New ideas.'}
                </div>
            )}
        </div>
    );
}
