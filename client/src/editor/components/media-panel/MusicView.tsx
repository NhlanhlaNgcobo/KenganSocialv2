import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Copy, Loader2, Pause, Play, Plus, Search } from 'lucide-react';
import { formatDuration, musicApi, musicPreview, type LibraryQuery, type LibrarySummary, type LibraryTrack } from '../../../lib/music-api';
import { editorApi, type StockAsset } from '../../lib/editor-api';
import { useMediaStore } from '../../stores/media-store';
import { usePlaybackStore } from '../../stores/playback-store';
import { useProjectStore } from '../../stores/project-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';
import { AudiomackBrowser, UploadMusic } from './MusicSources';

type Source = 'upload' | 'library' | 'openverse' | 'audiomack';

const SOURCES: { id: Source; label: string }[] = [
    { id: 'upload', label: 'Upload' },
    { id: 'library', label: 'Library' },
    { id: 'openverse', label: 'Openverse' },
    { id: 'audiomack', label: 'Audiomack' },
];

const LENGTHS: { id: NonNullable<LibraryQuery['length']>; label: string }[] = [
    { id: '', label: 'Any length' },
    { id: 'short', label: 'Under 1 min' },
    { id: 'medium', label: '1–3 min' },
    { id: 'long', label: 'Over 3 min' },
];

const safeName = (title: string) => title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60).trim() || 'music';

function usePreviewId() {
    return useSyncExternalStore(musicPreview.subscribe, musicPreview.current);
}

/** Adds an mp3 blob to the project and drops it on the timeline at the playhead. */
async function addToTimeline(blob: Blob, title: string, projectKey: string) {
    const file = new File([blob], `${safeName(title)}.mp3`, { type: 'audio/mpeg' });
    const [item] = await useMediaStore.getState().addFiles([file], projectKey);
    if (!item) throw new Error('The file could not be read.');
    useTimelineStore.getState().addMediaAtTime(item, usePlaybackStore.getState().currentTime);
}

export function MusicView() {
    const [source, setSource] = useState<Source>('library');

    useEffect(() => () => musicPreview.stop(), []);

    return (
        <div className="ke-view">
            <div className="ke-view__head">
                <h3>Music</h3>
            </div>
            <div className="ke-seg ke-seg--text">
                {SOURCES.map((s) => (
                    <button key={s.id} className={source === s.id ? 'is-active' : ''} onClick={() => setSource(s.id)}>
                        {s.label}
                    </button>
                ))}
            </div>
            {source === 'upload' ? <UploadMusic /> : null}
            {source === 'library' ? <LibraryBrowser /> : null}
            {source === 'openverse' ? <OpenverseBrowser /> : null}
            {source === 'audiomack' ? <AudiomackBrowser /> : null}
        </div>
    );
}

function LibraryBrowser() {
    const [summary, setSummary] = useState<LibrarySummary | null>(null);
    const [filters, setFilters] = useState<LibraryQuery>({ genre: '', mood: '', q: '', length: '' });
    const [query, setQuery] = useState('');
    const [tracks, setTracks] = useState<LibraryTrack[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [copied, setCopied] = useState<string | null>(null);
    const request = useRef(0);
    const previewId = usePreviewId();
    const notify = useUiStore((s) => s.notify);
    const projectKey = useProjectStore((s) => s.projectKey);

    useEffect(() => {
        musicApi.summary().then(setSummary).catch((error) => notify(error.message, 'error'));
    }, [notify]);

    const load = async (next: LibraryQuery, pageNumber = 1) => {
        const id = ++request.current;
        setLoading(true);
        try {
            const result = await musicApi.search({ ...next, page: pageNumber });
            if (id !== request.current) return;
            setTracks((prev) => (pageNumber === 1 ? result.tracks : [...prev, ...result.tracks]));
            setTotal(result.total);
            setPage(pageNumber);
            setHasMore(result.hasMore);
        } catch (error) {
            if (id === request.current) notify((error as Error).message, 'error');
        } finally {
            if (id === request.current) setLoading(false);
        }
    };

    useEffect(() => {
        load(filters);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters]);

    const update = (patch: Partial<LibraryQuery>) => setFilters((f) => ({ ...f, ...patch }));

    const preview = async (track: LibraryTrack) => {
        setBusy(`preview:${track.id}`);
        try {
            await musicPreview.toggle(track);
        } catch (error) {
            notify(`Preview failed: ${(error as Error).message}`, 'error');
        } finally {
            setBusy(null);
        }
    };

    const add = async (track: LibraryTrack) => {
        if (!projectKey) return;
        setBusy(track.id);
        try {
            const url = await musicPreview.objectUrl(track);
            await addToTimeline(await (await fetch(url)).blob(), track.title, projectKey);
            notify(`Added “${track.title}”. Credit it in your caption: ${track.credit}`, 'success');
        } catch (error) {
            notify(`Could not add the track: ${(error as Error).message}`, 'error');
        } finally {
            setBusy(null);
        }
    };

    const copyCredit = async (track: LibraryTrack) => {
        try {
            await navigator.clipboard.writeText(track.credit);
            setCopied(track.id);
            setTimeout(() => setCopied((c) => (c === track.id ? null : c)), 1500);
        } catch {
            notify(track.credit);
        }
    };

    return (
        <>
            <form
                className="ke-search"
                onSubmit={(e) => {
                    e.preventDefault();
                    update({ q: query.trim() });
                }}
            >
                <Search size={14} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, instrument, feel…" aria-label="Search music" />
                <button className="ke-btn ke-btn--sm" type="submit" disabled={loading}>
                    Search
                </button>
            </form>

            <div className="ke-music-filters">
                <select className="ke-select ke-select--sm" value={filters.genre} onChange={(e) => update({ genre: e.target.value })} aria-label="Genre">
                    <option value="">All genres</option>
                    {summary?.genres.map((g) => (
                        <option key={g.id} value={g.name}>
                            {g.name} ({g.count})
                        </option>
                    ))}
                </select>
                <select className="ke-select ke-select--sm" value={filters.length} onChange={(e) => update({ length: e.target.value as LibraryQuery['length'] })} aria-label="Length">
                    {LENGTHS.map((l) => (
                        <option key={l.id} value={l.id}>
                            {l.label}
                        </option>
                    ))}
                </select>
            </div>

            <div className="ke-chip-row ke-music-moods" role="group" aria-label="Mood">
                <button className={`ke-chip ${!filters.mood ? 'is-active' : ''}`} onClick={() => update({ mood: '' })}>
                    Any mood
                </button>
                {summary?.moods.map((m) => (
                    <button key={m.name} className={`ke-chip ${filters.mood === m.name ? 'is-active' : ''}`} onClick={() => update({ mood: filters.mood === m.name ? '' : m.name })}>
                        {m.name}
                    </button>
                ))}
            </div>

            <p className="ke-muted ke-music-count">{loading && page === 1 ? 'Loading…' : `${total} track${total === 1 ? '' : 's'}`}</p>

            <div className="ke-list">
                {tracks.map((track) => (
                    <div key={track.id} className={`ke-list__item ke-stock-track ${previewId === track.id ? 'is-playing' : ''}`} title={track.description}>
                        <button className="ke-icon-btn" title={previewId === track.id ? 'Pause' : 'Preview'} onClick={() => preview(track)} disabled={!!busy && busy !== `preview:${track.id}`}>
                            {busy === `preview:${track.id}` ? <Loader2 size={14} className="ke-spin" /> : previewId === track.id ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                        <div className="ke-stock-track__meta">
                            <strong>{track.title}</strong>
                            <p>
                                {track.genre}
                                {track.moods.length ? ` · ${track.moods.slice(0, 2).join(', ')}` : ''}
                                {track.bpm ? ` · ${track.bpm} bpm` : ''} · {formatDuration(track.duration)}
                            </p>
                        </div>
                        <button className="ke-icon-btn ke-icon-btn--xs" title="Copy credit line" onClick={() => copyCredit(track)}>
                            {copied === track.id ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                        <button className="ke-icon-btn" title="Add to timeline at the playhead" onClick={() => add(track)} disabled={!!busy}>
                            {busy === track.id ? <Loader2 size={14} className="ke-spin" /> : <Plus size={14} />}
                        </button>
                    </div>
                ))}
            </div>

            {!loading && tracks.length === 0 ? <p className="ke-note">No tracks match. Try another genre or mood.</p> : null}
            {hasMore ? (
                <button className="ke-btn ke-btn--ghost ke-btn--block" onClick={() => load(filters, page + 1)} disabled={loading}>
                    {loading ? <Loader2 size={13} className="ke-spin" /> : 'Load more'}
                </button>
            ) : null}

            <p className="ke-note">
                {summary ? `${summary.total} tracks by Kevin MacLeod (incompetech.com). ` : ''}Free to use commercially under CC BY 4.0: put the credit line in your caption or description.
            </p>
        </>
    );
}

function OpenverseBrowser() {
    const [query, setQuery] = useState('');
    const [items, setItems] = useState<StockAsset[]>([]);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [playing, setPlaying] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const cache = useRef(new Map<string, string>());
    const notify = useUiStore((s) => s.notify);
    const projectKey = useProjectStore((s) => s.projectKey);

    const search = async (q: string) => {
        setLoading(true);
        try {
            setItems((await editorApi.searchAssets('music', q.trim() || 'upbeat')).assets);
        } catch (error) {
            notify((error as Error).message, 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        musicPreview.stop();
        search('');
        const urls = cache.current;
        return () => {
            audioRef.current?.pause();
            urls.forEach((url) => URL.revokeObjectURL(url));
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const blobUrl = async (asset: StockAsset) => {
        let url = cache.current.get(asset.id);
        if (!url) {
            url = URL.createObjectURL(await editorApi.downloadAsset(asset.fileUrl));
            cache.current.set(asset.id, url);
        }
        return url;
    };

    const toggle = async (asset: StockAsset) => {
        if (playing === asset.id) {
            audioRef.current?.pause();
            setPlaying(null);
            return;
        }
        setBusy(`preview:${asset.id}`);
        try {
            audioRef.current?.pause();
            const audio = new Audio(await blobUrl(asset));
            audio.onended = () => setPlaying(null);
            audioRef.current = audio;
            await audio.play();
            setPlaying(asset.id);
        } catch (error) {
            notify(`Preview failed: ${(error as Error).message}`, 'error');
        } finally {
            setBusy(null);
        }
    };

    const add = async (asset: StockAsset) => {
        if (!projectKey) return;
        setBusy(asset.id);
        try {
            await addToTimeline(await (await fetch(await blobUrl(asset))).blob(), asset.title, projectKey);
            notify(asset.attribution ? `Added. Credit required: ${asset.attribution.split('. To view')[0]}` : 'Added to the timeline.', 'success');
        } catch (error) {
            notify(`Could not import: ${(error as Error).message}`, 'error');
        } finally {
            setBusy(null);
        }
    };

    return (
        <>
            <form
                className="ke-search"
                onSubmit={(e) => {
                    e.preventDefault();
                    search(query);
                }}
            >
                <Search size={14} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. lofi, cinematic, acoustic" aria-label="Search Openverse" />
                <button className="ke-btn ke-btn--sm" type="submit" disabled={loading}>
                    {loading ? <Loader2 size={13} className="ke-spin" /> : 'Search'}
                </button>
            </form>
            {!loading && items.length === 0 ? <p className="ke-note">No results. Try another search.</p> : null}
            <div className="ke-list">
                {items.map((asset) => (
                    <div key={asset.id} className="ke-list__item ke-stock-track">
                        <button className="ke-icon-btn" title={playing === asset.id ? 'Pause' : 'Preview'} onClick={() => toggle(asset)} disabled={!!busy && busy !== `preview:${asset.id}`}>
                            {busy === `preview:${asset.id}` ? <Loader2 size={14} className="ke-spin" /> : playing === asset.id ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                        <div className="ke-stock-track__meta">
                            <strong>{asset.title}</strong>
                            <p>
                                {asset.artist}
                                {asset.duration ? ` · ${formatDuration(asset.duration)}` : ''} · {asset.license}
                            </p>
                        </div>
                        <button className="ke-icon-btn" title="Add to timeline at the playhead" onClick={() => add(asset)} disabled={!!busy}>
                            {busy === asset.id ? <Loader2 size={14} className="ke-spin" /> : <Plus size={14} />}
                        </button>
                    </div>
                ))}
            </div>
            <p className="ke-note">Openverse searches Creative Commons audio from many sites (limited to 200 searches a day). Licences vary; the credit line is shown when you add a track.</p>
        </>
    );
}
