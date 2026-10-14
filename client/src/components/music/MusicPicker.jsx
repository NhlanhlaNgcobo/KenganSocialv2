import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Loader2, Pause, Play, X } from 'lucide-react';
import { formatDuration, musicApi, musicPreview } from '../../lib/music-api';
import './MusicPicker.css';

const VOCALS = [
    { id: '', label: 'Any vocals' },
    { id: 'female', label: 'Female vocals' },
    { id: 'male', label: 'Male vocals' },
];

const VOCAL_LABEL = { female: 'female vocals', male: 'male vocals', vocal: 'vocals' };

/**
 * Picks a background song (independent artists, CC BY / CC0): a genre and vocals for automatic
 * selection, or one specific song after previewing.
 *
 * value: { genre, vocals, track } where genre is a song genre id and track is a Song or null.
 * auto:  { genre, genreName } used when genre is empty ("match the tone").
 */
export default function MusicPicker({ value, onChange, disabled, auto, minSeconds = 0 }) {
    const [meta, setMeta] = useState(null);
    const [browsing, setBrowsing] = useState(false);
    const [tracks, setTracks] = useState([]);
    const [loading, setLoading] = useState(false);
    const [previewing, setPreviewing] = useState(null);
    const [error, setError] = useState('');
    const request = useRef(0);
    const playing = useSyncExternalStore(musicPreview.subscribe, musicPreview.current);

    useEffect(() => {
        musicApi.songGenres().then(setMeta).catch((err) => setError(err.message));
        return () => musicPreview.stop();
    }, []);

    const genre = value.genre || auto?.genre || '';
    const vocals = value.vocals || 'any';

    useEffect(() => {
        if (!browsing) return;
        const id = ++request.current;
        setLoading(true);
        setError('');
        musicApi
            .searchSongs({ genre, vocals })
            .then((page) => {
                if (id !== request.current) return;
                setTracks(page.tracks.filter((t) => t.duration >= minSeconds).slice(0, 12));
            })
            .catch((err) => id === request.current && setError(err.message))
            .finally(() => id === request.current && setLoading(false));
    }, [browsing, genre, vocals, minSeconds]);

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
                        <option value="">{auto?.genreName ? `Match the tone (${auto.genreName})` : 'Any genre'}</option>
                        {meta?.genres.map((g) => (
                            <option key={g.id} value={g.id}>
                                {g.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="field">
                    <span>Vocals</span>
                    <select className="input" value={value.vocals} onChange={(e) => update({ vocals: e.target.value })} disabled={disabled}>
                        {VOCALS.map((v) => (
                            <option key={v.id} value={v.id}>
                                {v.label}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            {value.track ? (
                <div className="music-picked">
                    <Check size={14} />
                    <span>
                        <strong>{value.track.title}</strong> by {value.track.artist}, {formatDuration(value.track.duration)}
                    </span>
                    <button className="btn-icon btn-sm" onClick={() => onChange({ ...value, track: null })} disabled={disabled} title="Let it pick automatically" aria-label="Remove chosen song">
                        <X size={14} />
                    </button>
                </div>
            ) : (
                <p className="music-hint">A matching song is picked for each video. Re-rolls pick a different one.</p>
            )}

            <button className="music-browse-toggle" onClick={() => setBrowsing((b) => !b)} disabled={disabled} type="button">
                {browsing ? 'Hide songs' : 'Choose a specific song'}
            </button>

            {browsing ? (
                <div className="music-tracks">
                    {loading ? (
                        <p className="music-hint">
                            <Loader2 size={13} className="spin" /> Loading songs…
                        </p>
                    ) : null}
                    {!loading && !tracks.length ? <p className="music-hint">No songs long enough for this genre and vocals.</p> : null}
                    {tracks.map((track) => {
                        const chosen = value.track?.id === track.id;
                        return (
                            <div key={track.id} className={`music-track ${chosen ? 'is-chosen' : ''} ${playing === track.id ? 'is-playing' : ''}`} title={track.credit}>
                                <button className="btn-icon btn-sm" onClick={() => preview(track)} aria-label={playing === track.id ? 'Pause' : 'Preview'} disabled={!!previewing && previewing !== track.id}>
                                    {previewing === track.id ? <Loader2 size={14} className="spin" /> : playing === track.id ? <Pause size={14} /> : <Play size={14} />}
                                </button>
                                <div className="music-track__meta">
                                    <strong>{track.title}</strong>
                                    <small>
                                        {track.artist}, {VOCAL_LABEL[track.vocals]}, {formatDuration(track.duration)}
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
            <p className="music-hint">Songs by independent artists on ccMixter and Jamendo, free for commercial use (CC BY / CC0). The credit is added to your caption.</p>
        </div>
    );
}
