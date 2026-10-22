import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, ImagePlus, Loader2, Sparkles, Wand2, X } from 'lucide-react';
import { thumbnailsApi } from '../../lib/thumbnails-api';
import './ThumbnailStudio.css';

/**
 * Thumbnail maker for TikTok covers and YouTube. The video service scores frames for what gets
 * clicks (clear face, expression, sharpness, light, colour); pick one (or an AI background), a
 * headline about the video's topic, a style, and download the PNG.
 */
const STYLE_LABELS = { punch: 'Bold caps', banner: 'Banner', clean: 'Clean' };
const FORMAT_LABELS = { tiktok: 'TikTok cover', youtube: 'YouTube' };

export default function ThumbnailStudio({ uploadId, fallbackUploadId = null, start = 0, end = null, title = '', hook = '', caption = '', transcript = '', defaultFormat = 'tiktok', onClose }) {
    const [options, setOptions] = useState(null);
    const [candidates, setCandidates] = useState(null);
    const [selected, setSelected] = useState(null);
    const [format, setFormat] = useState(defaultFormat);
    const [style, setStyle] = useState('punch');
    const [headline, setHeadline] = useState('');
    const [highlight, setHighlight] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [brand, setBrand] = useState(false);
    const [preview, setPreview] = useState(null);
    const [rendering, setRendering] = useState(false);
    const [error, setError] = useState('');
    const [bgPrompt, setBgPrompt] = useState('');
    const [bgBusy, setBgBusy] = useState(false);
    const previewRef = useRef(null);

    useEffect(() => {
        let active = true;
        thumbnailsApi.options().then((o) => active && setOptions(o)).catch(() => {});
        thumbnailsApi
            .candidates({ uploadId, start, end })
            .catch((err) => (fallbackUploadId ? thumbnailsApi.candidates({ uploadId: fallbackUploadId }) : Promise.reject(err)))
            .then((data) => {
                if (!active) return;
                setCandidates(data.candidates);
                setSelected(data.candidates[0]?.id || null);
            })
            .catch((err) => active && setError(err.message));
        thumbnailsApi
            .headlines({ title, hook, caption, transcript })
            .then((data) => {
                if (!active) return;
                setSuggestions(data.headlines || []);
                if (data.headlines?.[0]) {
                    setHeadline(data.headlines[0].text);
                    setHighlight(data.headlines[0].highlight || '');
                }
                if (data.topic) setBgPrompt(`${data.topic}`);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [uploadId, fallbackUploadId, start, end, title, hook, caption, transcript]);

    // Re-render the preview shortly after anything changes.
    useEffect(() => {
        if (!selected) return undefined;
        let active = true;
        const timer = setTimeout(async () => {
            setRendering(true);
            try {
                const blob = await thumbnailsApi.render({ candidateId: selected, format, headline, highlight, style, brand, label: style === 'clean' ? 'New' : '' });
                if (!active) return;
                const url = URL.createObjectURL(blob);
                if (previewRef.current) URL.revokeObjectURL(previewRef.current);
                previewRef.current = url;
                setPreview(url);
                setError('');
            } catch (err) {
                if (active) setError(err.message);
            } finally {
                if (active) setRendering(false);
            }
        }, 450);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [selected, format, headline, highlight, style, brand]);

    useEffect(() => () => previewRef.current && URL.revokeObjectURL(previewRef.current), []);

    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const makeBackground = async () => {
        if (!bgPrompt.trim()) return;
        setBgBusy(true);
        setError('');
        try {
            const bg = await thumbnailsApi.background({ prompt: bgPrompt, format });
            setCandidates((list) => [{ ...bg, score: null, reasons: ['AI background'], ai: true }, ...(list || [])]);
            setSelected(bg.id);
        } catch (err) {
            setError(err.message);
        } finally {
            setBgBusy(false);
        }
    };

    const words = headline.split(/\s+/).filter(Boolean);

    // On <body>, so a transformed ancestor (cards, animations) can't trap the fixed backdrop.
    return createPortal(
        <div className="tb-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className="tb-dialog" role="dialog" aria-modal="true" aria-labelledby="tb-title">
                <header className="tb-head">
                    <h2 id="tb-title">
                        <ImagePlus size={18} /> Thumbnail
                    </h2>
                    <button className="tb-close" onClick={onClose} aria-label="Close">
                        <X size={18} />
                    </button>
                </header>

                <div className="tb-body">
                    <section className={`tb-preview tb-preview--${format}`}>
                        <div className="tb-canvas">
                            {preview ? <img src={preview} alt="Thumbnail preview" /> : null}
                            {rendering || !preview ? (
                                <span className="tb-busy">
                                    <Loader2 size={20} className="spin" />
                                </span>
                            ) : null}
                        </div>
                        <a className={`btn btn-primary tb-download ${preview ? '' : 'is-disabled'}`} href={preview || undefined} download={`thumbnail-${format}.png`} aria-disabled={!preview}>
                            <Download size={16} /> Download PNG
                        </a>
                    </section>

                    <section className="tb-controls">
                        {error ? (
                            <p className="tb-error" role="alert">
                                {error}
                            </p>
                        ) : null}

                        <div className="tb-group">
                            <span className="tb-label">1. Frame</span>
                            {!candidates && !error ? (
                                <p className="tb-hint">
                                    <Loader2 size={14} className="spin" /> Finding the most clickable frames: clear faces, expression, sharpness and light…
                                </p>
                            ) : null}
                            <div className="tb-frames">
                                {(candidates || []).map((c, i) => (
                                    <button key={c.id} type="button" className={`tb-frame ${selected === c.id ? 'is-selected' : ''}`} onClick={() => setSelected(c.id)} title={c.reasons?.join(', ')}>
                                        <img src={c.preview} alt={`Frame ${i + 1}`} />
                                        {c.score !== null && c.score !== undefined ? <b>{Math.round(c.score)}</b> : <b>AI</b>}
                                        {i === 0 && !c.ai ? <span className="tb-best">Best</span> : null}
                                        <small>{(c.reasons || []).slice(0, 2).join(' · ')}</small>
                                    </button>
                                ))}
                            </div>
                            {options?.backgrounds ? (
                                <div className="tb-ai">
                                    <input className="input" value={bgPrompt} onChange={(e) => setBgPrompt(e.target.value)} placeholder="Or describe an AI background" />
                                    <button className="btn btn-secondary btn-sm" onClick={makeBackground} disabled={bgBusy || !bgPrompt.trim()}>
                                        {bgBusy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Generate
                                    </button>
                                </div>
                            ) : (
                                <p className="tb-hint">AI backgrounds turn on once an image generator is set up.</p>
                            )}
                        </div>

                        <div className="tb-group">
                            <span className="tb-label">2. Headline</span>
                            <input className="input" value={headline} maxLength={60} onChange={(e) => setHeadline(e.target.value)} placeholder="2 to 5 words work best" />
                            {words.length > 1 ? (
                                <div className="tb-chips" aria-label="Word to highlight">
                                    {words.map((w, i) => (
                                        <button key={`${w}-${i}`} type="button" className={`tb-chip ${highlight.toLowerCase() === w.toLowerCase() ? 'is-on' : ''}`} onClick={() => setHighlight(w)}>
                                            {w}
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                            {suggestions.length ? (
                                <div className="tb-suggest">
                                    <Wand2 size={13} />
                                    {suggestions.map((s) => (
                                        <button
                                            key={s.text}
                                            type="button"
                                            onClick={() => {
                                                setHeadline(s.text);
                                                setHighlight(s.highlight || '');
                                            }}
                                        >
                                            {s.text}
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </div>

                        <div className="tb-group">
                            <span className="tb-label">3. Style</span>
                            <div className="tb-seg">
                                {Object.entries(FORMAT_LABELS).map(([id, label]) => (
                                    <button key={id} type="button" className={format === id ? 'is-on' : ''} onClick={() => setFormat(id)}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <div className="tb-seg">
                                {Object.entries(STYLE_LABELS).map(([id, label]) => (
                                    <button key={id} type="button" className={style === id ? 'is-on' : ''} onClick={() => setStyle(id)}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <label className="check">
                                <input type="checkbox" checked={brand} onChange={(e) => setBrand(e.target.checked)} /> Use my brand colour and logo
                            </label>
                        </div>
                    </section>
                </div>
            </div>
        </div>,
        document.body
    );
}
