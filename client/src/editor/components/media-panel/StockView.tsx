import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Plus, Search, Video } from 'lucide-react';
import { editorApi, type StockAsset } from '../../lib/editor-api';
import { formatShort } from '../../lib/time';
import { useMediaStore } from '../../stores/media-store';
import { usePlaybackStore } from '../../stores/playback-store';
import { useProjectStore } from '../../stores/project-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';

type Kind = 'images' | 'broll';

const KINDS: { id: Kind; label: string; icon: typeof Video; placeholder: string; starter: string }[] = [
    { id: 'images', label: 'Images', icon: ImageIcon, placeholder: 'e.g. city night, coffee', starter: 'city skyline' },
    { id: 'broll', label: 'Video', icon: Video, placeholder: 'e.g. ocean waves, office', starter: 'city' },
];

const EXTENSIONS: Record<Kind, string> = { images: 'jpg', broll: 'mp4' };

export function StockView() {
    const [kind, setKind] = useState<Kind>('images');
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Record<Kind, StockAsset[]>>({ images: [], broll: [] });
    const [notice, setNotice] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [adding, setAdding] = useState<string | null>(null);
    const previewCache = useRef(new Map<string, string>());
    const notify = useUiStore((s) => s.notify);
    const projectKey = useProjectStore((s) => s.projectKey);
    const ratio = useProjectStore((s) => s.ratio);

    const search = async (k: Kind = kind, q: string = query) => {
        setLoading(true);
        setNotice(null);
        try {
            const orientation = k === 'broll' ? (ratio === '9:16' ? 'portrait' : ratio === '1:1' ? 'square' : 'landscape') : undefined;
            const data = await editorApi.searchAssets(k, q.trim() || KINDS.find((x) => x.id === k)!.starter, orientation);
            setResults((r) => ({ ...r, [k]: data.assets }));
            setNotice(data.notice);
        } catch (error) {
            notify((error as Error).message, 'error');
        } finally {
            setLoading(false);
        }
    };

    // Show something useful the first time each tab opens.
    useEffect(() => {
        if (!results[kind].length) search(kind, query);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind]);

    useEffect(
        () => () => {
            previewCache.current.forEach((url) => URL.revokeObjectURL(url));
        },
        []
    );

    const add = async (asset: StockAsset) => {
        if (!projectKey) return;
        setAdding(asset.id);
        try {
            const cachedUrl = previewCache.current.get(asset.id);
            const blob = cachedUrl ? await (await fetch(cachedUrl)).blob() : await editorApi.downloadAsset(asset.fileUrl);
            const safeTitle = asset.title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60).trim() || 'stock';
            const fallbackType = kind === 'images' ? 'image/jpeg' : 'video/mp4';
            const file = new File([blob], `${safeTitle}.${EXTENSIONS[kind]}`, { type: blob.type && blob.type !== 'application/octet-stream' ? blob.type : fallbackType });
            const [item] = await useMediaStore.getState().addFiles([file], projectKey);
            if (!item) throw new Error('The file could not be read.');
            useTimelineStore.getState().addMediaAtTime(item, usePlaybackStore.getState().currentTime);
            notify(asset.attribution ? `Added. Credit required: ${asset.attribution.split('. To view')[0]}` : 'Added to the timeline.', 'success');
        } catch (error) {
            notify(`Could not import: ${(error as Error).message}`, 'error');
        } finally {
            setAdding(null);
        }
    };

    const active = KINDS.find((k) => k.id === kind)!;
    const items = results[kind];

    return (
        <div className="ke-view">
            <div className="ke-view__head">
                <h3>Stock</h3>
            </div>

            <div className="ke-chip-row">
                {KINDS.map((k) => (
                    <button key={k.id} className={`ke-chip ${kind === k.id ? 'is-active' : ''}`} onClick={() => setKind(k.id)}>
                        <k.icon size={13} /> {k.label}
                    </button>
                ))}
            </div>

            <form
                className="ke-search"
                onSubmit={(e) => {
                    e.preventDefault();
                    search();
                }}
            >
                <Search size={14} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={active.placeholder} />
                <button className="ke-btn ke-btn--sm" type="submit" disabled={loading}>
                    {loading ? <Loader2 size={13} className="ke-spin" /> : 'Search'}
                </button>
            </form>

            {notice ? <p className="ke-note">{notice}</p> : null}
            {!loading && !notice && items.length === 0 ? <p className="ke-note">No results. Try another search.</p> : null}

            <div className="ke-media-grid">
                {items.map((asset) => (
                    <div key={asset.id} className="ke-media-card" title={asset.attribution || asset.title}>
                        <div className="ke-media-card__thumb">
                            {asset.thumb ? <img src={asset.thumb} alt="" draggable={false} loading="lazy" /> : null}
                            {asset.duration ? <span className="ke-media-card__dur">{formatShort(asset.duration)}</span> : null}
                            <div className="ke-media-card__actions is-visible">
                                <button className="ke-icon-btn ke-icon-btn--xs" title="Add to timeline at the playhead" onClick={() => add(asset)} disabled={!!adding}>
                                    {adding === asset.id ? <Loader2 size={12} className="ke-spin" /> : <Plus size={12} />}
                                </button>
                            </div>
                        </div>
                        <span className="ke-media-card__name">{asset.title}</span>
                        <small className="ke-muted">{asset.license}</small>
                    </div>
                ))}
            </div>

            <p className="ke-note">
                Images come from Openverse (Creative Commons, free for commercial use) and video from Pexels. Most images need a credit — it is shown when you add one. Music has its own tab.
            </p>
        </div>
    );
}
