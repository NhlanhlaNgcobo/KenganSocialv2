import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarCheck, CalendarPlus, Check, Copy, FileText, Film, Link2, Loader2, Repeat2, Scissors, Upload, Youtube } from 'lucide-react';
import ShortsSettings from '../../components/clips/ShortsSettings';
import { DEFAULT_SHORTS_OPTIONS, shortsRequest } from '../../components/clips/shorts-options';
import { useWorkspace } from '../../context/WorkspaceContext';
import { apiClient } from '../../lib/api';
import { clipsApi, formatTime, uploadVideo } from '../../lib/clips-api';
import { formatSlot, nextFreeSlot, repurposeApi, schedulePost } from '../../lib/repurpose-api';
import './Repurpose.css';

/**
 * Repurpose: one source (an article link, your own text, or a clip from Clips) →
 * posts written natively for each platform, ready to copy or schedule.
 * The "Video → shorts" source instead auto-cuts a long video (a YouTube link or a file from the
 * device) into short clips for TikTok, Shorts or Reels (via Clips).
 */

const SOURCES = [
    { id: 'url', label: 'Link', icon: Link2 },
    { id: 'text', label: 'Text', icon: FileText },
    { id: 'clip', label: 'A clip', icon: Film },
    { id: 'youtube', label: 'Video → shorts', icon: Scissors },
];

const PLATFORMS = [
    { id: 'instagram', label: 'Instagram', limit: 2200, calendar: true },
    { id: 'tiktok', label: 'TikTok', limit: 2200, calendar: true },
    { id: 'facebook', label: 'Facebook', limit: 63206, schedulable: true, calendar: true },
    { id: 'youtube', label: 'YouTube', limit: 5000, calendar: true },
];

const TONES = ['Friendly', 'Professional', 'Bold', 'Educational', 'Witty'];

export default function RepurposePage() {
    const [source, setSource] = useState('url');
    const [url, setUrl] = useState('');
    const [text, setText] = useState('');
    const [title, setTitle] = useState('');
    const [projects, setProjects] = useState(null);
    const [projectId, setProjectId] = useState('');
    const [project, setProject] = useState(null);
    const [clipId, setClipId] = useState('');
    const [platforms, setPlatforms] = useState(['instagram', 'facebook', 'tiktok', 'youtube']);
    const [tone, setTone] = useState('Friendly');
    const [audience, setAudience] = useState('');
    const [cta, setCta] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const [ytUrl, setYtUrl] = useState('');
    const [ytRights, setYtRights] = useState(false);
    // Video → shorts: a YouTube link or a file from this device, plus the shared shorts settings.
    const [videoFrom, setVideoFrom] = useState('link');
    const [videoFile, setVideoFile] = useState(null);
    const [videoInfo, setVideoInfo] = useState(null);
    const [uploadPct, setUploadPct] = useState(null);
    const [shorts, setShorts] = useState(DEFAULT_SHORTS_OPTIONS);
    const fileRef = useRef(null);
    const setShortsOpt = (patch) => setShorts((o) => ({ ...o, ...patch }));
    // Platforms with an active connection; null while loading. Scheduling a text post needs one.
    const [connected, setConnected] = useState(null);
    const navigate = useNavigate();
    const { currentWorkspace } = useWorkspace();

    useEffect(() => {
        if (!currentWorkspace?.id) return;
        let cancelled = false;
        apiClient(`/workspaces/${currentWorkspace.id}/connections`)
            .then((d) => !cancelled && setConnected((d.connections || []).filter((c) => c.status === 'active').map((c) => c.platform)))
            .catch(() => !cancelled && setConnected([]));
        return () => {
            cancelled = true;
        };
    }, [currentWorkspace?.id]);

    // Clip projects are loaded the first time the "A clip" source is picked.
    useEffect(() => {
        if (source !== 'clip' || projects) return;
        clipsApi
            .list()
            .then((d) => setProjects((d.projects || []).filter((p) => p.status === 'completed' && p.clipCount > 0)))
            .catch(() => setProjects([]));
    }, [source, projects]);

    useEffect(() => {
        setProject(null);
        setClipId('');
        if (!projectId) return;
        clipsApi
            .get(projectId)
            .then((d) => {
                setProject(d.project);
                const first = (d.project.clips || []).find((c) => !c.error && c.transcript);
                if (first) setClipId(first.id);
            })
            .catch((err) => setError(err.message || 'Could not load that clip project. Try again.'));
    }, [projectId]);

    const clip = project?.clips?.find((c) => c.id === clipId);
    const togglePlatform = (id) => setPlatforms((list) => (list.includes(id) ? list.filter((p) => p !== id) : [...list, id]));

    // A YouTube video link in the Link tab is read from its captions (or transcribed).
    const linkIsYoutube = /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com\/(watch|shorts|live|embed)|youtu\.be\/)/i.test(url.trim());
    const [linkRights, setLinkRights] = useState(false);
    // When YouTube blocks reading a link, the video can be uploaded instead (it is transcribed).
    const [linkBlocked, setLinkBlocked] = useState(false);
    const [fallbackFile, setFallbackFile] = useState(null);
    const fallbackInput = useRef(null);
    const canSubmit =
        platforms.length > 0 &&
        ((source === 'url' && url.trim().length > 4 && (!linkIsYoutube || linkRights)) || (source === 'text' && text.trim().length >= 80) || (source === 'clip' && clip?.transcript));

    const isYoutube = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch|shorts|live)|youtu\.be\/)/i.test(ytUrl.trim());

    const chooseVideo = (picked) => {
        if (!picked) return;
        if (!picked.type.startsWith('video/')) {
            setError('Choose a video file (MP4, MOV or WebM).');
            return;
        }
        setError('');
        setVideoFile(picked);
        setVideoInfo(null);
        const objectUrl = URL.createObjectURL(picked);
        const probe = document.createElement('video');
        probe.preload = 'metadata';
        probe.onloadedmetadata = () => {
            setVideoInfo({ duration: probe.duration });
            URL.revokeObjectURL(objectUrl);
        };
        probe.onerror = () => URL.revokeObjectURL(objectUrl);
        probe.src = objectUrl;
    };

    const makeShorts = async () => {
        setBusy(true);
        setError('');
        try {
            let id;
            if (videoFrom === 'upload') {
                setUploadPct(0);
                const sourceUploadId = await uploadVideo(videoFile, setUploadPct);
                ({ id } = await clipsApi.create({ ...shortsRequest(shorts), sourceUploadId, sourceName: videoFile.name }));
            } else {
                const url = /^https?:\/\//i.test(ytUrl.trim()) ? ytUrl.trim() : `https://${ytUrl.trim()}`;
                ({ id } = await clipsApi.fromUrl({ ...shortsRequest(shorts), url, rightsConfirmed: ytRights }));
            }
            navigate(`/dashboard/clips?project=${encodeURIComponent(id)}`);
        } catch (err) {
            setError(err.message);
            setBusy(false);
            setUploadPct(null);
        }
    };
    const shortsReady = Boolean(shorts.platform) && (videoFrom === 'upload' ? Boolean(videoFile) : isYoutube && ytRights);

    const generate = async () => {
        setBusy(true);
        setError('');
        setResult(null);
        try {
            const sourceBody =
                source === 'url'
                    ? { type: 'url', url: url.trim() }
                    : source === 'text'
                      ? { type: 'text', text, title }
                      : { type: 'text', text: clip.transcript, title: clip.title };
            setResult(
                await repurposeApi.generate({
                    source: sourceBody,
                    platforms,
                    tone,
                    audience,
                    cta,
                    ...(source === 'url' && linkIsYoutube ? { rightsConfirmed: linkRights } : {}),
                })
            );
        } catch (err) {
            if (err.data?.code === 'YOUTUBE_BLOCKED') setLinkBlocked(true);
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    /** Fallback for a blocked YouTube link: upload the video file, transcribe it, write the posts. */
    const generateFromUpload = async () => {
        if (!fallbackFile) return;
        setBusy(true);
        setError('');
        setResult(null);
        try {
            setUploadPct(0);
            const uploadId = await uploadVideo(fallbackFile, setUploadPct);
            setUploadPct(null);
            setResult(
                await repurposeApi.generate({
                    source: { type: 'upload', uploadId, name: fallbackFile.name.replace(/\.[^.]+$/, '') },
                    platforms,
                    tone,
                    audience,
                    cta,
                })
            );
            setLinkBlocked(false);
        } catch (err) {
            setError(err.message);
        } finally {
            setUploadPct(null);
            setBusy(false);
        }
    };

    return (
        <div className="repurpose-page">
            <header className="page-head">
                <div>
                    <h1>Repurpose</h1>
                    <p>Turn one article, idea or clip into posts written for each platform, then copy them or put them on the calendar.</p>
                </div>
            </header>

            <div className="repurpose-layout">
                <section className="surface repurpose-form">
                    <div className="segmented" role="tablist" aria-label="Source">
                        {SOURCES.map((s) => (
                            <button key={s.id} role="tab" aria-selected={source === s.id} className={source === s.id ? 'is-active' : ''} onClick={() => setSource(s.id)} disabled={busy}>
                                <s.icon size={15} /> {s.label}
                            </button>
                        ))}
                    </div>

                    {source === 'url' ? (
                        <label className="field">
                            <span>Article, page or YouTube video</span>
                            <input className="input" placeholder="yourblog.com/latest-post or a YouTube link" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} />
                            <small>
                                {linkIsYoutube
                                    ? 'We read the video’s captions (or transcribe it if it has none) and write posts from what is said.'
                                    : 'Blog posts, news articles, newsletters, landing pages and YouTube videos.'}
                            </small>
                        </label>
                    ) : null}
                    {source === 'url' && linkIsYoutube ? (
                        <label className="check">
                            <input type="checkbox" checked={linkRights} onChange={(e) => setLinkRights(e.target.checked)} disabled={busy} />
                            I own this video or have permission to repurpose it
                        </label>
                    ) : null}
                    {source === 'url' && linkIsYoutube && linkBlocked ? (
                        <div className="repurpose-fallback" role="status">
                            <strong>YouTube didn’t let our server read this video.</strong>
                            <p>Upload the video file instead and we’ll transcribe it and write the posts. You can download your own video from YouTube Studio (Content → ⋮ → Download).</p>
                            <input ref={fallbackInput} type="file" accept="video/*,audio/*" hidden onChange={(e) => setFallbackFile(e.target.files?.[0] || null)} />
                            <div className="repurpose-fallback__actions">
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => fallbackInput.current?.click()} disabled={busy}>
                                    <Upload size={14} /> {fallbackFile ? fallbackFile.name : 'Choose the video'}
                                </button>
                                <button type="button" className="btn btn-primary btn-sm" onClick={generateFromUpload} disabled={busy || !fallbackFile || !platforms.length}>
                                    {busy ? <Loader2 size={14} className="spin" /> : null} Write posts from the upload
                                </button>
                                <button type="button" className="link-button" onClick={() => (setSource('text'), setLinkBlocked(false))} disabled={busy}>
                                    or paste the transcript
                                </button>
                            </div>
                            {uploadPct !== null ? <small>Uploading… {uploadPct}%</small> : null}
                        </div>
                    ) : null}

                    {source === 'text' ? (
                        <>
                            <label className="field">
                                <span>
                                    Title <em>optional</em>
                                </span>
                                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
                            </label>
                            <label className="field">
                                <span>Your text</span>
                                <textarea
                                    className="input"
                                    rows={7}
                                    placeholder="Notes, a script, a newsletter, a transcript…"
                                    value={text}
                                    onChange={(e) => setText(e.target.value)}
                                    disabled={busy}
                                />
                                <small>{text.trim().length < 80 ? `At least 80 characters (${text.trim().length} so far).` : `${text.trim().length.toLocaleString()} characters`}</small>
                            </label>
                        </>
                    ) : null}

                    {source === 'youtube' ? (
                        <>
                            <div className="segmented" role="tablist" aria-label="Video source">
                                <button role="tab" aria-selected={videoFrom === 'link'} className={videoFrom === 'link' ? 'is-active' : ''} onClick={() => setVideoFrom('link')} disabled={busy}>
                                    <Youtube size={15} /> YouTube link
                                </button>
                                <button role="tab" aria-selected={videoFrom === 'upload'} className={videoFrom === 'upload' ? 'is-active' : ''} onClick={() => setVideoFrom('upload')} disabled={busy}>
                                    <Upload size={15} /> Upload from device
                                </button>
                            </div>

                            {videoFrom === 'link' ? (
                                <>
                                    <label className="field">
                                        <span>YouTube video link</span>
                                        <input
                                            className="input"
                                            placeholder="https://www.youtube.com/watch?v=…"
                                            value={ytUrl}
                                            onChange={(e) => setYtUrl(e.target.value)}
                                            disabled={busy}
                                        />
                                        <small>Your long video is auto-cut into short clips with captions, ranked by how likely they are to hold attention.</small>
                                    </label>
                                    <label className="repurpose-rights">
                                        <input type="checkbox" checked={ytRights} onChange={(e) => setYtRights(e.target.checked)} disabled={busy} />
                                        <span>I own this video or have permission to repurpose it.</span>
                                    </label>
                                    <small className="repurpose-hint">
                                        If YouTube blocks the automatic download, download the video from YouTube Studio (Content → ⋮ → Download) and{' '}
                                        <button type="button" className="link-button" onClick={() => setVideoFrom('upload')}>
                                            upload the file
                                        </button>
                                        .
                                    </small>
                                </>
                            ) : (
                                <button
                                    type="button"
                                    className={`repurpose-drop ${videoFile ? 'has-file' : ''}`}
                                    onClick={() => fileRef.current?.click()}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        if (!busy) chooseVideo(e.dataTransfer.files?.[0]);
                                    }}
                                    disabled={busy}
                                >
                                    <input ref={fileRef} type="file" accept="video/*" hidden onChange={(e) => chooseVideo(e.target.files?.[0])} />
                                    {videoFile ? <Film size={20} /> : <Upload size={20} />}
                                    <strong>{videoFile ? videoFile.name : 'Drop a long video here or click to choose'}</strong>
                                    <small>
                                        {videoFile
                                            ? `${videoInfo ? `${formatTime(videoInfo.duration)} long, ` : ''}${(videoFile.size / (1024 * 1024)).toFixed(0)} MB. Click to change.`
                                            : 'MP4, MOV or WebM up to 2 GB: a podcast, interview, stream or talk.'}
                                    </small>
                                </button>
                            )}

                            <ShortsSettings value={shorts} onChange={setShortsOpt} disabled={busy} countLabel="Shorts" />
                        </>
                    ) : null}

                    {source === 'clip' ? (
                        <div className="field-row">
                            <label className="field">
                                <span>Clip project</span>
                                <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={busy}>
                                    <option value="">{projects === null ? 'Loading…' : projects.length ? 'Choose a project' : 'No finished clip projects yet'}</option>
                                    {projects?.map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.sourceName} ({p.clipCount})
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="field">
                                <span>Clip</span>
                                <select className="input" value={clipId} onChange={(e) => setClipId(e.target.value)} disabled={busy || !project}>
                                    {(project?.clips || [])
                                        .filter((c) => !c.error && c.transcript)
                                        .map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {c.title} ({c.score})
                                            </option>
                                        ))}
                                </select>
                            </label>
                        </div>
                    ) : null}

                    {source !== 'youtube' ? (
                    <>
                    <div className="field">
                        <span>Platforms</span>
                        <div className="repurpose-platforms">
                            {PLATFORMS.map((p) => (
                                <button key={p.id} className={`chip ${platforms.includes(p.id) ? 'is-active' : ''}`} onClick={() => togglePlatform(p.id)} aria-pressed={platforms.includes(p.id)} disabled={busy}>
                                    {platforms.includes(p.id) ? <Check size={13} /> : null} {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="field">
                        <span>Voice</span>
                        <div className="segmented">
                            {TONES.map((t) => (
                                <button key={t} className={tone === t ? 'is-active' : ''} onClick={() => setTone(t)} disabled={busy}>
                                    {t}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="field-row">
                        <label className="field">
                            <span>
                                Audience <em>optional</em>
                            </span>
                            <input className="input" placeholder="e.g. Durban restaurant owners" value={audience} onChange={(e) => setAudience(e.target.value)} disabled={busy} />
                        </label>
                        <label className="field">
                            <span>
                                Call to action <em>optional</em>
                            </span>
                            <input className="input" placeholder="e.g. Book a free call at …" value={cta} onChange={(e) => setCta(e.target.value)} disabled={busy} />
                        </label>
                    </div>

                    </>
                    ) : null}

                    {error ? <div className="error-banner">{error}</div> : null}

                    {source === 'youtube' ? (
                        <button className="btn btn-primary btn-block" onClick={makeShorts} disabled={!shortsReady || busy}>
                            {busy ? <Loader2 size={16} className="spin" /> : <Scissors size={16} />}
                            {busy
                                ? uploadPct !== null && uploadPct < 100
                                    ? `Uploading… ${uploadPct}%`
                                    : 'Starting…'
                                : !shorts.platform
                                  ? 'Choose TikTok, Shorts or Reels above'
                                  : `Make ${shorts.count} shorts`}
                        </button>
                    ) : (
                        <button className="btn btn-primary btn-block" onClick={generate} disabled={!canSubmit || busy}>
                            {busy ? <Loader2 size={16} className="spin" /> : <Repeat2 size={16} />}
                            {busy ? 'Writing posts…' : `Write ${platforms.length} post${platforms.length === 1 ? '' : 's'}`}
                        </button>
                    )}
                </section>

                <section className="repurpose-results">
                    {source === 'youtube' ? (
                        <div className="surface repurpose-empty">
                            {busy ? <Loader2 size={24} className="spin" /> : <Scissors size={26} />}
                            <h3>{busy ? 'Starting your shorts' : 'Long video in, shorts out'}</h3>
                            <p>
                                We transcribe the video, pick the moments most likely to hold attention, frame the faces (two speakers get stacked so nobody is cut off) and burn in
                                your caption template. You'll follow the progress in Clips, and each short can go straight to the calendar.
                            </p>
                        </div>
                    ) : null}
                    {source !== 'youtube' && !result && !busy ? (
                        <div className="surface repurpose-empty">
                            <Repeat2 size={26} />
                            <h3>Posts appear here</h3>
                            <p>Each platform gets its own format: an Instagram caption with hashtags, a Facebook post, a TikTok script and YouTube title, description and tags. Everything stays editable.</p>
                        </div>
                    ) : null}
                    {source !== 'youtube' && busy ? (
                        <div className="surface repurpose-empty">
                            <Loader2 size={24} className="spin" />
                            <p>
                                {source === 'url' && linkIsYoutube
                                    ? `Reading the video and writing ${platforms.length} posts. About 30 seconds, or a few minutes if the video has no captions and has to be transcribed.`
                                    : `Reading the source and writing ${platforms.length} posts. This takes about 20 seconds.`}
                            </p>
                        </div>
                    ) : null}
                    {result ? (
                        <>
                            <div className="repurpose-angle">
                                {result.origin ? (
                                    <span>
                                        From <a href={result.origin.url} target="_blank" rel="noreferrer">{result.origin.siteName}</a> ·{' '}
                                    </span>
                                ) : null}
                                {result.angle}
                            </div>
                            {PLATFORMS.filter((p) => result.drafts[p.id]).map((p) => (
                                <DraftCard key={`${p.id}:${result.drafts[p.id].postText}`} platform={p} draft={result.drafts[p.id]} connected={connected} />
                            ))}
                        </>
                    ) : null}
                </section>
            </div>
        </div>
    );
}

function DraftCard({ platform, draft, connected }) {
    const navigate = useNavigate();
    const [value, setValue] = useState(draft.postText);
    const [copied, setCopied] = useState(false);
    const [slot, setSlot] = useState(null);
    const [state, setState] = useState('');
    const [error, setError] = useState('');
    const [warning, setWarning] = useState('');
    const isConnected = connected?.includes(platform.id);
    const canSchedule = platform.schedulable && isConnected;

    useEffect(() => {
        if (canSchedule) nextFreeSlot(platform.id).then(setSlot);
    }, [platform, canSchedule]);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value);
        } catch {
            setError("Couldn't copy to the clipboard. Select the text and copy it manually.");
            return;
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const schedule = async () => {
        setState('scheduling');
        setError('');
        setWarning('');
        try {
            const res = await schedulePost({ platform: platform.id, caption: value, at: slot });
            if (res?.queued === false) {
                setWarning("Saved to your calendar, but the publishing queue is offline right now, so it won't post automatically. Check the calendar and use Publish now later.");
            }
            setState('scheduled');
        } catch (err) {
            setError(err.message);
            setState('');
        }
    };

    // Multi-post formats: count each post as it is now in the text box (posts are separated by blank lines).
    const threadPosts = platform.perPost ? value.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean) : [];
    const overLimit = platform.perPost ? threadPosts.some((t) => t.length > platform.limit) : value.length > platform.limit;

    return (
        <article className="surface draft-card">
            <header className="draft-card__head">
                <h3>{platform.label}</h3>
                <span className={`draft-card__count ${overLimit ? 'is-over' : ''}`}>
                    {platform.perPost
                        ? `${threadPosts.length} post${threadPosts.length === 1 ? '' : 's'}${overLimit ? `, one is over ${platform.limit}` : ''}`
                        : `${value.length.toLocaleString()} / ${platform.limit.toLocaleString()}`}
                </span>
            </header>

            {draft.script?.length ? (
                <div className="draft-card__script">
                    <span>Script</span>
                    <ol>
                        {draft.script.map((line, i) => (
                            <li key={i}>{line}</li>
                        ))}
                    </ol>
                </div>
            ) : null}

            {draft.script?.length ? <span className="draft-card__label">Caption</span> : null}
            <textarea className="input draft-card__text" value={value} onChange={(e) => setValue(e.target.value)} rows={Math.min(14, Math.max(3, Math.ceil(value.length / 70)))} />
            {draft.tags?.length ? <p className="draft-card__tags">Tags: {draft.tags.join(', ')}</p> : null}
            {error ? <p className="draft-card__error">{error}</p> : null}
            {warning ? <p className="draft-card__error" style={{ color: 'var(--warning)' }}>{warning}</p> : null}

            <div className="draft-card__actions">
                <button className="btn btn-secondary btn-sm" onClick={copy}>
                    {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
                </button>
                {platform.schedulable && connected && !isConnected ? (
                    <Link to="/dashboard/connections" className="btn btn-ghost btn-sm">
                        <CalendarPlus size={14} /> Connect {platform.label} to schedule
                    </Link>
                ) : null}
                {canSchedule ? (
                    state === 'scheduled' ? (
                        <span className="draft-card__done">
                            <CalendarCheck size={14} /> Scheduled for {formatSlot(slot)}
                        </span>
                    ) : (
                        <button className="btn btn-primary btn-sm" onClick={schedule} disabled={!slot || state === 'scheduling'}>
                            {state === 'scheduling' ? <Loader2 size={14} className="spin" /> : <CalendarPlus size={14} />}
                            {slot ? `Schedule for ${formatSlot(slot)}` : 'Finding a slot…'}
                        </button>
                    )
                ) : null}
                {platform.calendar ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => navigate('/dashboard/scheduler', { state: { caption: value } })}>
                        <CalendarPlus size={14} /> Add a video and schedule
                    </button>
                ) : null}
            </div>
        </article>
    );
}
