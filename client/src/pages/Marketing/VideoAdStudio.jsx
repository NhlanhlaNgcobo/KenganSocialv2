import { useEffect, useState } from 'react';
import { Film, Upload, Globe, Sparkles, Volume2, Download, Trash2, Loader2 } from 'lucide-react';
import { marketingApi } from '../../lib/marketing-api';
import './VideoAdStudio.css';

const pending = (ad) => ['queued', 'processing', 'recovering'].includes(ad?.status);
const words = text => text.trim().split(/\s+/).filter(Boolean).length;

export default function VideoAdStudio({ kit }) {
    const [options, setOptions] = useState(null);
    const [ads, setAds] = useState([]);
    const [ad, setAd] = useState(null);
    const [url, setUrl] = useState(kit?.website || '');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [files, setFiles] = useState([]);
    const [duration, setDuration] = useState(20);
    const [format, setFormat] = useState('vertical');
    const [script, setScript] = useState('');
    const [voiceId, setVoiceId] = useState('');
    const [mood, setMood] = useState('upbeat');
    const [music, setMusic] = useState(true);
    const [captions, setCaptions] = useState(true);
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [preview, setPreview] = useState('');

    useEffect(() => {
        let active = true;
        marketingApi.videoAdOptions().then(value => {
            if (!active) return;
            setOptions(value);
            setVoiceId(value.voices[0]?.id || '');
        }).catch(e => { if (active) setError(e.message); });
        marketingApi.videoAds().then(value => { if (active) setAds(value.ads); }).catch(e => { if (active) setError(e.message); });
        return () => { active = false; };
    }, []);

    const adId = ad?.id;
    const isPending = pending(ad);
    useEffect(() => {
        if (!adId || !isPending) return;
        let active = true;
        let timer;
        const poll = async () => {
            try {
                const value = await marketingApi.videoAd(adId);
                if (!active) return;
                setAd(value);
                setAds(list => [value, ...list.filter(item => item.id !== value.id)]);
                if (pending(value)) timer = setTimeout(poll, 2500);
            } catch (e) {
                if (active) { setError(e.message); timer = setTimeout(poll, 5000); }
            }
        };
        timer = setTimeout(poll, 1000);
        return () => { active = false; clearTimeout(timer); };
    }, [adId, isPending]);

    const completed = ad?.status === 'completed';
    useEffect(() => {
        let active = true;
        let objectUrl;
        if (completed && adId) marketingApi.videoAdMedia(adId).then(blob => {
            if (!active) return;
            objectUrl = URL.createObjectURL(blob);
            setPreview(objectUrl);
        }).catch(e => { if (active) setError(e.message); });
        return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [adId, completed]);

    function select(value) {
        setAd(value); setScript(value.script || ''); setConfirmed(false); setError(''); setPreview('');
    }
    async function create(event) {
        event.preventDefault();
        setError(''); setBusy('Reading your product and writing the storyboard…');
        try {
            const form = new FormData();
            Object.entries({ url, name, description, duration, format }).forEach(([key, value]) => form.append(key, value));
            files.forEach(file => form.append('images', file));
            const value = await marketingApi.createVideoAd(form);
            select(value); setAds(list => [value, ...list]);
        } catch (e) { setError(e.message); }
        finally { setBusy(''); }
    }
    async function generate() {
        setBusy('Queuing your ad…'); setError('');
        try {
            const value = await marketingApi.renderVideoAd(ad.id, { script, voiceId, mood, music, captions, confirmed });
            setAd(value); setAds(list => [value, ...list.filter(item => item.id !== value.id)]);
        } catch (e) { setError(e.message); }
        finally { setBusy(''); }
    }
    async function remove(value) {
        setBusy('Deleting ad…'); setError('');
        try {
            await marketingApi.deleteVideoAd(value.id);
            setAds(list => list.filter(item => item.id !== value.id));
            if (ad?.id === value.id) { setAd(null); setPreview(''); }
        } catch (e) { setError(e.message); }
        finally { setBusy(''); }
    }
    return <div className="video-ad-studio">
        <header className="video-ad-heading">
            <div><span className="badge"><Film size={13} /> PRODUCT & SERVICE ADS</span><h2>Your product. A story worth watching.</h2><p className="muted">Turn product photos or your website into a short ad with a voiceover, music, and captions.</p></div>
            <span className="video-ad-limit">25s <small>maximum</small></span>
        </header>
        {error && <div className="video-ad-error" role="alert">{error}</div>}
        {busy && <div className="video-ad-notice" role="status"><Loader2 size={16} className="spin" /> {busy}</div>}
        <div className="video-ad-columns">
            <form className="surface video-ad-panel" onSubmit={create}>
                <h3><span className="video-ad-step">1</span> Start with your product</h3>
                <label><Globe size={15} /> Website or product URL<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://yourbrand.com/product" /></label>
                <div className="video-ad-divider">or upload your product</div>
                <label className="video-ad-upload"><Upload size={24} /><strong>Add product photos</strong><span>Up to 4 JPG, PNG, or WebP images · 8 MB each</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => {
                    const selected = [...e.target.files];
                    if (selected.length > 4 || selected.some(f => f.size > 8 * 1024 * 1024)) { setError('Choose up to four images, at most 8 MB each.'); e.target.value = ''; setFiles([]); return; }
                    setFiles(selected); setError('');
                }} />{files.map(file => <small key={file.name}>{file.name}</small>)}</label>
                <label>Product or service name<input value={name} onChange={e => setName(e.target.value)} maxLength={80} required={!url} placeholder="Optional for website imports" /></label>
                <label>What should this ad focus on?<textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={1500} required={!url} rows={3} placeholder="What it does, the main benefit, and your offer. Website details are extracted automatically." /></label>
                <div className="video-ad-settings"><label>Duration<select value={duration} onChange={e => setDuration(Number(e.target.value))}>{[15,20,25].map(n => <option key={n} value={n}>{n} seconds</option>)}</select></label><label>Format<select value={format} onChange={e => setFormat(e.target.value)}><option value="vertical">Vertical · 9:16</option><option value="square">Square · 1:1</option><option value="landscape">Landscape · 16:9</option></select></label></div>
                <button className="btn btn-primary" disabled={!!busy || isPending || (!url && !files.length)}><Sparkles size={16} /> Create storyboard</button>
                <small className="muted">Uses 1 AI credit. Your assets and copy are processed to create the ad; drafts and exports are kept for 30 days or until you delete them.</small>
            </form>
            <section className="surface video-ad-panel">
                <h3><span className="video-ad-step">2</span> Review & make it yours</h3>
                {!ad ? <div className="video-ad-empty"><Film size={42} /><h3>From product to preview</h3><p>Your offering, storyboard, and voiceover script will appear here. Review the details before generating.</p><div className="video-ad-flow">Hook <span>→</span> Product <span>→</span> Benefits <span>→</span> Action</div></div> : <>
                    <div className="video-ad-summary"><strong>{ad.name}</strong><span className="badge">{ad.duration}s · {ad.format}</span><p className="muted">{ad.description}</p></div>
                    {ad.offerings?.length > 0 && ad.status === 'draft' && <details><summary>Detected offerings and page headings</summary><ul>{ad.offerings.map((item,i) => <li key={i}>{item}</li>)}</ul><p className="muted">To focus on one offering, enter it in the product name and focus fields, then create a new storyboard.</p></details>}
                    <ol className="video-ad-scenes">{ad.scenes?.map((scene,i) => <li key={i}><span>{scene.type} · {scene.duration.toFixed(1)}s</span>{scene.headline}</li>)}</ol>
                    {ad.status === 'draft' && <>
                        <label><Volume2 size={15} /> Voiceover script<textarea rows={5} value={script} maxLength={1000} onChange={e => { setScript(e.target.value); setConfirmed(false); }} /><small className={words(script) > ad.duration * 2 ? 'video-ad-error-text' : 'muted'}>{words(script)} / {ad.duration * 2} words · shorter scripts leave room to breathe</small></label>
                        <label>Voice<select value={voiceId} onChange={e => setVoiceId(e.target.value)}><option value="">Select a voice</option>{options?.voices.map(v => <option key={v.id} value={v.id}>{v.name}{v.accent ? ` · ${v.accent}` : ''}</option>)}</select></label>
                        {options?.voiceError && <p role="alert" className="video-ad-error-text">{options.voiceError}</p>}
                        {options && !options.configured.voice && <p role="alert">Voiceover generation needs to be configured by your administrator.</p>}
                        <div className="video-ad-settings"><label>Music mood<select value={mood} disabled={!music} onChange={e => setMood(e.target.value)}>{['upbeat','calm','cinematic','playful','luxury'].map(m => <option key={m}>{m}</option>)}</select></label><div className="video-ad-checks"><label><input type="checkbox" checked={music} onChange={e => setMusic(e.target.checked)} /> Background music</label><label><input type="checkbox" checked={captions} onChange={e => setCaptions(e.target.checked)} /> Captions</label></div></div>
                        {music && options && !options.configured.music && <p role="alert">Background music is not configured. Turn it off to generate a voiceover-only ad.</p>}
                        <label className="video-ad-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I reviewed the claims and have permission to use these assets.</label>
                        <button className="btn btn-primary" onClick={generate} disabled={!!busy || !confirmed || !voiceId || !script.trim() || words(script) > ad.duration * 2 || (music && !options?.configured.music)}><Film size={16} /> Generate {ad.duration}-second ad</button><small className="muted">Uses 1 render from your plan. Failed renders are refunded.</small>
                    </>}
                    {isPending && <div className="video-ad-progress" role="status"><strong>{ad.stage}</strong><progress max={100} value={ad.progress || 0} /><p className="muted">You can leave this page and return to your ad library.</p></div>}
                    {ad.status === 'failed' && <div className="video-ad-error" role="alert">{ad.error}</div>}
                    {completed && <div className="video-ad-result">{preview ? <><video key={preview} src={preview} controls playsInline /><a href={preview} download={`${ad.name.replace(/[^a-z0-9-]/gi,'-')}-ad.mp4`} className="btn btn-primary"><Download size={16} /> Download MP4</a></> : <p role="status">Loading your preview…</p>}</div>}
                </>}
            </section>
        </div>
        <section className="surface video-ad-panel"><h3>Your ad library</h3>{!ads.length ? <p className="muted">Your drafts and finished ads will be saved here.</p> : <div className="video-ad-library">{ads.map(item => <div key={item.id} className={item.id === ad?.id ? 'is-selected' : ''}><button onClick={() => select(item)} disabled={!!busy}><Film size={18} /><strong>{item.name}</strong><span>{item.duration}s · {item.status}</span></button><button className="btn btn-ghost" aria-label={`Delete ${item.name}`} disabled={!!busy || pending(item)} onClick={() => remove(item)}><Trash2 size={16} /></button></div>)}</div>}</section>
    </div>;
}
