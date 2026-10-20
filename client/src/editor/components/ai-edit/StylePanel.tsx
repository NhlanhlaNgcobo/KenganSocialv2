import { useEffect, useRef, useState } from 'react';
import { Film, Link2, Loader2, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { previewFont } from '../../constants';
import type { StyleProfile } from '../../lib/ai-edit';
import { useAiEditStore } from '../../stores/ai-edit-store';

const LOOK_SWATCH: Record<string, string> = {
    natural: 'linear-gradient(135deg,#c9a27e,#6b8fa8)',
    warm: 'linear-gradient(135deg,#f0a35e,#b0624a)',
    cool: 'linear-gradient(135deg,#5e8ef0,#2f4f7a)',
    punchy: 'linear-gradient(135deg,#ff5d73,#ffc533,#28c76f)',
    muted: 'linear-gradient(135deg,#a7a29a,#6f7680)',
    mono: 'linear-gradient(135deg,#f2f2f2,#1d1d1d)',
    contrasty: 'linear-gradient(135deg,#111,#e9e2d0)',
};

/** A sample caption drawn in the style's font, colours and treatment. */
export function CaptionSample({ style }: { style: StyleProfile }) {
    const c = style.captions;
    if (!c.enabled) return <span className="ke-muted">No captions</span>;
    const words = ['this', 'is', 'how', 'it', 'looks', 'on', 'screen'].slice(0, Math.max(1, c.wordsPerCaption));
    const text = c.uppercase ? words.join(' ').toUpperCase() : words.join(' ').replace(/^./, (x) => x.toUpperCase());
    const last = text.split(' ').pop();
    const head = text.slice(0, text.length - (last?.length || 0));
    return (
        <span
            className="aie-caption-sample"
            style={{
                fontFamily: previewFont(c.font),
                color: c.color,
                background: c.background ? 'rgba(0,0,0,0.62)' : 'transparent',
                WebkitTextStroke: c.outline ? '3px #000' : undefined,
                paintOrder: 'stroke fill',
            }}
        >
            {head}
            <span style={{ color: c.highlight || c.color }}>{last}</span>
        </span>
    );
}

export function StyleFacts({ style }: { style: StyleProfile }) {
    const c = style.captions;
    return (
        <div className="aie-facts">
            <div>
                <span>Format</span>
                <strong>{style.format.ratio}</strong>
            </div>
            <div>
                <span>Pacing</span>
                <strong>
                    {style.pacing.label} · cuts pauses over {style.pacing.maxPauseSec.toFixed(2)}s
                </strong>
            </div>
            <div>
                <span>Zooms</span>
                <strong>{style.zooms.punchIns ? `punch-in ~${Math.round(style.zooms.perMinute)}×/min` : style.zooms.slowZoom ? 'slow push-ins' : 'none'}</strong>
            </div>
            <div>
                <span>Colour</span>
                <strong className="aie-look">
                    <i style={{ background: LOOK_SWATCH[style.color.look] || LOOK_SWATCH.natural }} /> {style.color.look}
                    {style.color.stats ? ' · matched to reference' : ''}
                </strong>
            </div>
            <div>
                <span>Captions</span>
                <strong>{c.enabled ? `${c.wordsPerCaption} words · ${c.y < 0.4 ? 'top' : c.y < 0.75 ? 'middle' : 'bottom'} · ${c.font}` : 'off'}</strong>
            </div>
            <div>
                <span>Hook</span>
                <strong>{[style.hook.title && 'title', style.hook.coldOpen && 'cold open', style.callouts.enabled && 'keyword callouts'].filter(Boolean).join(' · ') || 'none'}</strong>
            </div>
        </div>
    );
}

function StyleItem({ style, selected, onSelect, onDelete }: { style: StyleProfile; selected: boolean; onSelect: () => void; onDelete?: () => void }) {
    return (
        <div className={`aie-style ${selected ? 'is-selected' : ''}`} role="button" tabIndex={0} onClick={onSelect} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}>
            <div className="aie-style__thumb">{style.thumbnail ? <img src={style.thumbnail} alt="" /> : style.source?.type === 'preset' ? <Sparkles size={18} /> : <Film size={18} />}</div>
            <div className="aie-style__body">
                <strong>{style.name}</strong>
                <span>
                    {style.source?.type === 'preset' ? 'Built-in' : style.source?.title || (style.source?.type === 'link' ? 'From a link' : 'From an upload')} · {style.format.ratio}
                </span>
            </div>
            {onDelete ? (
                <button
                    className="ke-icon-btn aie-style__delete"
                    title="Delete this style"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Delete the style “${style.name}”?`)) onDelete();
                    }}
                >
                    <Trash2 size={14} />
                </button>
            ) : null}
        </div>
    );
}

/** Step 1: learn a style from a reference, or pick a saved or built-in one. */
export function StylePanel() {
    const { presets, styles, selectedId, select, analysis, analyze, cancelAnalysis, removeStyle, loadError, loaded } = useAiEditStore();
    const [mode, setMode] = useState<'link' | 'upload'>('link');
    const [url, setUrl] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    // The link is the first choice; when the platform blocks our server, switch to uploading.
    useEffect(() => {
        if (analysis.code === 'LINK_BLOCKED') setMode('upload');
    }, [analysis.code]);

    const submit = () => {
        if (mode === 'link' && url.trim()) analyze({ url: url.trim() });
        if (mode === 'upload' && file) analyze({ file });
    };

    return (
        <section className="aie-col aie-col--styles">
            <div className="aie-step">
                <span className="aie-step__n">1</span>
                <div>
                    <h4>Choose a style</h4>
                    <p>Show us a video edited the way you like. We measure its cuts, zooms, colour, captions and hook.</p>
                </div>
            </div>

            <div className="aie-learn">
                <div className="ke-seg ke-seg--text">
                    <button className={mode === 'link' ? 'is-active' : ''} onClick={() => setMode('link')}>
                        <Link2 size={13} /> Link
                    </button>
                    <button className={mode === 'upload' ? 'is-active' : ''} onClick={() => setMode('upload')}>
                        <Upload size={13} /> Upload
                    </button>
                </div>
                {mode === 'link' ? (
                    <input
                        className="ke-input"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && submit()}
                        placeholder="TikTok, YouTube, Instagram or Facebook video link"
                        disabled={analysis.running}
                    />
                ) : (
                    <>
                        <input ref={fileInput} type="file" accept="video/*" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
                        <button className="ke-btn ke-btn--block" onClick={() => fileInput.current?.click()} disabled={analysis.running}>
                            <Upload size={14} /> {file ? file.name : 'Choose a video that shows the style'}
                        </button>
                    </>
                )}
                {analysis.running ? (
                    <div className="ke-progress-card">
                        <div className="ke-progress-card__row">
                            <Loader2 size={14} className="ke-spin" />
                            <span>{analysis.stage || 'Working'}…</span>
                            <button className="ke-btn ke-btn--ghost ke-btn--sm" onClick={cancelAnalysis}>
                                <X size={13} />
                            </button>
                        </div>
                        <div className="ke-bar">
                            <div style={{ width: `${analysis.progress}%` }} />
                        </div>
                    </div>
                ) : (
                    <button className="ke-btn ke-btn--primary ke-btn--block" onClick={submit} disabled={mode === 'link' ? !url.trim() : !file}>
                        <Sparkles size={14} /> Learn this style
                    </button>
                )}
                {analysis.error ? (
                    <div className={`ke-alert ${analysis.code === 'LINK_BLOCKED' ? '' : 'ke-alert--error'}`}>
                        {analysis.code === 'LINK_BLOCKED' ? 'That link couldn’t be downloaded from our server, so we switched to Upload. Save the video (or a 10-minute piece of it) and choose it above.' : analysis.error}
                    </div>
                ) : null}
                <p className="ke-note">
                    {mode === 'link'
                        ? 'Links are the quickest. If the platform blocks the download we’ll ask for the file instead.'
                        : 'Upload any example of the style, up to 10 minutes (a short clip works best).'}{' '}
                    The reference is only measured, then deleted.
                </p>
            </div>

            {loadError ? <div className="ke-alert ke-alert--error">{loadError}</div> : null}
            {!loaded && !loadError ? (
                <p className="ke-muted">
                    <Loader2 size={13} className="ke-spin" /> Loading styles…
                </p>
            ) : null}

            {styles.length ? (
                <div className="aie-list">
                    <h5>Your styles</h5>
                    {styles.map((s) => (
                        <StyleItem key={s.id} style={s} selected={selectedId === s.id} onSelect={() => select(s.id)} onDelete={() => removeStyle(s.id)} />
                    ))}
                </div>
            ) : null}
            <div className="aie-list">
                <h5>Built-in styles</h5>
                {presets.map((s) => (
                    <StyleItem key={s.id} style={s} selected={selectedId === s.id} onSelect={() => select(s.id)} />
                ))}
            </div>
        </section>
    );
}
