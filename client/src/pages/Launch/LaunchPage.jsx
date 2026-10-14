import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Clapperboard, Copy, Download, Globe, Loader2, PenLine, RotateCcw, Scissors } from 'lucide-react';
import { apiClient } from '../../lib/api';
import MusicPicker from '../../components/music/MusicPicker';
import { useEditorStore } from '../../stores/editorStore';
import './Launch.css';

/**
 * Launch videos, after /brag (github.com/latent-spaces/brag, MIT): point it at a website
 * or describe a product, and get a short launch video with music and share copy.
 */

const TONES = [
    { id: 'default', name: 'Default', feel: 'Punchy, playful, clean' },
    { id: 'polished', name: 'Polished', feel: 'Serious, elegant, restrained' },
    { id: 'app-store', name: 'App Store', feel: 'Clean feature cards' },
    { id: 'cinematic', name: 'Cinematic', feel: 'Trailer-scale, big type' },
    { id: 'yc-parody', name: 'Startup parody', feel: 'Deadpan launch, played straight' },
    { id: 'deadpan', name: 'Deadpan', feel: 'Calm, dry, lots of space' },
    { id: 'chaotic', name: 'Chaotic', feel: 'Fast, loud, all caps' },
];

const FORMATS = [
    { id: 'landscape', label: '16:9', hint: 'YouTube, X, LinkedIn' },
    { id: 'vertical', label: '9:16', hint: 'TikTok, Reels, Shorts' },
    { id: 'square', label: '1:1', hint: 'Instagram feed' },
];

const STEPS = ['Inspecting', 'Writing the storyboard', 'Choosing music', 'Rendering'];

const API_ROOT = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api$/, '');

async function authorizedBlob(url) {
    const { auth } = await import('../../lib/firebase');
    const token = await auth?.currentUser?.getIdToken();
    const workspaceId = localStorage.getItem('kengan_current_workspace_id');
    const response = await fetch(`${API_ROOT}${url}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}) },
    });
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    return response.blob();
}

function stepIndex(stage) {
    if (!stage) return 0;
    if (/storyboard/i.test(stage)) return 1;
    if (/music/i.test(stage)) return 2;
    if (/render|done/i.test(stage)) return 3;
    return 0;
}

export default function LaunchPage() {
    const navigate = useNavigate();
    const setEditorVideo = useEditorStore((s) => s.setVideo);
    const [source, setSource] = useState('website');
    const [form, setForm] = useState({ url: '', name: '', description: '', focus: '', tone: 'default', format: 'landscape', duration: 20, music: true });
    const [music, setMusic] = useState({ genre: '', mood: '', track: null });
    const [toneMusic, setToneMusic] = useState({});
    const [job, setJob] = useState(null);
    const [error, setError] = useState('');
    const [videoUrl, setVideoUrl] = useState(null);
    const [copied, setCopied] = useState(false);
    const blobRef = useRef(null);
    const pollRef = useRef(null);

    const set = (partial) => setForm((f) => ({ ...f, ...partial }));

    // Default genre/mood per tone, so the picker can say what "match the tone" means.
    useEffect(() => {
        apiClient('/brag/tones')
            .then(({ tones }) => setToneMusic(Object.fromEntries((tones || []).map((t) => [t.id, t.music]))))
            .catch(() => {});
    }, []);
    const busy = job?.status === 'processing' || job?.status === 'starting';

    useEffect(() => () => {
        clearTimeout(pollRef.current);
        if (videoUrl) URL.revokeObjectURL(videoUrl);
    }, [videoUrl]);

    const poll = (jobId) => {
        pollRef.current = setTimeout(async () => {
            try {
                const status = await apiClient(`/video/manual-edit/status/${jobId}`);
                setJob(status);
                if (status.status === 'completed') {
                    const blob = await authorizedBlob(status.downloadUrl);
                    blobRef.current = blob;
                    setVideoUrl(URL.createObjectURL(blob));
                } else if (status.status === 'failed') {
                    setError(status.error || 'The launch video could not be made.');
                } else {
                    poll(jobId);
                }
            } catch (err) {
                setError(err.message);
                setJob(null);
            }
        }, 2000);
    };

    const start = async (overrides = {}) => {
        const request = { ...form, ...overrides };
        if (overrides.tone) set({ tone: overrides.tone });
        setError('');
        setVideoUrl(null);
        setCopied(false);
        setJob({ status: 'starting', stage: 'Starting', progress: 0 });
        try {
            const body = {
                tone: request.tone,
                format: request.format,
                duration: request.duration,
                music: request.music,
                ...(request.music
                    ? { musicGenre: music.genre, musicMood: music.mood, musicTrackId: music.track?.id || '' }
                    : {}),
                focus: request.focus,
                ...(source === 'website' ? { url: request.url, name: request.name } : { name: request.name, description: request.description }),
            };
            const { jobId } = await apiClient('/brag', { method: 'POST', body: JSON.stringify(body) });
            poll(jobId);
        } catch (err) {
            setError(err.message);
            setJob(null);
        }
    };

    const openInEditor = () => {
        if (!blobRef.current) return;
        const name = (job?.plan?.productName || 'launch').replace(/[^\w-]+/g, '-').toLowerCase();
        setEditorVideo(new File([blobRef.current], `${name}-launch.mp4`, { type: 'video/mp4' }));
        navigate('/editor');
    };

    const download = () => {
        if (!videoUrl) return;
        const a = document.createElement('a');
        a.href = videoUrl;
        a.download = `${(job?.plan?.productName || 'launch').replace(/[^\w-]+/g, '-').toLowerCase()}-launch.mp4`;
        a.click();
    };

    const copyShare = async () => {
        await navigator.clipboard.writeText(job?.shareCopy || '');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const canSubmit = source === 'website' ? form.url.trim().length > 3 : form.description.trim().length > 10;
    const done = job?.status === 'completed' && videoUrl;

    return (
        <div className="launch-page">
            <header className="page-head">
                <div>
                    <h1>Launch video</h1>
                    <p>Point it at a website or describe a product. You get a 15–30 second launch video with music and a caption to post.</p>
                </div>
            </header>

            <div className="launch-layout">
                <section className="launch-form surface">
                    <div className="segmented" role="tablist">
                        <button role="tab" aria-selected={source === 'website'} className={source === 'website' ? 'is-active' : ''} onClick={() => setSource('website')} disabled={busy}>
                            <Globe size={15} /> Website
                        </button>
                        <button role="tab" aria-selected={source === 'describe'} className={source === 'describe' ? 'is-active' : ''} onClick={() => setSource('describe')} disabled={busy}>
                            <PenLine size={15} /> Describe it
                        </button>
                    </div>

                    {source === 'website' ? (
                        <label className="field">
                            <span>Website address</span>
                            <input className="input" placeholder="yourproduct.com" value={form.url} onChange={(e) => set({ url: e.target.value })} disabled={busy} />
                            <small>We read its copy, colours and fonts, and take screenshots to show the real product.</small>
                        </label>
                    ) : (
                        <>
                            <label className="field">
                                <span>Product name</span>
                                <input className="input" placeholder="e.g. Kengan Studio" value={form.name} onChange={(e) => set({ name: e.target.value })} disabled={busy} />
                            </label>
                            <label className="field">
                                <span>What it does and who it's for</span>
                                <textarea className="input" rows={4} placeholder="Two or three sentences in your own words." value={form.description} onChange={(e) => set({ description: e.target.value })} disabled={busy} />
                            </label>
                        </>
                    )}

                    <label className="field">
                        <span>Focus <em>optional</em></span>
                        <input className="input" placeholder="A new feature, a launch, one angle…" value={form.focus} onChange={(e) => set({ focus: e.target.value })} disabled={busy} />
                    </label>

                    <div className="field">
                        <span>Tone</span>
                        <div className="tone-grid">
                            {TONES.map((t) => (
                                <button key={t.id} className={`tone-card ${form.tone === t.id ? 'is-active' : ''}`} onClick={() => set({ tone: t.id })} disabled={busy}>
                                    <strong>{t.name}</strong>
                                    <small>{t.feel}</small>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="field-row">
                        <div className="field">
                            <span>Format</span>
                            <div className="segmented">
                                {FORMATS.map((f) => (
                                    <button key={f.id} className={form.format === f.id ? 'is-active' : ''} onClick={() => set({ format: f.id })} title={f.hint} disabled={busy}>
                                        {f.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <label className="field">
                            <span>Length: {form.duration}s</span>
                            <input type="range" min={12} max={30} step={1} value={form.duration} onChange={(e) => set({ duration: Number(e.target.value) })} disabled={busy} />
                        </label>
                    </div>

                    <div className="field">
                        <label className="check">
                            <input type="checkbox" checked={form.music} onChange={(e) => set({ music: e.target.checked })} disabled={busy} />
                            Add background music
                        </label>
                        {form.music ? (
                            <MusicPicker value={music} onChange={setMusic} disabled={busy} auto={toneMusic[form.tone]} minSeconds={form.duration + 1} />
                        ) : null}
                    </div>

                    {error ? <div className="error-banner">{error}</div> : null}

                    <button className="btn btn-primary btn-block" onClick={() => start()} disabled={!canSubmit || busy}>
                        {busy ? <Loader2 size={16} className="spin" /> : <Clapperboard size={16} />}
                        {busy ? 'Making your video…' : 'Make launch video'}
                    </button>
                </section>

                <section className="launch-result surface">
                    {!job && !done ? (
                        <div className="launch-empty">
                            <Clapperboard size={28} />
                            <h3>Your video appears here</h3>
                            <p>It takes one to two minutes: we inspect the product, write a storyboard, pick music and render.</p>
                        </div>
                    ) : null}

                    {busy ? (
                        <div className="launch-progress">
                            <ol className="steps">
                                {STEPS.map((s, i) => {
                                    const current = stepIndex(job?.stage);
                                    return (
                                        <li key={s} className={i < current ? 'is-done' : i === current ? 'is-current' : ''}>
                                            <span className="steps__dot">{i < current ? <Check size={12} /> : i + 1}</span>
                                            {s}
                                            {i === current && job?.stage && job.stage !== s ? <em>{job.stage}</em> : null}
                                        </li>
                                    );
                                })}
                            </ol>
                            <div className="progress"><div style={{ width: `${job?.progress || 0}%` }} /></div>
                            <small className="muted">{job?.progress || 0}%</small>
                        </div>
                    ) : null}

                    {done ? (
                        <div className="launch-done">
                            <video className={`launch-video is-${form.format}`} src={videoUrl} poster={job.poster || undefined} controls playsInline />
                            <div className="launch-actions">
                                <button className="btn btn-primary" onClick={download}><Download size={16} /> Download MP4</button>
                                <button className="btn btn-secondary" onClick={openInEditor}><Scissors size={16} /> Open in editor</button>
                                <button className="btn btn-ghost" onClick={() => start()}><RotateCcw size={16} /> Re-roll</button>
                            </div>

                            {job.musicCredit ? <p className="launch-music muted">Music: {job.musicCredit}</p> : null}

                            {job.shareCopy ? (
                                <div className="share-copy">
                                    <div className="share-copy__head">
                                        <span>Caption</span>
                                        <button className="btn btn-ghost btn-sm" onClick={copyShare}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}</button>
                                    </div>
                                    <p>{job.shareCopy}</p>
                                </div>
                            ) : null}

                            {job.plan?.scenes?.length ? (
                                <details className="storyboard">
                                    <summary>Storyboard: {job.plan.angle}</summary>
                                    <ol>
                                        {job.plan.scenes.map((s, i) => (
                                            <li key={i}>
                                                <span className="storyboard__meta">{s.type}, {s.duration.toFixed(1)}s</span>
                                                <strong>{s.headline}</strong>
                                                {s.subline ? <span>{s.subline}</span> : null}
                                            </li>
                                        ))}
                                    </ol>
                                    {job.planner === 'fallback' ? <p className="muted">The AI planner was unavailable, so this storyboard was built from the site's own copy.</p> : null}
                                </details>
                            ) : null}

                            <div className="try-tones">
                                <span>Try another tone</span>
                                {TONES.filter((t) => t.id !== form.tone).slice(0, 4).map((t) => (
                                    <button key={t.id} className="chip" onClick={() => start({ tone: t.id })}>{t.name}</button>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </section>
            </div>
            <p className="attribution">Storyboarding follows the creative rules of <a href="https://github.com/latent-spaces/brag" target="_blank" rel="noreferrer">/brag</a> (MIT).</p>
        </div>
    );
}
