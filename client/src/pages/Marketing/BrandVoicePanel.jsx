import { useState } from 'react';
import { Check, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { marketingApi } from '../../lib/marketing-api';

const TONES = [
    { id: 'casual', left: 'Formal', right: 'Casual' },
    { id: 'funny', left: 'Serious', right: 'Funny' },
    { id: 'irreverent', left: 'Respectful', right: 'Irreverent' },
    { id: 'enthusiastic', left: 'Matter-of-fact', right: 'Enthusiastic' },
];

const EMPTY_VOICE = {
    summary: '',
    attributes: [{ is: '', isNot: '' }],
    tone: { casual: 50, funny: 30, irreverent: 20, enthusiastic: 50 },
    wordsToUse: [],
    wordsToAvoid: [],
    sentenceStyle: '',
    emoji: 'light',
    hashtags: '',
    ctaStyle: '',
    examples: [],
};

/** Brand voice: learned from sample posts, editable, used for every caption and slide. */
export default function BrandVoicePanel({ data, onSaved }) {
    const saved = data.kit.voice;
    const [voice, setVoice] = useState(saved || null);
    const [savedKey, setSavedKey] = useState(() => JSON.stringify(saved || null));
    const currentKey = JSON.stringify(saved || null);
    if (currentKey !== savedKey) {
        // Saved voice changed elsewhere (e.g. "Set up from website"); adopt it unless there are unsaved edits.
        if (JSON.stringify(voice) === savedKey) setVoice(saved || null);
        setSavedKey(currentKey);
    }
    const [samples, setSamples] = useState('');
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState(null);

    const dirty = JSON.stringify(voice) !== JSON.stringify(saved || null);
    const update = (patch) => setVoice((v) => ({ ...v, ...patch }));

    const analyze = async () => {
        const list = samples
            .split(/\n\s*\n/)
            .map((s) => s.trim())
            .filter(Boolean);
        setBusy('analyze');
        setMessage(null);
        try {
            const { voice: learned } = await marketingApi.analyzeVoice(list);
            setVoice(learned);
            setMessage({ type: 'success', text: 'Voice learned from your samples. Adjust anything, then save.' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setBusy('');
        }
    };

    const save = async () => {
        setBusy('save');
        setMessage(null);
        try {
            const result = await marketingApi.saveBrand({ voice });
            onSaved({ ...data, ...result });
            setVoice(result.kit.voice);
            setMessage({ type: 'success', text: 'Brand voice saved.' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setBusy('');
        }
    };

    const sampleCount = samples.split(/\n\s*\n/).filter((s) => s.trim().length >= 20).length;

    return (
        <section className="surface marketing-section">
            <div className="marketing-section__head">
                <div>
                    <h3>Brand voice</h3>
                    <p className="muted">How your brand sounds. The AI writes every caption and slide this way.</p>
                </div>
            </div>

            <label className="field">
                <span>Paste 2–10 things you've written</span>
                <textarea
                    className="input"
                    rows={6}
                    placeholder={'Captions, posts, emails or website copy. Leave a blank line between samples.\n\nExample: "Fresh drop just landed 🔥 Limited stock, so don\'t sleep on it."'}
                    value={samples}
                    onChange={(e) => setSamples(e.target.value)}
                />
                <small>{sampleCount} sample{sampleCount === 1 ? '' : 's'}. Real posts work better than descriptions of your brand.</small>
            </label>
            <div className="marketing-actions">
                <button className="btn btn-secondary" onClick={analyze} disabled={sampleCount < 2 || !!busy || !data.aiAvailable}>
                    {busy === 'analyze' ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {busy === 'analyze' ? 'Learning your voice…' : 'Learn my voice'}
                </button>
                {!voice ? (
                    <button className="btn btn-ghost" onClick={() => setVoice(EMPTY_VOICE)}>
                        Write it myself
                    </button>
                ) : null}
                {!data.aiAvailable ? <small className="muted">AI isn't set up on the server yet, so write the voice by hand for now.</small> : null}
            </div>

            {voice ? (
                <div className="marketing-voice">
                    <label className="field">
                        <span>Summary</span>
                        <textarea className="input" rows={2} value={voice.summary} onChange={(e) => update({ summary: e.target.value })} maxLength={400} />
                    </label>

                    <div className="field">
                        <span>We are… but not…</span>
                        {voice.attributes.map((a, i) => (
                            <div key={i} className="marketing-attr">
                                <input
                                    className="input"
                                    placeholder="confident"
                                    value={a.is}
                                    onChange={(e) => update({ attributes: voice.attributes.map((x, j) => (j === i ? { ...x, is: e.target.value } : x)) })}
                                    maxLength={40}
                                />
                                <span className="muted">not</span>
                                <input
                                    className="input"
                                    placeholder="arrogant"
                                    value={a.isNot}
                                    onChange={(e) => update({ attributes: voice.attributes.map((x, j) => (j === i ? { ...x, isNot: e.target.value } : x)) })}
                                    maxLength={40}
                                />
                                <button className="btn btn-ghost btn-sm" onClick={() => update({ attributes: voice.attributes.filter((_, j) => j !== i) })} aria-label="Remove">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                        {voice.attributes.length < 5 ? (
                            <button className="btn btn-ghost btn-sm marketing-add" onClick={() => update({ attributes: [...voice.attributes, { is: '', isNot: '' }] })}>
                                <Plus size={14} /> Add trait
                            </button>
                        ) : null}
                    </div>

                    <div className="field">
                        <span>Tone</span>
                        {TONES.map((t) => (
                            <div key={t.id} className="marketing-slider">
                                <small>{t.left}</small>
                                <input type="range" min={0} max={100} value={voice.tone[t.id]} onChange={(e) => update({ tone: { ...voice.tone, [t.id]: Number(e.target.value) } })} aria-label={`${t.left} to ${t.right}`} />
                                <small>{t.right}</small>
                            </div>
                        ))}
                    </div>

                    <div className="field-row">
                        <WordList label="Words we use" values={voice.wordsToUse} onChange={(wordsToUse) => update({ wordsToUse })} />
                        <WordList label="Words we avoid" values={voice.wordsToAvoid} onChange={(wordsToAvoid) => update({ wordsToAvoid })} />
                    </div>

                    <div className="field-row">
                        <label className="field">
                            <span>Sentences</span>
                            <input className="input" value={voice.sentenceStyle} onChange={(e) => update({ sentenceStyle: e.target.value })} maxLength={200} placeholder="Short and punchy, speaks to 'you'" />
                        </label>
                        <label className="field">
                            <span>Emoji</span>
                            <select className="input" value={voice.emoji} onChange={(e) => update({ emoji: e.target.value })}>
                                <option value="none">None</option>
                                <option value="light">A few</option>
                                <option value="heavy">Lots</option>
                            </select>
                        </label>
                    </div>
                    <div className="field-row">
                        <label className="field">
                            <span>Hashtags</span>
                            <input className="input" value={voice.hashtags} onChange={(e) => update({ hashtags: e.target.value })} maxLength={200} placeholder="2–3 niche tags at the end" />
                        </label>
                        <label className="field">
                            <span>Calls to action</span>
                            <input className="input" value={voice.ctaStyle} onChange={(e) => update({ ctaStyle: e.target.value })} maxLength={200} placeholder="Direct: 'Shop the drop', 'DM us PRICE'" />
                        </label>
                    </div>
                </div>
            ) : null}

            {message ? <div className={message.type === 'error' ? 'error-banner' : 'success-banner'}>{message.text}</div> : null}

            {voice ? (
                <div className="marketing-actions">
                    <button className="btn btn-primary" onClick={save} disabled={!dirty || !!busy || !voice.summary.trim()}>
                        {busy === 'save' ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Save brand voice
                    </button>
                    {dirty ? (
                        <button className="btn btn-ghost" onClick={() => setVoice(saved || null)} disabled={!!busy}>
                            Discard changes
                        </button>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}

function WordList({ label, values, onChange }) {
    const [draft, setDraft] = useState('');
    const add = () => {
        const word = draft.trim();
        if (word && !values.includes(word) && values.length < 15) onChange([...values, word]);
        setDraft('');
    };
    return (
        <div className="field">
            <span>{label}</span>
            <div className="marketing-words">
                {values.map((w) => (
                    <span key={w} className="chip is-active">
                        {w}
                        <button onClick={() => onChange(values.filter((x) => x !== w))} aria-label={`Remove ${w}`}>
                            <X size={12} />
                        </button>
                    </span>
                ))}
            </div>
            <input
                className="input"
                value={draft}
                placeholder="Type and press Enter"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        add();
                    }
                }}
                onBlur={add}
                maxLength={40}
            />
        </div>
    );
}
