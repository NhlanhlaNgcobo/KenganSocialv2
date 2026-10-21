/**
 * Beat sync for a clip with sound: find its beats, place markers by hand, and re-cut the main
 * track so every cut (and the transition centred on it) lands on a beat.
 */
import { useState } from 'react';
import { Activity, Flag, Scissors } from 'lucide-react';
import { cutToBeats, detectBeats, toggleMarker, type BeatCutMode } from '../../lib/beat-sync';
import { TRANSITIONS } from '../../lib/fx';
import { usePlaybackStore } from '../../stores/playback-store';
import { useProjectStore } from '../../stores/project-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useUiStore } from '../../stores/ui-store';
import { getElementEnd } from '../../lib/time';
import type { MediaElement, TimelineTrack, TransitionType } from '../../types';

const EVERY = [
    { value: 1, label: 'Every beat' },
    { value: 2, label: 'Every 2 beats' },
    { value: 4, label: 'Every bar (4)' },
    { value: 8, label: 'Every 2 bars' },
];
const BEAT_TRANSITIONS: TransitionType[] = ['flash', 'ks-whip-carry', 'zoomin', 'ks-crash-reveal', 'glitchbands', 'fade'].filter((t) => TRANSITIONS.some((x) => x.type === t)) as TransitionType[];

export function BeatPanel({ track, el }: { track: TimelineTrack; el: MediaElement }) {
    const notify = useUiStore((s) => s.notify);
    const currentTime = usePlaybackStore((s) => s.currentTime);
    const fps = useProjectStore((s) => s.fps);
    const beatSnapping = useTimelineStore((s) => s.beatSnapping);
    const [busy, setBusy] = useState(false);
    const [mode, setMode] = useState<BeatCutMode>('every');
    const [every, setEvery] = useState(2);
    const [downbeats, setDownbeats] = useState(false);
    const [transition, setTransition] = useState<TransitionType | ''>('');
    const beats = el.beats;
    const inside = currentTime >= el.startTime && currentTime <= getElementEnd(el);
    const markerHere = !!beats?.markers?.some((m) => Math.abs(el.startTime + (m - el.trimStart) / (el.speed || 1) - currentTime) <= 0.5 / fps);

    const detect = async () => {
        setBusy(true);
        try {
            const a = await detectBeats(el.id);
            notify(`${a.bpm} BPM · ${a.beats.length} beats found.`, 'success');
        } catch (error) {
            notify((error as Error).message, 'error');
        } finally {
            setBusy(false);
        }
    };

    const cut = () => {
        const result = cutToBeats({ mode, every, downbeatsOnly: downbeats, transition: transition || null });
        if (result.error) return notify(result.error, 'error');
        notify(`${result.synced} of ${result.total} cut${result.total === 1 ? '' : 's'} now on the beat${transition ? `, each with ${TRANSITIONS.find((t) => t.type === transition)?.label}` : ''}.`, 'success');
    };

    return (
        <section className="ke-props-section ke-beat">
            <h4>Beat sync</h4>
            {beats && beats.beats.length ? (
                <div className="ke-beat__stats">
                    <span className="ke-beat__bpm">{beats.bpm} BPM</span>
                    <span className="ke-muted">
                        {beats.beats.length} beats · {beats.confidence >= 0.5 ? 'steady' : 'loose'} pulse{beats.markers?.length ? ` · ${beats.markers.length} marker${beats.markers.length === 1 ? '' : 's'}` : ''}
                    </span>
                </div>
            ) : (
                <p className="ke-note">Find the beats of this sound, then cut clips, transitions and animations to them.</p>
            )}
            <div className="ke-inline">
                <button className="ke-btn ke-btn--sm ke-btn--primary" disabled={busy} onClick={detect}>
                    <Activity size={13} /> {busy ? 'Listening…' : beats?.beats.length ? 'Detect again' : 'Detect beats'}
                </button>
                <button className={`ke-chip ${beatSnapping ? 'is-active' : ''}`} onClick={() => useTimelineStore.getState().toggleBeatSnapping()} title="Clips, trims and the playhead snap to beats and markers">
                    Snap to beats
                </button>
            </div>
            <div className="ke-inline">
                <button className="ke-btn ke-btn--sm" disabled={!inside} onClick={() => notify(toggleMarker(track.id, el, currentTime, fps) ? 'Marker added.' : 'Marker removed.', 'success')} title="Add your own beat marker at the playhead (or remove the one there)">
                    <Flag size={13} /> {markerHere ? 'Remove marker' : 'Add marker'}
                </button>
                {beats?.markers?.length ? (
                    <button className="ke-btn ke-btn--sm" onClick={() => useTimelineStore.getState().updateElement(track.id, el.id, { beats: { ...beats, markers: [] } })}>
                        Clear markers
                    </button>
                ) : null}
            </div>

            <h5 className="ke-subhead">Cut the main track to the beat</h5>
            <div className="ke-chip-row">
                <button className={`ke-chip ${mode === 'every' ? 'is-active' : ''}`} onClick={() => setMode('every')} title="Each clip lasts the same number of beats (a montage)">
                    Montage
                </button>
                <button className={`ke-chip ${mode === 'nearest' ? 'is-active' : ''}`} onClick={() => setMode('nearest')} title="Each cut moves to the nearest beat; clip lengths stay close">
                    Nearest beat
                </button>
            </div>
            <div className="ke-inline">
                <select className="ke-select" value={every} onChange={(e) => setEvery(Number(e.target.value))} aria-label="Beat grid">
                    {EVERY.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>
                <button className={`ke-chip ${downbeats ? 'is-active' : ''}`} onClick={() => setDownbeats(!downbeats)} title="Use only the first beat of each bar">
                    Downbeats
                </button>
            </div>
            <div className="ke-inline">
                <select className="ke-select" value={transition} onChange={(e) => setTransition(e.target.value as TransitionType | '')} aria-label="Transition on each cut">
                    <option value="">Keep transitions</option>
                    {BEAT_TRANSITIONS.map((t) => (
                        <option key={t} value={t}>
                            {TRANSITIONS.find((x) => x.type === t)?.label} on every cut
                        </option>
                    ))}
                </select>
                <button className="ke-btn ke-btn--sm ke-btn--primary" onClick={cut}>
                    <Scissors size={13} /> Cut to beat
                </button>
            </div>
            <p className="ke-note">Beats come from music on other tracks plus your markers. Transitions sit centred on the cut, so they hit the beat too. Animate to the beat from Keyframes.</p>
        </section>
    );
}
