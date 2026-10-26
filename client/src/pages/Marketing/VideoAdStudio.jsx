import { useEffect, useMemo, useRef, useState } from 'react';
import { Film, Upload, Sparkles, Volume2, Download, Trash2, Loader2, Play, Pause, Music, Box, X, Check } from 'lucide-react';
import { marketingApi } from '../../lib/marketing-api';
import './VideoAdStudio.css';

const pending = (ad) => ['queued', 'processing', 'recovering'].includes(ad?.status);
const words = text => text.trim().split(/\s+/).filter(Boolean).length;
const MAX_PHOTOS = 4;

/** Plays one ElevenLabs sample at a time. */
function useSample() {
    const audio = useRef(null);
    const [playing, setPlaying] = useState('');
    useEffect(() => () => audio.current?.pause(), []);
    function toggle(voice) {
        if (!audio.current) {
            audio.current = new Audio();
            audio.current.onended = () => setPlaying('');
        }
        if (playing === voice.id) { audio.current.pause(); setPlaying(''); return; }
        audio.current.src = voice.preview;
        audio.current.play().then(() => setPlaying(voice.id)).catch(() => setPlaying(''));
    }
    return { playing, toggle };
}

function VoicePicker({ voices, value, onChange }) {
    const [gender, setGender] = useState('all');
    const { playing, toggle } = useSample();
    const genders = useMemo(() => [...new Set(voices.map(v => v.gender).filter(Boolean))].sort(), [voices]);
    const shown = voices.filter(v => gender === 'all' || v.gender === gender);
    return <div className="video-ad-voices">
        <div className="video-ad-voices__head"><strong>Voice</strong>{genders.length > 1 && <div className="video-ad-chips" role="radiogroup" aria-label="Filter voices">{['all', ...genders].map(g => <button type="button" key={g} role="radio" aria-checked={gender === g} className={gender === g ? 'is-on' : ''} onClick={() => setGender(g)}>{g === 'all' ? 'All' : g}</button>)}</div>}</div>
        <ul className="video-ad-voice-list" role="radiogroup" aria-label="Voice">{shown.map(v => <li key={v.id} className={value === v.id ? 'is-selected' : ''}>
            <button type="button" className="video-ad-voice" role="radio" aria-checked={value === v.id} onClick={() => onChange(v.id)}>
                <strong>{v.name}</strong>
                <span>{[v.gender, v.age, v.accent].filter(Boolean).join(' · ') || 'Voice'}</span>
                {(v.use || v.description) && <small>{[v.use, v.description].filter(Boolean).join(' · ')}</small>}
            </button>
            {v.preview && <button type="button" className="video-ad-play" aria-label={`${playing === v.id ? 'Stop' : 'Play'} ${v.name} sample`} onClick={() => toggle(v)}>{playing === v.id ? <Pause size={15} /> : <Play size={15} />}</button>}
        </li>)}</ul>
    </div>;
}

function Photos({ files, onChange, onError }) {
    const urls = useMemo(() => files.map(f => URL.createObjectURL(f)), [files]);
    useEffect(() => () => urls.forEach(u => URL.revokeObjectURL(u)), [urls]);
    function add(list) {
        const next = [...files, ...list];
        if (next.length > MAX_PHOTOS || list.some(f => f.size > 8 * 1024 * 1024)) { onError(`Choose up to ${MAX_PHOTOS} photos, at most 8 MB each.`); return; }
        onError(''); onChange(next);
    }
    return <div className="video-ad-photos">
        {files.map((file, i) => <figure key={`${file.name}-${i}`}><img src={urls[i]} alt={`Product angle ${i + 1}`} /><figcaption>{i === 0 ? 'Hero' : `Angle ${i + 1}`}</figcaption><button type="button" aria-label={`Remove ${file.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}><X size={13} /></button></figure>)}
        {files.length < MAX_PHOTOS && <label className="video-ad-upload"><Upload size={22} /><strong>{files.length ? 'Add another angle' : 'Add product photos'}</strong><span>Front, side, back, detail · JPG, PNG or WebP</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => { add([...e.target.files]); e.target.value = ''; }} /></label>}
    </div>;
}

export default function VideoAdStudio({ kit }) {
    const [options, setOptions] = useState(null);
    const [ads, setAds] = useState([]);
    const [ad, setAd] = useState(null);
    const [files, setFiles] = useState([]);
    const [name, setName] = useState('');
    const [tagline, setTagline] = useState('');
    const [points, setPoints] = useState(['', '', '']);
    const [offer, setOffer] = useState('');
    const [cta, setCta] = useState('Shop now');
    const [website, setWebsite] = useState((kit?.website || '').replace(/^https?:\/\//, '').replace(/\/$/, ''));
    const [category, setCategory] = useState('retail');
    const [preset, setPreset] = useState('turntable');
    const [duration, setDuration] = useState(15);
    const [format, setFormat] = useState('vertical');
    const [script, setScript] = useState('');
    const [voiceId, setVoiceId] = useState('');
    const [voiceover, setVoiceover] = useState(true);
    const [mood, setMood] = useState('auto');
    const [music, setMusic] = useState(true);
    const [sfx, setSfx] = useState(true);
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

    const categoryOf = id => options?.categories.find(c => c.id === id);
    const moodOf = id => options?.moods.find(m => m.id === id);
    const adCategory = categoryOf(ad?.category || category);
    const autoMood = moodOf(adCategory?.mood);
    const limit = ad?.maxWords || duration * 2;

    function select(value) {
        setAd(value); setScript(value.script || ''); setConfirmed(false); setError(''); setPreview(''); setMood('auto');
    }
    async function create(event) {
        event.preventDefault();
        setError(''); setBusy('Preparing your product photos…');
        try {
            const form = new FormData();
            Object.entries({ name, tagline, offer, cta, website, category, preset, duration, format }).forEach(([key, value]) => form.append(key, value));
            form.append('points', JSON.stringify(points.map(p => p.trim()).filter(Boolean)));
            files.forEach(file => form.append('images', file));
            const value = await marketingApi.createVideoAd(form);
            select(value); setAds(list => [value, ...list]);
        } catch (e) { setError(e.message); }
        finally { setBusy(''); }
    }
    async function generate() {
        setBusy('Queuing your ad…'); setError('');
        try {
            const value = await marketingApi.renderVideoAd(ad.id, { voiceover, script, voiceId, mood, music, sfx, captions, confirmed });
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
    const presetLabel = id => options?.presets.find(p => p.id === id)?.label || id;

    return <div className="video-ad-studio">
        <header className="video-ad-heading">
            <div><span className="badge"><Box size={13} /> 3D PRODUCT ADS</span><h2>Your product, in 3D.</h2><p className="muted">Upload your product from a few angles, pick a 3D style and get a short ad with a voiceover, music made for your kind of product, and captions.</p></div>
            <span className="video-ad-limit">10–25s <small>per ad</small></span>
        </header>
        {error && <div className="video-ad-error" role="alert">{error}</div>}
        {busy && <div className="video-ad-notice" role="status"><Loader2 size={16} className="spin" /> {busy}</div>}
        <div className="video-ad-columns">
            <form className="surface video-ad-panel" onSubmit={create}>
                <h3><span className="video-ad-step">1</span> Your product</h3>
                <Photos files={files} onChange={setFiles} onError={setError} />
                <small className="muted">Each photo becomes an angle in the 3D scene. Photos on a plain background are cut out automatically.</small>
                <label>Product or service name<input value={name} onChange={e => setName(e.target.value)} maxLength={60} required placeholder="Everyday Bottle" /></label>
                <label>Tagline<input value={tagline} onChange={e => setTagline(e.target.value)} maxLength={90} placeholder="Cold for 24 hours. Hot for 12." /></label>
                <fieldset className="video-ad-fieldset"><legend>Selling points <small className="muted">(optional, one per angle)</small></legend>{points.map((p, i) => <input key={i} value={p} maxLength={48} aria-label={`Selling point ${i + 1}`} placeholder={['Leak-proof lid', 'Recycled steel', 'Fits any cup holder'][i]} onChange={e => setPoints(list => list.map((x, j) => j === i ? e.target.value : x))} />)}</fieldset>
                <div className="video-ad-settings"><label>Offer<input value={offer} onChange={e => setOffer(e.target.value)} maxLength={40} placeholder="20% off this week" /></label><label>Button text<input value={cta} onChange={e => setCta(e.target.value)} maxLength={30} /></label></div>
                <label>Website<input value={website} onChange={e => setWebsite(e.target.value)} maxLength={60} placeholder="yourbrand.co.za" /></label>
                <label>What are you advertising?<select value={category} onChange={e => setCategory(e.target.value)}>{options?.categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
                <fieldset className="video-ad-fieldset"><legend>3D style</legend><div className="video-ad-presets" role="radiogroup" aria-label="3D style">{options?.presets.map(p => <button type="button" key={p.id} role="radio" aria-checked={preset === p.id} className={`video-ad-preset video-ad-preset--${p.id}${preset === p.id ? ' is-selected' : ''}`} onClick={() => setPreset(p.id)}><span className="video-ad-preset__demo" aria-hidden="true"><i /></span><strong>{p.label}</strong><small>{p.description}</small></button>)}</div></fieldset>
                <div className="video-ad-settings"><label>Length<select value={duration} onChange={e => setDuration(Number(e.target.value))}>{(options?.durations || [10, 15, 20, 25]).map(n => <option key={n} value={n}>{n} seconds</option>)}</select></label><label>Format<select value={format} onChange={e => setFormat(e.target.value)}><option value="vertical">Vertical · 9:16</option><option value="square">Square · 1:1</option><option value="landscape">Landscape · 16:9</option></select></label></div>
                <button className="btn btn-primary" disabled={!!busy || isPending || !files.length || !name.trim()}><Sparkles size={16} /> Create draft</button>
                <small className="muted">Free: no AI credit is used. Your photos are processed to make the ad; drafts and exports are kept for 30 days or until you delete them.</small>
            </form>
            <section className="surface video-ad-panel">
                <h3><span className="video-ad-step">2</span> Voice, music and sound</h3>
                {!ad ? <div className="video-ad-empty"><Box size={42} /><h3>From photos to a 3D ad</h3><p>Your draft appears here. Pick a voice, check the script and choose the music before you generate.</p><div className="video-ad-flow">Intro <span>→</span> Angles <span>→</span> Selling points <span>→</span> Offer</div></div> : <>
                    <div className="video-ad-summary"><strong>{ad.name}</strong><span className="badge">{ad.duration}s · {ad.format} · {presetLabel(ad.preset)}</span>{ad.description && <p className="muted">{ad.description}</p>}{ad.photoCount > 0 && <p className="muted">{ad.photoCount} {ad.photoCount === 1 ? 'photo' : 'photos'}, {ad.cutouts === ad.photoCount ? 'all cut out from their backgrounds' : ad.cutouts ? `${ad.cutouts} cut out from the background; the rest are shown as cards` : 'shown as cards (use a plain background to have the product cut out)'}.</p>}</div>
                    {ad.status === 'draft' && <>
                        <label className="video-ad-switch"><input type="checkbox" checked={voiceover} onChange={e => setVoiceover(e.target.checked)} /> <Volume2 size={15} /> Voiceover</label>
                        {voiceover ? <>
                            <label>Voiceover script<textarea rows={4} value={script} maxLength={1000} onChange={e => { setScript(e.target.value); setConfirmed(false); }} /><small className={words(script) > limit ? 'video-ad-error-text' : 'muted'}>{words(script)} / {limit} words · shorter scripts leave room to breathe</small></label>
                            {options?.voices.length > 0 && <VoicePicker voices={options.voices} value={voiceId} onChange={setVoiceId} />}
                            {options?.voiceError && <p role="alert" className="video-ad-error-text">{options.voiceError}</p>}
                            {options && !options.configured.voice && <p role="alert">AI voiceovers are coming soon. Turn the voiceover off to make an ad without narration.</p>}
                        </> : <small className="muted">No voiceover: the ad uses music{sfx ? ' and sound effects' : ''}, with your name, selling points and offer on screen.</small>}
                        <div className="video-ad-music">
                            <label className="video-ad-switch"><input type="checkbox" checked={music} onChange={e => setMusic(e.target.checked)} /> <Music size={15} /> Background music</label>
                            {music && <div className="video-ad-moods" role="radiogroup" aria-label="Music mood">
                                <button type="button" role="radio" aria-checked={mood === 'auto'} className={mood === 'auto' ? 'is-selected' : ''} onClick={() => setMood('auto')}><strong>Auto{autoMood ? `: ${autoMood.label}` : ''}</strong><small>Matches {adCategory ? adCategory.label.toLowerCase() : 'your product'}</small></button>
                                {options?.moods.map(m => <button type="button" key={m.id} role="radio" aria-checked={mood === m.id} className={mood === m.id ? 'is-selected' : ''} onClick={() => setMood(m.id)}><strong>{m.label}</strong><small>{m.description}</small></button>)}
                            </div>}
                            {music && options && !options.configured.music && <p role="alert">AI music is coming soon. Turn music off and keep the sound effects on.</p>}
                        </div>
                        <div className="video-ad-checks"><label><input type="checkbox" checked={sfx} onChange={e => setSfx(e.target.checked)} /> Sound effects (whooshes on angle changes, a hit on the offer)</label>{voiceover && <label><input type="checkbox" checked={captions} onChange={e => setCaptions(e.target.checked)} /> Captions</label>}</div>
                        <label className="video-ad-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I checked the claims and have permission to use these photos.</label>
                        <button className="btn btn-primary" onClick={generate} disabled={!!busy || !confirmed || (!voiceover && !music && !sfx) || (voiceover && (!voiceId || !script.trim() || words(script) > limit || !options?.configured.voice)) || (music && !options?.configured.music)}><Film size={16} /> Generate {ad.duration}-second ad</button><small className="muted">Uses 1 render from your plan. Failed renders are refunded.</small>
                    </>}
                    {isPending && <div className="video-ad-progress" role="status"><strong>{ad.stage}</strong><progress max={100} value={ad.progress || 0} /><p className="muted">You can leave this page and come back to your ad library.</p></div>}
                    {ad.status === 'failed' && <div className="video-ad-error" role="alert">{ad.error}</div>}
                    {completed && <div className="video-ad-result">{preview ? <><video key={preview} src={preview} controls playsInline /><a href={preview} download={`${ad.name.replace(/[^a-z0-9-]/gi,'-')}-ad.mp4`} className="btn btn-primary"><Download size={16} /> Download MP4</a></> : <p role="status">Loading your preview…</p>}</div>}
                </>}
            </section>
        </div>
        <section className="surface video-ad-panel"><h3>Your ad library</h3>{!ads.length ? <p className="muted">Your drafts and finished ads are saved here.</p> : <div className="video-ad-library">{ads.map(item => <div key={item.id} className={item.id === ad?.id ? 'is-selected' : ''}><button onClick={() => select(item)} disabled={!!busy}>{item.status === 'completed' ? <Check size={18} /> : <Film size={18} />}<strong>{item.name}</strong><span>{item.duration}s · {item.preset ? presetLabel(item.preset) : 'ad'} · {item.status}</span></button><button className="btn btn-ghost" aria-label={`Delete ${item.name}`} disabled={!!busy || pending(item)} onClick={() => remove(item)}><Trash2 size={16} /></button></div>)}</div>}</section>
    </div>;
}
