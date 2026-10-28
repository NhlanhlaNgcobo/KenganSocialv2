import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudUpload, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { marketingApi } from '../../lib/marketing-api';
import { confirmDialog } from '../../lib/dialogs';

/**
 * Reference library: the brand's own designs and photos. The AI tags each image and learns a
 * style profile from the folder, which guides carousel layouts and AI imagery.
 */
export default function ReferenceLibrary({ aiAvailable, kit, onKitChange, onCountChange }) {
    const [refs, setRefs] = useState(null);
    const [max, setMax] = useState(50);
    const [uploading, setUploading] = useState(false);
    const [learning, setLearning] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [message, setMessage] = useState(null);
    const inputRef = useRef(null);
    const pollRef = useRef(null);

    const load = useCallback(async () => {
        try {
            const d = await marketingApi.references();
            setRefs(d.references);
            setMax(d.max);
            return d.references;
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
            return [];
        }
    }, []);

    // While the AI is still tagging new images, refresh every few seconds.
    const pollWhileTagging = useCallback(
        (list, tries = 0) => {
            clearTimeout(pollRef.current);
            if (tries > 20 || !list.some((r) => r.status === 'tagging')) return;
            pollRef.current = setTimeout(async () => pollWhileTagging(await load(), tries + 1), 4000);
        },
        [load]
    );

    useEffect(() => {
        load().then((list) => pollWhileTagging(list));
        return () => clearTimeout(pollRef.current);
    }, [load, pollWhileTagging]);

    const upload = async (fileList) => {
        const files = [...(fileList || [])].filter((f) => /^image\/(jpeg|png|webp|gif)$/.test(f.type));
        if (!files.length) return setMessage({ type: 'error', text: 'Choose JPG, PNG, WebP or GIF images.' });
        setUploading(true);
        setMessage(null);
        try {
            for (let i = 0; i < files.length; i += 10) await marketingApi.uploadReferences(files.slice(i, i + 10));
            const list = await load();
            pollWhileTagging(list);
            onCountChange?.();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setUploading(false);
        }
    };

    const remove = async (id) => {
        if (!(await confirmDialog('Remove this image from your references?', { confirmLabel: 'Remove', danger: true }))) return;
        setRefs((list) => list.filter((r) => r.id !== id));
        try {
            await marketingApi.removeReference(id);
            onCountChange?.();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
            load();
        }
    };

    const learn = async () => {
        setLearning(true);
        setMessage(null);
        try {
            const result = await marketingApi.learnStyle();
            onKitChange((current) => ({ ...current, ...result }));
            setMessage({ type: 'success', text: 'Style profile updated from your references.' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setLearning(false);
        }
    };

    const style = kit.style;
    const count = refs?.length || 0;

    return (
        <section className="surface marketing-section">
            <div className="marketing-section__head">
                <div>
                    <h3>Reference library</h3>
                    <p className="muted">Posts, ads and photos that look like your brand. The AI learns your style from them.</p>
                </div>
                <span className="badge">
                    {count}/{max}
                </span>
            </div>

            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={(e) => (upload(e.target.files), (e.target.value = ''))} />
            <button
                className={`marketing-drop ${dragOver ? 'is-over' : ''}`}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    upload(e.dataTransfer.files);
                }}
                disabled={uploading || count >= max}
            >
                {uploading ? <Loader2 size={22} className="spin" /> : <CloudUpload size={22} />}
                <strong>{uploading ? 'Uploading…' : count >= max ? 'Library full' : 'Drop images or click to upload'}</strong>
                <small className="muted">Your best posts, ads, product shots and designs you like. JPG, PNG, WebP or GIF, up to 15 MB each.</small>
            </button>

            {refs === null ? (
                <p className="muted">
                    <Loader2 size={14} className="spin" /> Loading…
                </p>
            ) : refs.length ? (
                <div className="marketing-refs">
                    {refs.map((r) => (
                        <figure key={r.id} className="marketing-ref" title={r.caption || r.name}>
                            <img src={r.thumbUrl} alt={r.caption || r.name} loading="lazy" />
                            <figcaption>
                                {r.status === 'tagging' ? (
                                    <small className="muted">
                                        <Loader2 size={11} className="spin" /> Tagging…
                                    </small>
                                ) : (
                                    <small>{(r.tags || []).slice(0, 3).join(' · ') || r.name}</small>
                                )}
                            </figcaption>
                            <button className="marketing-ref__remove" onClick={() => remove(r.id)} aria-label="Remove image">
                                <Trash2 size={13} />
                            </button>
                        </figure>
                    ))}
                </div>
            ) : null}

            <div className="marketing-style">
                <div className="marketing-section__head">
                    <div>
                        <h4>Style profile</h4>
                        <p className="muted">{style?.summary ? `Learned from ${style.basedOn} images.` : 'What the AI learns from your references.'}</p>
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={learn} disabled={learning || count < 3 || !aiAvailable}>
                        {learning ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} {style?.summary ? 'Relearn' : 'Learn my style'}
                    </button>
                </div>
                {!aiAvailable ? <small className="muted">AI isn't set up on the server yet.</small> : count < 3 ? <small className="muted">Add at least 3 images first.</small> : null}
                {style?.summary ? (
                    <div className="marketing-style__body">
                        <p>{style.summary}</p>
                        {style.palette?.length ? (
                            <div className="marketing-swatches is-large">
                                {style.palette.map((p) => (
                                    <span key={p.hex + p.role} style={{ background: p.hex }} title={`${p.role} ${p.hex}`} />
                                ))}
                            </div>
                        ) : null}
                        <dl>
                            {style.typography ? (
                                <>
                                    <dt>Type</dt>
                                    <dd>{style.typography}</dd>
                                </>
                            ) : null}
                            {style.composition ? (
                                <>
                                    <dt>Layout</dt>
                                    <dd>{style.composition}</dd>
                                </>
                            ) : null}
                            {style.imagery ? (
                                <>
                                    <dt>Imagery</dt>
                                    <dd>{style.imagery}</dd>
                                </>
                            ) : null}
                        </dl>
                        {style.mood?.length ? (
                            <div className="marketing-words">
                                {style.mood.map((m) => (
                                    <span key={m} className="chip">
                                        {m}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                        {style.layoutPatterns?.length ? (
                            <p className="muted">
                                <strong>Recurring layouts:</strong> {style.layoutPatterns.join(', ')}
                            </p>
                        ) : null}
                        <div className="field-row">
                            {style.do?.length ? (
                                <div>
                                    <strong>Keep doing</strong>
                                    <ul className="marketing-list">
                                        {style.do.map((d) => (
                                            <li key={d}>{d}</li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}
                            {style.dont?.length ? (
                                <div>
                                    <strong>Avoid</strong>
                                    <ul className="marketing-list">
                                        {style.dont.map((d) => (
                                            <li key={d}>{d}</li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}
                        </div>
                        <small className="muted">Your brand kit colours, fonts and logo always take priority over this profile.</small>
                    </div>
                ) : null}
            </div>

            {message ? <div className={message.type === 'error' ? 'error-banner' : 'success-banner'}>{message.text}</div> : null}
        </section>
    );
}
