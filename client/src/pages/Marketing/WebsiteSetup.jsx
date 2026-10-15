import { useState } from 'react';
import { Check, Globe, Loader2, Wand2 } from 'lucide-react';
import { marketingApi, pollUntilDone } from '../../lib/marketing-api';

const STEPS = ['Reading your website', 'Understanding your business', 'Learning how your brand sounds', 'Saving your brand'];

/**
 * One paste sets up the brand: the site is read like the Launch video does (copy + screenshots),
 * then the brand kit, brand voice and business profile are filled in.
 */
export default function WebsiteSetup({ initialUrl = '', onDone, onMakeCarousels, compact = false }) {
    const [url, setUrl] = useState(initialUrl);
    const [job, setJob] = useState(null);
    const [error, setError] = useState('');
    const running = job?.status === 'running';

    const start = async () => {
        setError('');
        setJob({ status: 'running', stage: STEPS[0], progress: 2 });
        try {
            const { jobId } = await marketingApi.setupFromWebsite(url.trim());
            const final = await pollUntilDone(
                async () => (await marketingApi.job(jobId)).job,
                setJob
            );
            if (final.status === 'failed') setError(final.error || 'Something went wrong reading your website.');
            else onDone?.();
        } catch (err) {
            setError(err.message);
            setJob(null);
        }
    };

    const result = job?.status === 'done' ? job.result : null;
    const stepIndex = Math.max(0, STEPS.indexOf(job?.stage));

    return (
        <section className={`surface marketing-setup ${compact ? 'is-compact' : ''}`}>
            <div className="marketing-setup__head">
                <span className="marketing-setup__icon">
                    <Globe size={18} />
                </span>
                <div>
                    <h3>Set up from your website</h3>
                    <p className="muted">Paste your site once. We read it like a customer would, then fill in your logo, colours, fonts, brand voice and what you sell.</p>
                </div>
            </div>

            <div className="marketing-inline">
                <input className="input" placeholder="yourbrand.co.za" value={url} onChange={(e) => setUrl(e.target.value)} disabled={running} onKeyDown={(e) => e.key === 'Enter' && url.trim() && !running && start()} />
                <button className="btn btn-primary" onClick={start} disabled={!url.trim() || running}>
                    {running ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />} {running ? 'Working…' : result ? 'Read it again' : 'Set up my brand'}
                </button>
            </div>

            {running ? (
                <div className="marketing-steps">
                    <div className="progress">
                        <div style={{ width: `${job.progress || 2}%` }} />
                    </div>
                    <ol>
                        {STEPS.map((s, i) => (
                            <li key={s} className={i < stepIndex ? 'is-done' : i === stepIndex ? 'is-active' : ''}>
                                {i < stepIndex ? <Check size={13} /> : i === stepIndex ? <Loader2 size={13} className="spin" /> : <span className="marketing-steps__dot" />} {s}
                            </li>
                        ))}
                    </ol>
                    <small className="muted">Usually under a minute. You can leave this page; it keeps going.</small>
                </div>
            ) : null}

            {error ? <div className="error-banner">{error}</div> : null}

            {result ? (
                <div className="marketing-setup__result">
                    {result.business?.oneLiner ? (
                        <p>
                            <strong>We understood:</strong> {result.business.oneLiner}
                        </p>
                    ) : null}
                    {result.applied?.length ? (
                        <p className="muted">
                            <Check size={13} /> Filled in: {result.applied.join(', ')}.
                        </p>
                    ) : null}
                    {result.kept?.length ? <p className="muted">Kept your own: {result.kept.join(', ')}.</p> : null}
                    {result.socials?.length ? <p className="muted">Social profiles found: {result.socials.map((s) => s.platform).join(', ')}.</p> : null}
                    {(result.notes || []).map((n) => (
                        <p key={n} className="muted">
                            {n}
                        </p>
                    ))}
                    {onMakeCarousels ? (
                        <div className="marketing-actions">
                            <button className="btn btn-primary btn-sm" onClick={onMakeCarousels}>
                                <Wand2 size={14} /> Make carousels from my website
                            </button>
                            <small className="muted">Check your brand kit below first if you like; carousels use it.</small>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}
