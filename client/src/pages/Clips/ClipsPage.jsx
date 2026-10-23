import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarPlus, Check, Copy, Download, Film, ImagePlus, Loader2, Lock, Play, RotateCcw, Scissors, Trash2, Upload, Wand2 } from 'lucide-react'
import ThumbnailStudio from '../../components/thumbnails/ThumbnailStudio';
import { useAuth } from '../../context/AuthContext';
import ShortsSettings from '../../components/clips/ShortsSettings';
import SaveToLibraryButton from '../../components/clients/SaveToLibraryButton';
import { DEFAULT_SHORTS_OPTIONS, LAYOUTS, SHORT_PLATFORMS, shortsRequest } from '../../components/clips/shorts-options';
import { clipsApi, formatTime, uploadVideo } from '../../lib/clips-api';
import { useEditorStore } from '../../stores/editorStore';
import { PLAN_DISPLAY_NAMES, PLAN_LIMITS } from '../../utils/planLimits';
import './Clips.css';

/**
 * Clips: upload a long video and get ranked short clips, reframed with captions,
 * each with a score, title, hook and post caption (in the spirit of OpusClip).
 */

const LENGTHS = [
    { id: 'short', label: '15–30s' },
    { id: 'medium', label: '30–60s' },
    { id: 'long', label: '60–90s' },
];
const STEPS = ['Uploading', 'Transcribing', 'Finding the best moments', 'Rendering'];
const SCORE_PARTS = [
    { id: 'hook', label: 'Hook' },
    { id: 'flow', label: 'Flow' },
    { id: 'value', label: 'Value' },
    { id: 'trend', label: 'Trend' },
];

function stepIndex(stage = '') {
    if (/upload/i.test(stage)) return 0;
    if (/transcrib|queued/i.test(stage)) return 1;
    if (/moment/i.test(stage)) return 2;
    if (/render|done/i.test(stage)) return 3;
    return 1;
}

function scoreTier(score) {
    if (score >= 80) return 'is-high';
    if (score >= 65) return 'is-mid';
    return 'is-low';
}

function safeName(text) {
    return (text || 'clip').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50).toLowerCase() || 'clip';
}

export default function ClipsPage() {
    const [params, setParams] = useSearchParams();
    const projectId = params.get('project');
    const open = (id) => setParams(id ? { project: id } : {});

    return (
        <div className="clips-page">
            {projectId ? <ProjectView id={projectId} onBack={() => open(null)} /> : <NewProject onCreated={open} onOpen={open} />}
        </div>
    );
}

function NewProject({ onCreated, onOpen }) {
    const [file, setFile] = useState(null);
    const [fileInfo, setFileInfo] = useState(null);
    const [options, setOptions] = useState({ ...DEFAULT_SHORTS_OPTIONS, prompt: '' });
    const [upload, setUpload] = useState(null);
    const [error, setError] = useState('');
    const [recent, setRecent] = useState(null);
    const [dragging, setDragging] = useState(false);
    const inputRef = useRef(null);
    const set = (patch) => setOptions((o) => ({ ...o, ...patch }));
    // Checked before uploading so nobody uploads a 2 GB video only to be told their plan has no clips.
    // The server still enforces the limit.
    const { plan } = useAuth();
    const locked = (PLAN_LIMITS[plan] || PLAN_LIMITS.starter).clipAnalysis === 0;

    // A video dropped on the home page arrives in navigation state.
    const location = useLocation();
    const navigate = useNavigate();
    useEffect(() => {
        if (location.state?.file) {
            choose(location.state.file);
            navigate(location.pathname, { replace: true, state: null });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        clipsApi
            .list()
            .then((data) => setRecent(data.projects || []))
            .catch(() => setRecent([]));
    }, []);

    const choose = (picked) => {
        if (!picked) return;
        if (!picked.type.startsWith('video/')) {
            setError('Choose a video file (MP4, MOV or WebM).');
            return;
        }
        setError('');
        setFile(picked);
        setFileInfo(null);
        const url = URL.createObjectURL(picked);
        const probe = document.createElement('video');
        probe.preload = 'metadata';
        probe.onloadedmetadata = () => {
            setFileInfo({ duration: probe.duration, width: probe.videoWidth, height: probe.videoHeight });
            URL.revokeObjectURL(url);
        };
        probe.onerror = () => URL.revokeObjectURL(url);
        probe.src = url;
    };

    const start = async () => {
        if (!file || locked) return;
        setError('');
        setUpload(0);
        try {
            const sourceUploadId = await uploadVideo(file, setUpload);
            const { id } = await clipsApi.create({ ...shortsRequest(options), prompt: options.prompt, sourceUploadId, sourceName: file.name });
            onCreated(id);
        } catch (err) {
            setError(err.message || 'Could not start the clip project. Try again.');
            setUpload(null);
        }
    };

    const busy = upload !== null;
    const tooShort = fileInfo && fileInfo.duration < 20;

    return (
        <>
            <header className="page-head">
                <div>
                    <h1>Clips</h1>
                    <p>Upload a long video (a podcast, interview, talk or vlog) and get short clips ranked by how likely they are to perform, reframed and captioned.</p>
                </div>
            </header>

            {locked ? (
                <div className="clips-locked surface">
                    <Lock size={16} />
                    <div>
                        <strong>Clips is part of the {PLAN_DISPLAY_NAMES.nano} plan and up.</strong>
                        <p className="muted">Your current plan doesn't include AI clip finding. Upgrade to turn long videos into ranked, captioned clips.</p>
                    </div>
                    <Link to="/dashboard/billing" className="btn btn-primary btn-sm">
                        See plans
                    </Link>
                </div>
            ) : null}

            <div className="clips-layout">
                <section className="surface clips-form">
                    <div
                        className={`clips-drop ${dragging ? 'is-dragging' : ''} ${file ? 'has-file' : ''}`}
                        onDragOver={(e) => {
                            e.preventDefault();
                            setDragging(true);
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setDragging(false);
                            choose(e.dataTransfer.files?.[0]);
                        }}
                        onClick={() => !busy && inputRef.current?.click()}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && inputRef.current?.click()}
                    >
                        <input ref={inputRef} type="file" accept="video/*" hidden onChange={(e) => choose(e.target.files?.[0])} />
                        {file ? (
                            <>
                                <Film size={22} />
                                <strong>{file.name}</strong>
                                <small>
                                    {formatTime(fileInfo?.duration || 0)} long, {(file.size / (1024 * 1024)).toFixed(0)} MB{fileInfo ? `, ${fileInfo.width}×${fileInfo.height}` : ''}
                                    {!busy ? '. Click to change.' : ''}
                                </small>
                            </>
                        ) : (
                            <>
                                <Upload size={22} />
                                <strong>Drop a video here or click to choose</strong>
                                <small>MP4, MOV or WebM up to 2 GB. Longer videos with speech give the best clips.</small>
                            </>
                        )}
                    </div>

                    <ShortsSettings value={options} onChange={set} disabled={busy} />

                    <label className="field">
                        <span>
                            Find specific moments <em>optional</em>
                        </span>
                        <textarea
                            className="input"
                            rows={2}
                            maxLength={300}
                            placeholder="e.g. every time we talk about pricing, or the funniest stories"
                            value={options.prompt}
                            onChange={(e) => set({ prompt: e.target.value })}
                            disabled={busy}
                        />
                        <small>Leave empty to get the strongest clips overall.</small>
                    </label>

                    {tooShort ? <div className="clips-warning">This video is under 20 seconds. Clips work best from videos a few minutes or longer.</div> : null}
                    {error ? <div className="error-banner">{error}</div> : null}

                    {busy ? (
                        <div className="clips-upload">
                            <div className="clips-upload__row">
                                <Loader2 size={15} className="spin" />
                                <span>{upload < 100 ? `Uploading… ${upload}%` : 'Starting…'}</span>
                            </div>
                            <div className="progress">
                                <div style={{ width: `${upload}%` }} />
                            </div>
                        </div>
                    ) : (
                        <button
                            className="btn btn-primary btn-block"
                            onClick={start}
                            disabled={!file || locked || !options.platform}
                            title={locked ? 'Upgrade your plan to use Clips' : !options.platform ? 'Choose where the shorts are going first' : undefined}
                        >
                            {locked ? <Lock size={16} /> : <Wand2 size={16} />} {file && !options.platform ? 'Choose a platform above' : 'Find clips'}
                        </button>
                    )}
                </section>

                <aside className="surface clips-recent">
                    <h3>Recent projects</h3>
                    {recent === null ? <p className="muted">Loading…</p> : null}
                    {recent?.length === 0 ? <p className="muted">Your clip projects appear here.</p> : null}
                    <ul>
                        {recent?.map((p) => (
                            <li key={p.id}>
                                <button className="clips-recent__item" onClick={() => onOpen(p.id)}>
                                    <span className="clips-recent__thumb">{p.poster ? <img src={p.poster} alt="" /> : <Film size={16} />}</span>
                                    <span className="clips-recent__meta">
                                        <strong>{p.sourceName}</strong>
                                        <small>
                                            {p.status === 'processing' ? `${p.stage || 'Processing'}…` : p.status === 'failed' ? 'Failed' : `${p.clipCount} clip${p.clipCount === 1 ? '' : 's'}`}
                                            {', '}
                                            {new Date(p.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                                        </small>
                                    </span>
                                    {p.topScore ? <span className={`clips-score-pill ${scoreTier(p.topScore)}`}>{p.topScore}</span> : null}
                                </button>
                            </li>
                        ))}
                    </ul>
                </aside>
            </div>
        </>
    );
}

function ProjectView({ id, onBack }) {
    const [project, setProject] = useState(null);
    const [error, setError] = useState('');

    // Polls while the project is processing; stops once it is completed or failed
    // (the server reports projects lost to a restart as failed).
    useEffect(() => {
        let timer = null;
        let cancelled = false;
        const load = async () => {
            try {
                const { project: data } = await clipsApi.get(id);
                if (cancelled) return;
                setProject(data);
                if (data.status === 'processing') timer = setTimeout(load, 2500);
            } catch (err) {
                if (!cancelled) setError(err.message || 'Could not load this project.');
            }
        };
        load();
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [id]);

    const remove = async () => {
        if (!window.confirm('Delete this project and its clips?')) return;
        try {
            await clipsApi.remove(id);
            onBack();
        } catch (err) {
            setError(err.message);
        }
    };

    const clips = (project?.clips || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    const processing = project?.status === 'processing';
    const current = stepIndex(project?.stage);

    return (
        <>
            <header className="page-head clips-project-head">
                <div>
                    <button className="clips-back" onClick={onBack}>
                        <ArrowLeft size={15} /> All clips
                    </button>
                    <h1>{project?.sourceName || 'Clip project'}</h1>
                    <p>
                        {project?.duration ? `${formatTime(project.duration)} source, ` : ''}
                        {project?.request
                            ? `${SHORT_PLATFORMS.find((p) => p.id === project.request.platform)?.label || project.request.ratio} clips of ${LENGTHS.find((l) => l.id === project.request.length)?.label}${project.request.layout ? `, ${LAYOUTS.find((l) => l.id === project.request.layout)?.label.toLowerCase()} framing` : ''}`
                            : ''}
                        {project?.request?.prompt ? `, matching “${project.request.prompt}”` : ''}
                    </p>
                </div>
                {project && !processing ? (
                    <button className="btn btn-ghost btn-sm" onClick={remove}>
                        <Trash2 size={15} /> Delete
                    </button>
                ) : null}
            </header>

            {error ? <div className="error-banner">{error}</div> : null}
            {!project && !error ? (
                <p className="muted">
                    <Loader2 size={15} className="spin" /> Loading…
                </p>
            ) : null}

            {processing ? (
                <section className="surface clips-progress">
                    <ol className="steps">
                        {STEPS.map((s, i) => (
                            <li key={s} className={i < current ? 'is-done' : i === current ? 'is-current' : ''}>
                                <span className="steps__dot">{i < current ? <Check size={12} /> : i + 1}</span>
                                {s}
                                {i === current && project.stage && project.stage !== s ? <em>{project.stage}</em> : null}
                            </li>
                        ))}
                    </ol>
                    <div className="progress">
                        <div style={{ width: `${project.progress || 0}%` }} />
                    </div>
                    <small className="muted">
                        {project.progress || 0}%. Transcribing takes roughly a quarter of the video's length. You can leave this page; the project keeps going.
                    </small>
                </section>
            ) : null}

            {project?.status === 'failed' ? (
                <div className="error-banner">
                    {project.error || 'This project failed.'}
                    <div className="clips-failed-actions">
                        <button className="btn btn-primary btn-sm" onClick={onBack}>
                            {project.errorCode === 'YOUTUBE_BLOCKED' ? (
                                'Upload the video file instead'
                            ) : (
                                <>
                                    <RotateCcw size={14} /> Try again
                                </>
                            )}
                        </button>
                    </div>
                </div>
            ) : null}
            {project?.note ? <p className="clips-note">{project.note}</p> : null}

            {clips.length ? (
                <div className={`clips-grid is-${(project.request?.ratio || '9:16').replace(':', 'x')}`}>
                    {clips.map((clip) => (
                        <ClipCard key={clip.id} clip={clip} ratio={project.request?.ratio || '9:16'} platform={project.request?.platform} sourceUploadId={project.sourceUploadId} />
                    ))}
                </div>
            ) : null}
        </>
    );
}

function ClipCard({ clip, ratio, platform, sourceUploadId }) {
    const navigate = useNavigate();
    const setEditorVideo = useEditorStore((s) => s.setVideo);
    const [videoUrl, setVideoUrl] = useState(null);
    const [busy, setBusy] = useState('');
    const [copied, setCopied] = useState('');
    const [error, setError] = useState('');
    const [thumbnail, setThumbnail] = useState(false);
    const blobRef = useRef(null);

    useEffect(() => () => videoUrl && URL.revokeObjectURL(videoUrl), [videoUrl]);

    const getBlob = async () => {
        if (!blobRef.current) blobRef.current = await clipsApi.download(clip.downloadUrl);
        return blobRef.current;
    };
    const fileName = `${safeName(clip.title)}.mp4`;

    const run = async (label, fn) => {
        setBusy(label);
        setError('');
        try {
            await fn();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy('');
        }
    };

    const play = () => run('play', async () => setVideoUrl(URL.createObjectURL(await getBlob())));
    const download = () =>
        run('download', async () => {
            const url = URL.createObjectURL(await getBlob());
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
    const edit = () =>
        run('edit', async () => {
            setEditorVideo(new File([await getBlob()], fileName, { type: 'video/mp4' }));
            navigate('/editor');
        });
    const schedule = () =>
        run('schedule', async () => {
            const target = SHORT_PLATFORMS.find((p) => p.id === platform)?.calendar;
            navigate('/dashboard/scheduler', {
                state: { mediaFile: new File([await getBlob()], fileName, { type: 'video/mp4' }), caption: clip.caption || clip.title, platforms: target ? [target] : undefined },
            });
        });
    const copyCaption = async () => {
        try {
            await navigator.clipboard.writeText(clip.caption || clip.title);
            setCopied('ok');
            setError('');
        } catch {
            setCopied('');
            setError("Couldn't copy to the clipboard. Select the caption text and copy it manually.");
            return;
        }
        setTimeout(() => setCopied(''), 1500);
    };

    if (clip.error) {
        return (
            <article className="clip-card is-failed">
                <div className="clip-card__body">
                    <strong>{clip.title}</strong>
                    <p className="muted">This clip could not be rendered: {clip.error}</p>
                </div>
            </article>
        );
    }

    return (
        <article className="clip-card">
            <div className={`clip-card__media is-${ratio.replace(':', 'x')}`}>
                {videoUrl ? (
                    <video src={videoUrl} poster={clip.poster || undefined} controls autoPlay playsInline />
                ) : (
                    <button className="clip-card__poster" onClick={play} aria-label={`Play ${clip.title}`}>
                        {clip.poster ? <img src={clip.poster} alt="" /> : null}
                        <span className="clip-card__play">{busy === 'play' ? <Loader2 size={20} className="spin" /> : <Play size={20} />}</span>
                    </button>
                )}
                <span className={`clip-card__score ${scoreTier(clip.score)}`} title="Editorial estimate, not a prediction of views or retention">
                    {Number.isFinite(clip.score) ? clip.score : 'Review'}
                </span>
            </div>

            <div className="clip-card__body">
                <div className="clip-card__meta">
                    <span>#{clip.rank}</span>
                    <span>
                        {formatTime(clip.start)}–{formatTime(clip.end)}
                    </span>
                    <span>{Math.round(clip.duration || clip.end - clip.start)}s</span>
                </div>
                <h3>{clip.title}</h3>
                {clip.why ? <p className="clip-card__why">{clip.why}</p> : null}

                {clip.scores ? (
                    <div className="clip-card__scores">
                        {SCORE_PARTS.filter(part => Number.isFinite(clip.scores[part.id])).map((part) => (
                            <div key={part.id} className="clip-card__bar">
                                <span>{part.label}</span>
                                <div>
                                    <i style={{ width: `${clip.scores[part.id]}%` }} />
                                </div>
                                <b>{clip.scores[part.id]}</b>
                            </div>
                        ))}
                    </div>
                ) : null}

                {clip.caption ? (
                    <div className="clip-card__caption">
                        <p>{clip.caption}</p>
                        <button className="btn-icon btn-sm" onClick={copyCaption} title="Copy caption" aria-label="Copy caption">
                            {copied === 'ok' ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                    </div>
                ) : null}

                {error ? <p className="clip-card__error">{error}</p> : null}

                <div className="clip-card__actions">
                    <button className="btn btn-primary btn-sm" onClick={schedule} disabled={!!busy}>
                        {busy === 'schedule' ? <Loader2 size={14} className="spin" /> : <CalendarPlus size={14} />} Schedule
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={edit} disabled={!!busy}>
                        {busy === 'edit' ? <Loader2 size={14} className="spin" /> : <Scissors size={14} />} Edit
                    </button>
                    {clip.outputUploadId ? (
                        <button className="btn btn-secondary btn-sm" onClick={() => setThumbnail(true)} disabled={!!busy}>
                            <ImagePlus size={14} /> Thumbnail
                        </button>
                    ) : null}
                    <SaveToLibraryButton downloadUrl={clip.downloadUrl} title={clip.title} caption={clip.caption || ''} />
                    <button className="btn btn-ghost btn-sm" onClick={download} disabled={!!busy} aria-label="Download">
                        {busy === 'download' ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                    </button>
                </div>
            </div>
            {thumbnail ? (
                <ThumbnailStudio
                    // Frames from the original video at this clip's times (no burned-in captions to
                    // clash with the headline); the finished clip if the original has expired.
                    uploadId={sourceUploadId && Number.isFinite(clip.start) ? sourceUploadId : clip.outputUploadId}
                    start={sourceUploadId && Number.isFinite(clip.start) ? clip.start : 0}
                    end={sourceUploadId && Number.isFinite(clip.end) ? clip.end : null}
                    fallbackUploadId={sourceUploadId ? clip.outputUploadId : null}
                    title={clip.title || ''}
                    hook={clip.hook || ''}
                    caption={clip.caption || ''}
                    defaultFormat={ratio === '16:9' ? 'youtube' : 'tiktok'}
                    onClose={() => setThumbnail(false)}
                />
            ) : null}
        </article>
    );
}
