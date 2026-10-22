import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Download, Loader2, Mail, Scissors, X } from 'lucide-react';
import { API_URL, NETWORK_ERROR } from '../../lib/api';
import './FreeClip.css';

/**
 * Free starter clip for visitors: one captioned vertical clip from a long video, once per person
 * (checked by email on the server, routes/free-clip.ts). Upload → processing → play and download.
 */
const POLL_MS = 2500;
const STEPS = ['Uploading', 'Transcribing', 'Finding the best moments', 'Rendering'];

function stepIndex(stage) {
    if (!stage) return 0;
    if (/render/i.test(stage)) return 3;
    if (/moment|analy/i.test(stage)) return 2;
    if (/transcrib|waiting|queued/i.test(stage)) return 1;
    return 1;
}

export default function FreeClip({ file, onClose }) {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [consent, setConsent] = useState(false);
    const [marketing, setMarketing] = useState(false);
    const [phase, setPhase] = useState('form'); // form | uploading | processing | done | error
    const [uploadPct, setUploadPct] = useState(0);
    const [job, setJob] = useState(null); // { id, token }
    const [status, setStatus] = useState(null);
    const [error, setError] = useState('');
    const [errorCode, setErrorCode] = useState('');
    const [preview] = useState(() => (file ? URL.createObjectURL(file) : null));
    const xhrRef = useRef(null);

    useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);
    useEffect(() => () => xhrRef.current?.abort(), []);

    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && phase !== 'uploading' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [phase, onClose]);

    // Poll the job until it is done.
    useEffect(() => {
        if (!job || phase !== 'processing') return undefined;
        let stop = false;
        const tick = async () => {
            try {
                const res = await fetch(`${API_URL}/free-clip/${job.id}?token=${job.token}`);
                const body = await res.json().catch(() => ({}));
                if (stop) return;
                if (!res.ok) throw Object.assign(new Error(body.error || 'The clip could not be checked.'), { code: body.code });
                setStatus(body);
                if (body.status === 'completed') return setPhase('done');
                if (body.status === 'failed') {
                    setError(body.error || 'We could not make a clip from this video.');
                    return setPhase('error');
                }
            } catch (err) {
                if (stop) return;
                if (err instanceof TypeError) setStatus((s) => ({ ...s, offline: true }));
                else {
                    setError(err.message);
                    return setPhase('error');
                }
            }
            if (!stop) timer = setTimeout(tick, POLL_MS);
        };
        let timer = setTimeout(tick, 600);
        return () => {
            stop = true;
            clearTimeout(timer);
        };
    }, [job, phase]);

    const submit = (e) => {
        e.preventDefault();
        setError('');
        setErrorCode('');
        const form = new FormData();
        form.append('video', file);
        form.append('email', email.trim());
        form.append('consent', String(consent));
        form.append('marketing', String(marketing));
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open('POST', `${API_URL}/free-clip`);
        xhr.upload.onprogress = (ev) => ev.lengthComputable && setUploadPct(Math.round((ev.loaded / ev.total) * 100));
        xhr.onload = () => {
            let body = {};
            try {
                body = JSON.parse(xhr.responseText || '{}');
            } catch {
                body = {};
            }
            if (xhr.status === 202 && body.id) {
                setJob({ id: body.id, token: body.token });
                setPhase('processing');
            } else {
                setError(body.error || `The upload did not work (${xhr.status}). Try again.`);
                setErrorCode(body.code || '');
                setPhase(body.code === 'ALREADY_USED' ? 'error' : 'form');
            }
        };
        xhr.onerror = () => {
            setError(NETWORK_ERROR);
            setPhase('form');
        };
        setUploadPct(0);
        setPhase('uploading');
        xhr.send(form);
    };

    const videoUrl = job ? `${API_URL}/free-clip/${job.id}/video?token=${job.token}` : '';
    const current = phase === 'uploading' ? 0 : stepIndex(status?.stage);
    const progress = phase === 'uploading' ? uploadPct : Math.max(3, status?.progress || 0);
    const signUp = () => navigate('/register', { state: { email: email.trim() } });

    // Rendered on <body>: the hero's reveal animation (a transform) would otherwise trap the
    // fixed backdrop inside the hero.
    return createPortal(
        <div className="fc-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && phase === 'form' && onClose()}>
            <div className="fc-dialog" role="dialog" aria-modal="true" aria-labelledby="fc-title">
                <button className="fc-close" onClick={onClose} aria-label="Close" disabled={phase === 'uploading'}>
                    <X size={18} />
                </button>

                <div className="fc-media">
                    {phase === 'done' ? (
                        <video className="fc-video fc-video--result" src={videoUrl} autoPlay muted loop controls playsInline preload="auto" />
                    ) : preview ? (
                        <video className="fc-video" src={preview} muted playsInline autoPlay loop />
                    ) : null}
                    {phase === 'done' ? <span className="fc-badge">Your free clip</span> : null}
                </div>

                <div className="fc-body">
                    {phase === 'form' && (
                        <form onSubmit={submit} className="fc-form">
                            <span className="fc-kicker">
                                <Scissors size={14} /> Free starter clip
                            </span>
                            <h2 id="fc-title">Get one clip from this video, free</h2>
                            <p className="fc-lede">
                                We’ll find the strongest moment in <strong>{file?.name}</strong>, frame it for TikTok, Reels and Shorts, and add captions. One free clip per
                                person; no account needed.
                            </p>
                            <label className="fc-field">
                                <span>Your email</span>
                                <span className="fc-input">
                                    <Mail size={16} />
                                    <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourbrand.co.za" autoComplete="email" />
                                </span>
                            </label>
                            <label className="fc-check">
                                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
                                <span>
                                    I agree to the <Link to="/terms" target="_blank">Terms of Service</Link> and <Link to="/privacy" target="_blank">Privacy Policy</Link>. My email is used to keep
                                    this to one free clip per person.
                                </span>
                            </label>
                            <label className="fc-check">
                                <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
                                <span>Email me tips and product news (optional)</span>
                            </label>
                            {error ? (
                                <p className="fc-error" role="alert">
                                    {error}
                                </p>
                            ) : null}
                            <button type="submit" className="btn btn-primary btn-lg fc-submit" disabled={!consent || !email}>
                                Make my free clip <ArrowRight size={17} />
                            </button>
                            <small className="fc-small">Videos up to 30 minutes and 500 MB. Your video is deleted once the clip is made; the clip is kept for 72 hours.</small>
                        </form>
                    )}

                    {(phase === 'uploading' || phase === 'processing') && (
                        <div className="fc-progress" aria-live="polite">
                            <span className="fc-kicker">
                                <Loader2 size={14} className="spin" /> Working on it
                            </span>
                            <h2 id="fc-title">{phase === 'uploading' ? `Uploading ${uploadPct}%` : status?.stage || 'Starting'}</h2>
                            <div className="fc-bar">
                                <i style={{ width: `${progress}%` }} />
                            </div>
                            <ol className="fc-steps">
                                {STEPS.map((s, i) => (
                                    <li key={s} className={i < current ? 'is-done' : i === current ? 'is-active' : ''}>
                                        <span>{i < current ? <Check size={12} /> : i + 1}</span>
                                        {s}
                                    </li>
                                ))}
                            </ol>
                            <p className="fc-small">
                                {status?.offline
                                    ? NETWORK_ERROR
                                    : 'This takes a few minutes for a long video. Keep this tab open; you can watch the clip here when it’s ready.'}
                            </p>
                        </div>
                    )}

                    {phase === 'done' && (
                        <div className="fc-done">
                            <span className="fc-kicker">
                                <Check size={14} /> Ready
                            </span>
                            <h2 id="fc-title">{status?.clip?.title || 'Your clip is ready'}</h2>
                            {status?.clip?.caption ? <p className="fc-lede">{status.clip.caption}</p> : null}
                            <div className="fc-actions">
                                <a className="btn btn-secondary btn-lg" href={`${videoUrl}&download=1`}>
                                    <Download size={17} /> Download
                                </a>
                                <button className="btn btn-primary btn-lg" onClick={signUp}>
                                    More clips, free for 7 days <ArrowRight size={17} />
                                </button>
                            </div>
                            <p className="fc-small">Create a free account to get every moment from your video, schedule posts and edit clips. New accounts get 7 days of full access.</p>
                        </div>
                    )}

                    {phase === 'error' && (
                        <div className="fc-done">
                            <span className="fc-kicker">{errorCode === 'ALREADY_USED' ? 'Free clip used' : 'Something went wrong'}</span>
                            <h2 id="fc-title">{errorCode === 'ALREADY_USED' ? 'You’ve had your free clip' : 'No clip this time'}</h2>
                            <p className="fc-lede">{error}</p>
                            <div className="fc-actions">
                                {errorCode !== 'ALREADY_USED' ? (
                                    <button className="btn btn-secondary btn-lg" onClick={() => setPhase('form')}>
                                        Try again
                                    </button>
                                ) : null}
                                <button className="btn btn-primary btn-lg" onClick={signUp}>
                                    Create a free account <ArrowRight size={17} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}
