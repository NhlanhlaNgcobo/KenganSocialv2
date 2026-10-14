import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Loader2, Pause, Play, X } from 'lucide-react';
import { formatDuration, musicApi, musicPreview } from '../../lib/music-api';
import './MusicPicker.css';

/**
 * Picks background music from the royalty-free library: a genre and mood for automatic
 * selection, or one specific track after previewing.
 *
 * value: { genre, mood, track } where track is a LibraryTrack or null.
 * auto:  { genre, mood } used when genre and mood are empty ("match the tone").
 */
export default function MusicPicker({ value, onChange, disabled, auto, minSeconds = 0 }) {
    const [summary, setSummary] = useState(null);
    const [browsing, setBrowsing] = useState(false);
    const [tracks, setTracks] = useState([]);
    const [loading, setLoading] = useState(false);
    const [previewing, setPreviewing] = useState(null);
    const [error, setError] = useState('');
    const request = useRef(0);
    const playing = useSyncExternalStore(musicPreview.subscribe, musicPreview.current);

    useEffect(() => {
        musicApi.summary().then(setSummary).catch((err) => setError(err.message));
        return () => musicPreview.stop();
    }, []);

    const genre = value.genre || (value.mood ? '' : auto?.genre || '');
    const mood = value.mood || (value.genre ? '' : auto?.mood || '');

    useEffect(() => {
        if (!browsing) return;
        const id = ++request.current;
        setLoading(true);
        setError('');
        musicApi
            .search({ genre, mood })
            .then((page) => {
                if (id !== request.current) return;
                setTracks(page.tracks.filter((t) => t.duration >= minSeconds && t.genre !== 'Stings').slice(0, 12));
            })
            .catch((err) => id === request.current && setError(err.message))
            .finally(() => id === request.current && setLoading(false));
    }, [browsing, genre, mood, minSeconds]);

    const preview = async (track) => {
        setPreviewing(track.id);
        try {
            await musicPreview.toggle(track);
        } catch (err) {
            setError(`Preview failed: ${err.message}`);
        } finally {
            setPreviewing(null);
        }
    };

    const update = (patch) => onChange({ ...value, track: null, ...patch });

    return (
        <div className="music-picker">
            <div className="field-row">
                <label className="field">
                    <span>Genre</span>
                    <select className="input" value={value.genre} onChange={(e) => update({ genre: e.target.value })} disabled={disabled}>
                        <option value="">{auto?.genre ? `Match the tone (${auto.genre})` : 'Any genre'}</option>
                        {summary?.genres
                            .filter((g) => g.name !== 'Stings')
                            .map((g) => (
                                <option key={g.id} value={g.name}>
                                    {g.name}
                                </option>
                            ))}
                    </select>
                </label>
                <label className="field">
                    <span>Mood</span>
                    <select className="input" value={value.mood} onChange={(e) => update({ mood: e.target.value })} disabled={disabled}>
                        <option value="">{auto?.mood && !value.genre ? `Match the tone (${auto.mood})` : 'Any mood'}</option>
                        {summary?.moods.map((m) => (
                            <option key={m.name} value={m.name}>
                                {m.name}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            {value.track ? (
                <div className="music-picked">
                    <Check size={14} />
                    <span>
                        <strong>{value.track.title}</strong>, {value.track.genre}, {formatDuration(value.track.duration)}
                    </span>
                    <button className="btn-icon btn-sm" onClick={() => onChange({ ...value, track: null })} disabled={disabled} title="Let it pick automatically" aria-label="Remove chosen track">
                        <X size={14} />
                    </button>
                </div>
            ) : (
                <p className="music-hint">A matching track is picked for each video. Re-rolls pick a different one.</p>
            )}

            <button className="music-browse-toggle" onClick={() => setBrowsing((b) => !b)} disabled={disabled} type="button">
                {browsing ? 'Hide tracks' : 'Choose a specific track'}
            </button>

            {browsing ? (
                <div className="music-tracks">
                    {loading ? <p className="music-hint"><Loader2 size={13} className="spin" /> Loading tracks…</p> : null}
                    {!loading && !tracks.length ? <p className="music-hint">No tracks long enough for this genre and mood.</p> : null}
                    {tracks.map((track) => {
                        const chosen = value.track?.id === track.id;
                        return (
                            <div key={track.id} className={`music-track ${chosen ? 'is-chosen' : ''} ${playing === track.id ? 'is-playing' : ''}`} title={track.description}>
                                <button className="btn-icon btn-sm" onClick={() => preview(track)} aria-label={playing === track.id ? 'Pause' : 'Preview'} disabled={!!previewing && previewing !== track.id}>
                                    {previewing === track.id ? <Loader2 size={14} className="spin" /> : playing === track.id ? <Pause size={14} /> : <Play size={14} />}
                                </button>
                                <div className="music-track__meta">
                                    <strong>{track.title}</strong>
                                    <small>
                                        {track.genre}
                                        {track.moods.length ? `, ${track.moods.slice(0, 2).join(', ').toLowerCase()}` : ''}, {formatDuration(track.duration)}
                                    </small>
                                </div>
                                <button className={`chip ${chosen ? 'is-active' : ''}`} onClick={() => onChange({ ...value, track: chosen ? null : track })} disabled={disabled}>
                                    {chosen ? 'Chosen' : 'Use'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            ) : null}

            {error ? <p className="music-hint is-error">{error}</p> : null}
            <p className="music-hint">
                From {summary ? `${summary.total} tracks by` : ''} Kevin MacLeod (incompetech.com), CC BY 4.0. The credit is added to your caption.
            </p>
        </div>
    );
}
