import { useEffect, useMemo } from 'react';
import { Download, ListPlus, Loader2, Wand2 } from 'lucide-react';
import { formatDuration } from '../../../lib/music-api';
import { findActiveLineIndex, LYRIC_STYLES, TIMING_LABELS, toSrt, type LyricLine, type LyricStyle } from '../../lib/lyrics';
import { useGuideTrackStore } from '../../stores/guide-track-store';
import { songTimeAt, timelineTimeOf, useLyricsStore, type LyricSource } from '../../stores/lyrics-store';
import { useMediaStore } from '../../stores/media-store';
import { usePlaybackStore } from '../../stores/playback-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';
import type { MediaElement, TextElement } from '../../types';

const STYLE_LABELS: Record<LyricStyle, string> = { karaoke: 'Karaoke', kinetic: 'Kinetic', spotlight: 'Spotlight' };

/** How each visualizer style looks once burned into the export as timeline text. */
const TIMELINE_TEXT: Record<LyricStyle, Partial<TextElement>> = {
    karaoke: { fontSize: 64, fontWeight: 'bold', color: '#ffffff', backgroundColor: 'transparent', fontFamily: 'Arial', y: 560 },
    kinetic: { fontSize: 104, fontWeight: 'bold', color: '#ffffff', backgroundColor: 'transparent', fontFamily: 'Impact', y: 0 },
    spotlight: { fontSize: 60, fontWeight: 'normal', color: '#ededef', backgroundColor: 'rgba(0,0,0,0.4)', fontFamily: 'Arial', y: 0 },
};

const sourceKey = (source: LyricSource | null) => (source ? (source.kind === 'guide' ? 'guide' : `el:${source.elementId}`) : '');

export function LyricsView() {
    const tracks = useTimelineStore((s) => s.tracks);
    const items = useMediaStore((s) => s.items);
    const guideTrack = useGuideTrackStore((s) => s.track);
    const currentTime = usePlaybackStore((s) => s.currentTime);
    const notify = useUiStore((s) => s.notify);
    const { source, lyricsText, analysis, style, visible, analyzing, error, setSource, setLyricsText, setStyle, setVisible, analyze, nudge } = useLyricsStore();

    // Songs you can analyze: audio clips on the timeline, plus the Audiomack guide track.
    const audioClips = useMemo(
        () =>
            tracks.flatMap((track) =>
                track.elements
                    .filter((el): el is MediaElement => el.type === 'media' && items.find((i) => i.id === el.mediaId)?.type === 'audio')
                    .map((el) => ({ el, label: `${el.name} · ${formatDuration(el.startTime)}` }))
            ),
        [tracks, items]
    );

    // Default to the first song available; drop a source that has gone away.
    useEffect(() => {
        const stillThere =
            source && (source.kind === 'guide' ? !!guideTrack : audioClips.some((c) => c.el.id === source.elementId));
        if (stillThere) return;
        if (audioClips[0]) setSource({ kind: 'element', elementId: audioClips[0].el.id });
        else if (guideTrack) setSource({ kind: 'guide' });
        else if (source) setSource(null);
    }, [audioClips, guideTrack, source, setSource]);

    const songNow = songTimeAt(source, currentTime);
    const activeIndex = analysis && songNow !== null ? findActiveLineIndex(analysis.lines, songNow) : -1;

    /** Lyric lines mapped onto the timeline, dropping any outside the clip. */
    const timelineLines = () =>
        (analysis?.lines ?? [])
            .map((line) => {
                const start = timelineTimeOf(source, line.start);
                const end = timelineTimeOf(source, Math.max(line.start + 0.2, line.end - 0.01)) ?? (start !== null ? start + (line.end - line.start) : null);
                return start !== null && end !== null && end > start ? { line, start, end } : null;
            })
            .filter((entry): entry is { line: LyricLine; start: number; end: number } => entry !== null);

    const run = async () => {
        try {
            const result = await analyze();
            notify(`Found ${result.lines.length} lyric lines.`, 'success');
        } catch (e) {
            notify((e as Error).message, 'error');
        }
    };

    const addToTimeline = () => {
        const mapped = timelineLines();
        if (!mapped.length) return notify('None of the lyrics fall inside the clip on the timeline.', 'error');
        const count = useTimelineStore.getState().replaceLyricTrack(
            mapped.map(({ line, start, end }) => ({
                ...TIMELINE_TEXT[style],
                content: style === 'kinetic' ? line.text.toUpperCase() : line.text,
                startTime: start,
                duration: end - start,
            }))
        );
        notify(`Added ${count} lyric lines to a "Lyrics" track. They are included in the export.`, 'success');
    };

    const downloadSrt = () => {
        const mapped = timelineLines();
        if (!mapped.length) return;
        const url = URL.createObjectURL(new Blob([toSrt(mapped.map(({ line, start, end }) => ({ text: line.text, start, end })))], { type: 'application/x-subrip' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'lyrics.srt';
        link.click();
        URL.revokeObjectURL(url);
    };

    const seekTo = (line: LyricLine) => {
        const t = timelineTimeOf(source, line.start);
        if (t !== null) usePlaybackStore.getState().seek(t);
    };

    const hasSong = audioClips.length > 0 || !!guideTrack;

    return (
        <div className="ke-view">
            <div className="ke-view__head">
                <h3>Lyrics</h3>
            </div>

            {!hasSong ? (
                <p className="ke-note">
                    Add a song first: use the Music tab to upload your own track or pick one from the library, or play along with an Audiomack track. Then come back here to
                    analyze its lyrics.
                </p>
            ) : (
                <>
                    <label className="ke-field">
                        <span>Song</span>
                        <select
                            className="ke-select"
                            value={sourceKey(source)}
                            onChange={(e) => setSource(e.target.value === 'guide' ? { kind: 'guide' } : { kind: 'element', elementId: e.target.value.slice(3) })}
                        >
                            {audioClips.map(({ el, label }) => (
                                <option key={el.id} value={`el:${el.id}`}>
                                    {label}
                                </option>
                            ))}
                            {guideTrack ? <option value="guide">Audiomack: {guideTrack.artist} – {guideTrack.title}</option> : null}
                        </select>
                    </label>

                    <label className="ke-field">
                        <span>Lyrics {source?.kind === 'guide' ? '(required for Audiomack)' : '(optional)'}</span>
                        <textarea
                            className="ke-input ke-textarea"
                            rows={5}
                            value={lyricsText}
                            onChange={(e) => setLyricsText(e.target.value)}
                            placeholder={'Paste lyrics for better accuracy.\nLRC timestamps like [00:12.40] sync exactly.'}
                        />
                    </label>

                    <button className="ke-btn ke-btn--primary ke-btn--block" onClick={run} disabled={analyzing || !source}>
                        {analyzing ? <Loader2 size={15} className="ke-spin" /> : <Wand2 size={15} />} {analysis ? 'Re-analyze lyrics' : 'Auto-analyze lyrics'}
                    </button>
                    {analyzing ? <p className="ke-note">Listening to the track… this can take up to a minute.</p> : null}
                    {error ? <div className="ke-alert ke-alert--error">{error}</div> : null}
                </>
            )}

            {analysis ? (
                <>
                    <div className="ke-chip-row">
                        <span className="ke-chip is-active" style={{ textTransform: 'capitalize' }}>
                            {analysis.mood}
                        </span>
                        <span className="ke-chip">{TIMING_LABELS[analysis.timingSource]}</span>
                        <span className="ke-chip">{analysis.analysisSource === 'claude' ? 'AI sections' : 'Auto sections'}</span>
                    </div>
                    {analysis.keywords.length ? <p className="ke-note">Themes: {analysis.keywords.join(', ')}</p> : null}

                    <div className="ke-field">
                        <span>Visualizer</span>
                        <div className="ke-seg ke-seg--text">
                            {LYRIC_STYLES.map((s) => (
                                <button key={s} className={style === s ? 'is-active' : ''} onClick={() => setStyle(s)}>
                                    {STYLE_LABELS[s]}
                                </button>
                            ))}
                        </div>
                    </div>

                    <label className="ke-check">
                        <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Show on preview
                    </label>

                    <div className="ke-inline">
                        <button className="ke-btn ke-btn--ghost ke-btn--sm" onClick={() => nudge(-0.5)} title="Lyrics appear earlier">
                            −0.5s
                        </button>
                        <button className="ke-btn ke-btn--ghost ke-btn--sm" onClick={() => nudge(0.5)} title="Lyrics appear later">
                            +0.5s
                        </button>
                        <button className="ke-icon-btn" onClick={downloadSrt} title="Download .srt">
                            <Download size={14} />
                        </button>
                    </div>

                    <button className="ke-btn ke-btn--block" onClick={addToTimeline}>
                        <ListPlus size={15} /> Add lyrics to timeline
                    </button>
                    <p className="ke-note">The visualizer is a live preview. Adding lyrics to the timeline puts them on a text track so they're included when you export.</p>

                    <div className="ke-list ke-lyric-lines">
                        {analysis.lines.map((line, i) => (
                            <button key={line.id} className={`ke-list__item ${i === activeIndex ? 'is-active' : ''}`} onClick={() => seekTo(line)}>
                                <span>{formatDuration(line.start)}</span>
                                <span>{line.text}</span>
                                <em>{line.section}</em>
                            </button>
                        ))}
                    </div>
                </>
            ) : null}
        </div>
    );
}
