import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Clapperboard, FileText, Hand, Loader2, Music2, Scissors, Search, Sparkles, Upload, Wand2 } from 'lucide-react';
import { formatDuration } from '../../../lib/music-api';
import { CAPTION_TEMPLATES } from '../../lib/caption-templates';
import { editorApi, type StockAsset } from '../../lib/editor-api';
import { apiClient } from '../../../lib/api';
import { TIMING_LABELS } from '../../lib/lyrics';
import {
    coverScale,
    loadLoopPresets,
    loopFileFor,
    looksLikeLrc,
    looksLikeSrt,
    lyricElements,
    parseLrc,
    parseSrt,
    placeLyrics,
    splitLyricLines,
    STOCK_LOOP_QUERIES,
    toAnalysis,
    type LoopPreset,
    type TimedLine,
} from '../../lib/lyric-video';
import { getElementEnd } from '../../lib/time';
import { useLyricsStore, songTimeAt, timelineTimeOf } from '../../stores/lyrics-store';
import { useMediaStore } from '../../stores/media-store';
import { usePlaybackStore } from '../../stores/playback-store';
import { getCanvasSize, useProjectStore } from '../../stores/project-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';
import type { MediaElement, MediaItem } from '../../types';
import { CaptionSample } from './CaptionSample';

type Background = { kind: 'loop'; preset: LoopPreset } | { kind: 'stock'; asset: StockAsset } | null;
type Method = 'paste' | 'sync' | 'tap' | 'file' | 'ai';

const METHODS: { id: Method; label: string; icon: typeof Wand2; note: string }[] = [
    { id: 'paste', label: 'Place automatically', icon: FileText, note: 'Free. Paste or type the lyrics; they are spread over the sung part of the song. Good for a quick draft, then fine-tune.' },
    { id: 'sync', label: 'Sync to vocals', icon: AudioLines, note: 'Uses 3 AI credits. Keeps your exact words and lines, and starts each line when it is actually sung.' },
    { id: 'tap', label: 'Tap along', icon: Hand, note: 'Free and exact. Paste the lyrics, play the song and tap as each line starts.' },
    { id: 'file', label: '.srt / .lrc file', icon: Upload, note: 'Free. Uses the exact times in the file.' },
    { id: 'ai', label: 'AI writes them', icon: Sparkles, note: 'Uses 17 AI credits. No lyrics needed: the AI listens, writes the lyrics and times every word.' },
];

/**
 * Lyric video generator: a song, a looping background (our animated presets or loop-friendly
 * stock), lyrics timed for free or by AI, and a caption template. "Build" lays it all on the
 * timeline; the normal export renders it.
 */
export function LyricVideoView() {
    const tracks = useTimelineStore((s) => s.tracks);
    const items = useMediaStore((s) => s.items);
    const projectKey = useProjectStore((s) => s.projectKey);
    const ratio = useProjectStore((s) => s.ratio);
    const notify = useUiStore((s) => s.notify);
    const { source, analysis, analyzing, setSource, setLyricsText, analyze, syncToVocals, setAnalysis, songInfo, nudge } = useLyricsStore();
    const canvas = getCanvasSize(ratio);

    const [presets, setPresets] = useState<LoopPreset[]>([]);
    const [bgTab, setBgTab] = useState<'loops' | 'stock'>('loops');
    const [background, setBackground] = useState<Background>(null);
    const [stockQuery, setStockQuery] = useState(STOCK_LOOP_QUERIES[0].query);
    const [stock, setStock] = useState<StockAsset[]>([]);
    const [stockNotice, setStockNotice] = useState<string | null>(null);
    const [method, setMethod] = useState<Method>('paste');
    const [text, setText] = useState('');
    const [templateId, setTemplateId] = useState('bold');
    const [hoverTemplate, setHoverTemplate] = useState<string | null>(null);
    const [busy, setBusy] = useState('');
    const [tap, setTap] = useState<{ lines: string[]; times: number[] } | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const songRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        loadLoopPresets().then(setPresets).catch((e) => notify(e.message, 'error'));
    }, [notify]);

    // "Sync to vocals" and "AI writes them" need the server's lyrics AI (LAUNCH_AI_FEATURES).
    const [lyricsAi, setLyricsAi] = useState(true);
    useEffect(() => {
        apiClient('/ai/status')
            .then((s: { aiFeatures?: Record<string, boolean> }) => setLyricsAi(s?.aiFeatures?.lyricsAi !== false))
            .catch(() => {});
    }, []);
    const comingSoon = (m: Method) => !lyricsAi && (m === 'sync' || m === 'ai');

    // Songs: audio clips on the timeline.
    const songs = useMemo(
        () => tracks.flatMap((t) => t.elements.filter((el): el is MediaElement => el.type === 'media' && items.find((i) => i.id === el.mediaId)?.type === 'audio')),
        [tracks, items]
    );
    useEffect(() => {
        if (source?.kind === 'element' && songs.some((s) => s.id === source.elementId)) return;
        if (songs[0]) setSource({ kind: 'element', elementId: songs[0].id });
    }, [songs, source, setSource]);
    const song = songs.find((s) => source?.kind === 'element' && s.id === source.elementId) || null;

    const run = async (label: string, task: () => Promise<void>) => {
        setBusy(label);
        try {
            await task();
        } catch (e) {
            notify((e as Error).message, 'error');
        } finally {
            setBusy('');
        }
    };

    // 1. Song
    const uploadSong = (file?: File) =>
        file &&
        run('Adding the song', async () => {
            if (!projectKey) throw new Error('Open a project first.');
            const [item] = await useMediaStore.getState().addFiles([file], projectKey);
            if (!item || item.type !== 'audio') throw new Error('Choose an audio file (MP3, WAV, M4A).');
            useTimelineStore.getState().addMediaAtTime(item, 0);
            notify('Song added at the start of the timeline.', 'success');
        });

    // 2. Background: stock search
    const searchStock = (query = stockQuery) =>
        run('Searching loops', async () => {
            const orientation = ratio === '9:16' ? 'portrait' : ratio === '1:1' ? 'square' : 'landscape';
            const data = await editorApi.searchAssets('broll', query, orientation);
            setStock(data.assets);
            setStockNotice(data.notice);
        });
    useEffect(() => {
        if (bgTab === 'stock' && !stock.length && !stockNotice) void searchStock();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bgTab]);

    // 3. Lyrics
    /**
     * Lyric lines from the box. A pasted paragraph is split into singable lines first, and the
     * box shows the result so the user can fix any line before (re)timing.
     */
    const lyricLines = () => {
        const split = splitLyricLines(text);
        if (split.changed) {
            setText(split.text);
            notify(`Split into ${split.lines} lines. Check them in the box; edit any line and run again if needed.`, 'success');
        }
        return split.text;
    };
    const lineCount = useMemo(() => text.split('\n').filter((l) => l.trim()).length, [text]);
    const hasParagraph = useMemo(() => text.split('\n').some((l) => l.split(/\s+/).filter(Boolean).length > 12), [text]);

    const timeFromText = (input: string) =>
        run('Placing the lyrics', async () => {
            const { duration, features } = await songInfo();
            const timedFile = looksLikeSrt(input) || looksLikeLrc(input);
            const raw = timedFile ? input : lyricLines();
            let lines: TimedLine[];
            let timing: 'srt' | 'lrc' | 'estimated';
            if (looksLikeSrt(raw)) [lines, timing] = [parseSrt(raw), 'srt'];
            else if (looksLikeLrc(raw)) [lines, timing] = [parseLrc(raw, duration), 'lrc'];
            else [lines, timing] = [placeLyrics(raw, features, duration), 'estimated'];
            if (!lines.length) throw new Error('No lyric lines found. Paste one line per lyric line.');
            setAnalysis(toAnalysis(lines, timing));
            notify(`${lines.length} lines ${timing === 'estimated' ? 'placed on the song. Use the nudge buttons or Tap along to fine-tune.' : 'synced from the file.'}`, 'success');
        });

    const readFile = (file?: File) =>
        file &&
        run('Reading the file', async () => {
            const raw = await file.text();
            setText(raw);
            if (!looksLikeSrt(raw) && !looksLikeLrc(raw)) throw new Error('That file has no timings. Use a .srt or .lrc file, or paste the lyrics instead.');
            await timeFromText(raw);
        });

    const syncLines = () =>
        run('Syncing your lyrics to the vocals', async () => {
            const lines = lyricLines().split('\n').map((l) => l.trim()).filter(Boolean);
            if (!lines.length) throw new Error('Paste the lyrics first.');
            const result = await syncToVocals(lines);
            notify(`${result.lines.length} lines synced to the vocals.`, 'success');
        });

    const startTap = () => {
        const lines = lyricLines().split('\n').map((l) => l.trim()).filter(Boolean);
        if (!lines.length) return notify('Paste the lyrics first, one line per lyric line.', 'error');
        if (!song) return notify('Add the song first.', 'error');
        setTap({ lines, times: [] });
        usePlaybackStore.getState().seek(song.startTime);
        usePlaybackStore.getState().play();
    };
    const tapNext = () =>
        setTap((t) => {
            if (!t) return t;
            const now = songTimeAt(source, usePlaybackStore.getState().currentTime);
            if (now === null) return t;
            const times = [...t.times, now];
            if (times.length === t.lines.length) finishTap(t.lines, times);
            return { ...t, times };
        });
    const finishTap = (lines: string[], times: number[]) => {
        usePlaybackStore.getState().pause();
        const timed = times.map((start, i) => ({ text: lines[i], start, end: Math.max(start + 0.5, (times[i + 1] ?? start + 4) - 0.05) }));
        setAnalysis(toAnalysis(timed, 'tap'));
        setTap(null);
        notify(`${timed.length} lines tapped in.`, 'success');
    };
    useEffect(() => {
        if (!tap) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.code === 'Space' || e.code === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                tapNext();
            } else if (e.code === 'Escape') {
                usePlaybackStore.getState().pause();
                setTap(null);
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tap]);

    const runAi = () =>
        run('Listening to the song', async () => {
            setLyricsText(text);
            const result = await analyze();
            notify(`Found ${result.lines.length} lyric lines.`, 'success');
        });

    // 4. Build
    const addBackgroundItem = async (): Promise<MediaItem> => {
        if (!background) throw new Error('Pick a background.');
        if (!projectKey) throw new Error('Open a project first.');
        let blob: Blob;
        let name: string;
        if (background.kind === 'loop') {
            const file = loopFileFor(background.preset, canvas.width, canvas.height);
            if (!file) throw new Error('This background is not available.');
            const response = await fetch(file.video);
            if (!response.ok) throw new Error('Could not load the background.');
            blob = await response.blob();
            name = `${background.preset.name}.mp4`;
        } else {
            blob = await editorApi.downloadAsset(background.asset.fileUrl);
            name = `${background.asset.title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 50).trim() || 'stock loop'}.mp4`;
        }
        const [item] = await useMediaStore.getState().addFiles([new File([blob], name, { type: 'video/mp4' })], projectKey);
        if (!item) throw new Error('The background could not be read.');
        return item;
    };

    const build = () =>
        run('Building your lyric video', async () => {
            if (!song) throw new Error('Add the song first.');
            if (!analysis?.lines.length) throw new Error('Add the lyrics first.');
            const store = useTimelineStore.getState();
            const main = store.tracks.find((t) => t.isMain);
            if (main?.elements.length && !window.confirm('Replace the clips on the main video track with the looping background?')) return;
            const item = await addBackgroundItem();
            const songEnd = getElementEnd(song);
            const scale = coverScale(item.width || 0, item.height || 0, canvas.width, canvas.height);
            store.setBackgroundLoop(item.id, item.name.replace(/\.mp4$/, ''), item.duration, songEnd, scale !== 1 ? ({ scale, x: 0, y: 0, rotation: 0, flipH: false, flipV: false, animation: 'none', animationAmount: 0.2 }) : undefined);
            const mapped = analysis.lines
                .map((line) => {
                    const start = timelineTimeOf(source, line.start);
                    const end = timelineTimeOf(source, Math.max(line.start + 0.2, line.end - 0.01)) ?? (start !== null ? start + (line.end - line.start) : null);
                    return start !== null && end !== null && end > start ? { line, start, end } : null;
                })
                .filter((x): x is NonNullable<typeof x> => x !== null);
            const count = useTimelineStore.getState().replaceLyricTrack(lyricElements(mapped, templateId, canvas.height));
            // The lyrics are timeline text now; the Lyrics tab's live overlay would draw them twice.
            useLyricsStore.getState().setVisible(false);
            usePlaybackStore.getState().seek(0);
            notify(`Lyric video ready: ${count} lyric captions over the ${background?.kind === 'loop' ? background.preset.name : 'stock'} background. Play it, then export.`, 'success');
        });

    const backgroundLabel = background ? (background.kind === 'loop' ? background.preset.name : background.asset.title) : 'none';

    return (
        <div className="ke-view ke-lyricvid">
            <div className="ke-view__head">
                <h3>Lyric video</h3>
            </div>
            <p className="ke-note">Upload a song, pick a looping background and a caption style, and add the lyrics. Type them yourself to save credits, or let the AI listen.</p>

            {/* 1. Song */}
            <section className="ke-lyricvid__step">
                <h4><span>1</span> Song</h4>
                {songs.length ? (
                    <select className="ke-select" value={song?.id || ''} onChange={(e) => setSource({ kind: 'element', elementId: e.target.value })}>
                        {songs.map((s) => (
                            <option key={s.id} value={s.id}>{s.name} · {formatDuration(getElementEnd(s) - s.startTime)}</option>
                        ))}
                    </select>
                ) : null}
                <button className="ke-btn ke-btn--block" onClick={() => songRef.current?.click()} disabled={!!busy}>
                    <Music2 size={15} /> {songs.length ? 'Upload another song' : 'Upload a song'}
                </button>
                <input ref={songRef} type="file" accept="audio/*" hidden onChange={(e) => { uploadSong(e.target.files?.[0]); e.target.value = ''; }} />
            </section>

            {/* 2. Background */}
            <section className="ke-lyricvid__step">
                <h4><span>2</span> Background <em>{backgroundLabel}</em></h4>
                <div className="ke-chip-row">
                    <button className={`ke-chip ${bgTab === 'loops' ? 'is-active' : ''}`} onClick={() => setBgTab('loops')}><Clapperboard size={13} /> Animated loops</button>
                    <button className={`ke-chip ${bgTab === 'stock' ? 'is-active' : ''}`} onClick={() => setBgTab('stock')}><Search size={13} /> Stock loops</button>
                </div>
                {bgTab === 'loops' ? (
                    <div className="ke-lyricvid__grid" role="radiogroup" aria-label="Animated background">
                        {presets.map((p) => {
                            const file = loopFileFor(p, canvas.width, canvas.height);
                            const active = background?.kind === 'loop' && background.preset.id === p.id;
                            return (
                                <button key={p.id} role="radio" aria-checked={active} className={`ke-lyricvid__bg ${active ? 'is-active' : ''}`} onClick={() => setBackground({ kind: 'loop', preset: p })} title={p.name}>
                                    {file ? (
                                        <video src={file.video} poster={file.poster} muted loop playsInline preload="none"
                                            onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
                                    ) : null}
                                    <small>{p.name}</small>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <>
                        <div className="ke-chip-row">
                            {STOCK_LOOP_QUERIES.map((q) => (
                                <button key={q.id} className={`ke-chip ${stockQuery === q.query ? 'is-active' : ''}`} onClick={() => { setStockQuery(q.query); void searchStock(q.query); }}>{q.label}</button>
                            ))}
                        </div>
                        {stockNotice ? <p className="ke-note">{stockNotice}</p> : null}
                        <div className="ke-lyricvid__grid">
                            {stock.map((a) => {
                                const active = background?.kind === 'stock' && background.asset.id === a.id;
                                return (
                                    <button key={a.id} className={`ke-lyricvid__bg ${active ? 'is-active' : ''}`} onClick={() => setBackground({ kind: 'stock', asset: a })} title={a.title}>
                                        {a.thumb ? <img src={a.thumb} alt="" /> : null}
                                        <small>{a.title}</small>
                                    </button>
                                );
                            })}
                        </div>
                        <p className="ke-note">Stock clips repeat for the length of the song; clips tagged “loop” repeat without a visible jump.</p>
                    </>
                )}
            </section>

            {/* 3. Lyrics */}
            <section className="ke-lyricvid__step">
                <h4><span>3</span> Lyrics {analysis ? <em>{analysis.lines.length} lines · {TIMING_LABELS[analysis.timingSource]}</em> : null}</h4>
                <div className="ke-lyricvid__methods" role="radiogroup" aria-label="How to add the lyrics">
                    {METHODS.map((m) => (
                        <button key={m.id} role="radio" aria-checked={method === m.id} className={`ke-chip ${method === m.id ? 'is-active' : ''}`} onClick={() => setMethod(m.id)} disabled={comingSoon(m.id)} title={comingSoon(m.id) ? 'Coming soon' : undefined}>
                            <m.icon size={13} /> {m.label}{comingSoon(m.id) ? ' · soon' : ''}
                        </button>
                    ))}
                </div>
                <p className="ke-note">{METHODS.find((m) => m.id === method)?.note}</p>
                {method !== 'file' ? (
                    <textarea className="ke-input ke-textarea" rows={6} value={text} onChange={(e) => setText(e.target.value)}
                        placeholder={method === 'ai' ? 'Optional: paste the lyrics so the AI gets every word right.' : 'Paste the lyrics. One line per sung line works best, but a paragraph is fine: it is split into lines for you.\n\n[Chorus] labels and blank lines mark new sections.'} />
                ) : null}
                {method !== 'file' && text.trim() ? (
                    <div className="ke-inline">
                        <span className="ke-note">{lineCount} {lineCount === 1 ? 'line' : 'lines'}{hasParagraph ? ' · looks like a paragraph' : ''}</span>
                        {hasParagraph ? (
                            <button className="ke-btn ke-btn--ghost ke-btn--sm" onClick={lyricLines}><Scissors size={13} /> Split into lines</button>
                        ) : null}
                    </div>
                ) : null}
                {method === 'paste' ? (
                    <button className="ke-btn ke-btn--block" onClick={() => timeFromText(text)} disabled={!!busy || !text.trim() || !song}><Wand2 size={15} /> Place lyrics on the song</button>
                ) : null}
                {method === 'sync' ? (
                    <button className="ke-btn ke-btn--block" onClick={syncLines} disabled={!!busy || analyzing || !text.trim() || !song}><AudioLines size={15} /> Sync my lyrics to the vocals (3 credits)</button>
                ) : null}
                {method === 'file' ? (
                    <>
                        <button className="ke-btn ke-btn--block" onClick={() => fileRef.current?.click()} disabled={!!busy || !song}><Upload size={15} /> Choose .srt or .lrc file</button>
                        <input ref={fileRef} type="file" accept=".srt,.lrc,.txt,text/plain" hidden onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ''; }} />
                    </>
                ) : null}
                {method === 'tap' ? (
                    tap ? (
                        <div className="ke-lyricvid__tap">
                            <p className="ke-note">Line {Math.min(tap.times.length + 1, tap.lines.length)} of {tap.lines.length}. Press <kbd>Space</kbd> as it starts (Esc to stop).</p>
                            <strong>{tap.lines[tap.times.length] ?? ''}</strong>
                            <button className="ke-btn ke-btn--primary ke-btn--block" onClick={tapNext}><Hand size={15} /> Tap: this line starts now</button>
                        </div>
                    ) : (
                        <button className="ke-btn ke-btn--block" onClick={startTap} disabled={!!busy || !text.trim() || !song}><Hand size={15} /> Play and tap along</button>
                    )
                ) : null}
                {method === 'ai' ? (
                    <button className="ke-btn ke-btn--block" onClick={runAi} disabled={!!busy || analyzing || !song}><Sparkles size={15} /> Listen and write the lyrics (17 credits)</button>
                ) : null}
                {analysis ? (
                    <div className="ke-inline">
                        <button className="ke-btn ke-btn--ghost ke-btn--sm" onClick={() => nudge(-0.25)} title="Lyrics appear earlier">−0.25s</button>
                        <button className="ke-btn ke-btn--ghost ke-btn--sm" onClick={() => nudge(0.25)} title="Lyrics appear later">+0.25s</button>
                        <span className="ke-note">Fine-tune the timing</span>
                    </div>
                ) : null}
            </section>

            {/* 4. Look */}
            <section className="ke-lyricvid__step">
                <h4><span>4</span> Caption style</h4>
                <div className="ke-cap-grid">
                    {CAPTION_TEMPLATES.map((t) => (
                        <button key={t.id} className={`ke-cap-card ${templateId === t.id ? 'is-active' : ''}`} onClick={() => setTemplateId(t.id)} title={t.description || t.name}
                            onMouseEnter={() => setHoverTemplate(t.id)} onMouseLeave={() => setHoverTemplate(null)} aria-pressed={templateId === t.id}>
                            <CaptionSample template={t} active={hoverTemplate === t.id} />
                            <small>{t.name}</small>
                        </button>
                    ))}
                </div>
            </section>

            {busy ? <p className="ke-note"><Loader2 size={13} className="ke-spin" /> {busy}…</p> : null}
            <button className="ke-btn ke-btn--primary ke-btn--block" onClick={build} disabled={!!busy || !song || !background || !analysis?.lines.length}>
                <Clapperboard size={15} /> Build lyric video
            </button>
            <p className="ke-note">The song stays on its track, the background loops for the whole song, and the lyrics go on the “Lyrics” track. Everything is included when you export.</p>
        </div>
    );
}
