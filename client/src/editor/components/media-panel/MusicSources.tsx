import { useEffect, useRef, useState } from 'react';
import { CloudUpload, ExternalLink, Loader2, Pause, Play, Plus, Search, X } from 'lucide-react';
import { audiomackApi, type AudiomackTrack } from '../../../lib/audiomack-api';
import { formatDuration, musicPreview } from '../../../lib/music-api';
import { useGuideTrackStore } from '../../stores/guide-track-store';
import { useMediaStore } from '../../stores/media-store';
import { usePlaybackStore } from '../../stores/playback-store';
import { useProjectStore } from '../../stores/project-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';

const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac';
const AUDIO_NAME = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;

/** Your own track: goes onto an audio track at the playhead and is included in the export. */
export function UploadMusic() {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);
    const [busy, setBusy] = useState(false);
    const notify = useUiStore((s) => s.notify);
    const projectKey = useProjectStore((s) => s.projectKey);

    const importFile = async (file: File | undefined) => {
        if (!file || !projectKey) return;
        if (!file.type.startsWith('audio/') && !AUDIO_NAME.test(file.name)) {
            notify('Choose an audio file (mp3, wav, m4a, aac, ogg, or flac).', 'error');
            return;
        }
        setBusy(true);
        try {
            const [item] = await useMediaStore.getState().addFiles([file], projectKey);
            if (!item) throw new Error('The file could not be read.');
            useTimelineStore.getState().addMediaAtTime(item, usePlaybackStore.getState().currentTime);
            notify(`Added “${file.name}” to the timeline. Open the Lyrics tab to build a lyric visualizer.`, 'success');
        } catch (error) {
            notify(`Could not add the track: ${(error as Error).message}`, 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                accept={AUDIO_ACCEPT}
                hidden
                onChange={(e) => {
                    void importFile(e.target.files?.[0]);
                    e.target.value = '';
                }}
            />
            <button
                className="ke-dropzone"
                style={dragOver ? { borderColor: 'var(--ke-accent)' } : undefined}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    void importFile(e.dataTransfer.files[0]);
                }}
                disabled={busy}
            >
                {busy ? <Loader2 size={22} className="ke-spin" /> : <CloudUpload size={22} />}
                <strong>Upload music or audio</strong>
                <span>MP3, WAV, M4A, AAC, OGG or FLAC. Added at the playhead.</span>
            </button>
            <p className="ke-note">Only upload music you have the rights to use in your posts.</p>
        </>
    );
}

/**
 * Audiomack search. A picked track plays along with the preview as a guide
 * track but is never added to the timeline or export (Audiomack streams are playback-only).
 */
export function AudiomackBrowser() {
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [query, setQuery] = useState('');
    const [tracks, setTracks] = useState<AudiomackTrack[]>([]);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [playing, setPlaying] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const notify = useUiStore((s) => s.notify);
    const guide = useGuideTrackStore();

    useEffect(() => {
        musicPreview.stop();
        audiomackApi
            .status()
            .then((s) => setConfigured(s.configured))
            .catch(() => setConfigured(false));
        return () => audioRef.current?.pause();
    }, []);

    const search = async (q: string) => {
        if (q.trim().length < 2) return;
        setLoading(true);
        try {
            const result = await audiomackApi.search(q.trim());
            setConfigured(result.configured);
            setTracks(result.tracks);
            if (!result.tracks.length) notify('No songs found. Try another search.');
        } catch (error) {
            notify((error as Error).message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const toggle = async (track: AudiomackTrack) => {
        if (playing === track.id) {
            audioRef.current?.pause();
            setPlaying(null);
            return;
        }
        setBusy(`preview:${track.id}`);
        try {
            audioRef.current?.pause();
            // Play URLs expire within seconds, so fetch one right before playing.
            const audio = new Audio(await audiomackApi.playUrl(track.id));
            audio.onended = () => setPlaying(null);
            audioRef.current = audio;
            await audio.play();
            setPlaying(track.id);
        } catch (error) {
            notify(`Preview failed: ${(error as Error).message}`, 'error');
        } finally {
            setBusy(null);
        }
    };

    const playAlong = async (track: AudiomackTrack) => {
        audioRef.current?.pause();
        setPlaying(null);
        setBusy(track.id);
        try {
            await guide.load(track);
            notify(`“${track.title}” will play along with the preview. It isn't included in exports.`, 'success');
        } catch (error) {
            notify((error as Error).message, 'error');
        } finally {
            setBusy(null);
        }
    };

    if (configured === null) {
        return (
            <p className="ke-note">
                <Loader2 size={13} className="ke-spin" /> Checking Audiomack connection…
            </p>
        );
    }

    if (!configured) {
        return (
            <div className="ke-note">
                <p>
                    <strong>Audiomack isn't connected yet.</strong> Request Data API access from Audiomack, then set AUDIOMACK_CONSUMER_KEY and AUDIOMACK_CONSUMER_SECRET in
                    server/.env and restart the server.
                </p>
                <a className="ke-link" href="https://audiomack.com/data-api/docs" target="_blank" rel="noreferrer">
                    Audiomack Data API docs <ExternalLink size={11} />
                </a>
            </div>
        );
    }

    return (
        <>
            {guide.track ? (
                <div className="ke-subpanel">
                    <div className="ke-guide-card">
                        {guide.track.artworkUrl ? <img src={guide.track.artworkUrl} alt="" /> : null}
                        <div className="ke-stock-track__meta">
                            <strong>{guide.track.title}</strong>
                            <p>{guide.track.artist} · playing along</p>
                        </div>
                        <button className="ke-icon-btn" title="Remove guide track" onClick={guide.clear}>
                            <X size={14} />
                        </button>
                    </div>
                    <label className="ke-range">
                        <span>Song starts at</span>
                        <input
                            type="range"
                            min={0}
                            max={Math.max(0, Math.floor(guide.duration) - 1)}
                            step={0.5}
                            value={guide.offset}
                            onChange={(e) => guide.setOffset(Number(e.target.value))}
                        />
                        <strong>{formatDuration(guide.offset)}</strong>
                    </label>
                    <label className="ke-range">
                        <span>Volume</span>
                        <input type="range" min={0} max={1} step={0.05} value={guide.volume} onChange={(e) => guide.setVolume(Number(e.target.value))} />
                        <strong>{Math.round(guide.volume * 100)}%</strong>
                    </label>
                    {guide.error ? <div className="ke-alert ke-alert--error">{guide.error}</div> : null}
                    {guide.track.permalink ? (
                        <a className="ke-link" href={guide.track.permalink} target="_blank" rel="noreferrer">
                            Open on Audiomack <ExternalLink size={11} />
                        </a>
                    ) : null}
                </div>
            ) : null}

            <form
                className="ke-search"
                onSubmit={(e) => {
                    e.preventDefault();
                    void search(query);
                }}
            >
                <Search size={14} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search songs or artists" aria-label="Search Audiomack" />
                <button className="ke-btn ke-btn--sm" type="submit" disabled={loading || query.trim().length < 2}>
                    {loading ? <Loader2 size={13} className="ke-spin" /> : 'Search'}
                </button>
            </form>

            <div className="ke-list">
                {tracks.map((track) => (
                    <div key={track.id} className={`ke-list__item ke-stock-track ${playing === track.id ? 'is-playing' : ''}`}>
                        <button
                            className="ke-icon-btn"
                            title={playing === track.id ? 'Pause' : 'Preview'}
                            onClick={() => toggle(track)}
                            disabled={!!busy && busy !== `preview:${track.id}`}
                        >
                            {busy === `preview:${track.id}` ? <Loader2 size={14} className="ke-spin" /> : playing === track.id ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                        {track.artworkUrl ? <img className="ke-stock-track__art" src={track.artworkUrl} alt="" /> : null}
                        <div className="ke-stock-track__meta">
                            <strong>{track.title}</strong>
                            <p>
                                {track.artist}
                                {track.genre ? ` · ${track.genre}` : ''}
                                {track.durationSec ? ` · ${formatDuration(track.durationSec)}` : ''}
                            </p>
                        </div>
                        <button className="ke-icon-btn" title="Play along with the preview" onClick={() => playAlong(track)} disabled={!!busy}>
                            {busy === track.id ? <Loader2 size={14} className="ke-spin" /> : <Plus size={14} />}
                        </button>
                    </div>
                ))}
            </div>

            <p className="ke-note">
                Audiomack songs play along with your preview so you can cut to the beat. They aren't downloaded or included in exports, so add the licensed sound in TikTok
                or Instagram when you post.
            </p>
        </>
    );
}
