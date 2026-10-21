import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone, Pause, Play, Pencil, Loader2, RefreshCw, History, ExternalLink, GraduationCap } from 'lucide-react';
import GuidedTutorial, { useTutorial } from '../components/tutorial/GuidedTutorial';
import { META_ADS_TUTORIAL } from '../components/tutorial/metaAdsTutorial';
import { apiClient } from '../lib/api';
import { useWorkspace } from '../context/WorkspaceContext';
import './Ads.css';

const PRESETS = [
    ['today', 'Today'],
    ['yesterday', 'Yesterday'],
    ['last_7d', 'Last 7 days'],
    ['last_30d', 'Last 30 days'],
    ['this_month', 'This month'],
    ['last_month', 'Last month'],
];

const RESULT_LABEL = {
    'offsite_conversion.fb_pixel_purchase': 'purchases',
    lead: 'leads',
    'onsite_conversion.messaging_conversation_started_7d': 'conversations',
    link_click: 'link clicks',
    video_view: 'video views',
    post_engagement: 'engagements',
};

const ACTIVITY_LABEL = { pause: 'Paused', resume: 'Resumed', daily_budget: 'Changed daily budget of' };

/** Budgets come in the currency's minor unit (cents); shown and entered in the major unit. */
const fromMinor = (v) => (v === null || v === undefined ? null : v / 100);

export default function AdsPage() {
    const { currentWorkspace, loading: workspaceLoading } = useWorkspace();
    const tutorial = useTutorial(META_ADS_TUTORIAL.id);
    const tutorialUi = (
        <GuidedTutorial id={META_ADS_TUTORIAL.id} title={META_ADS_TUTORIAL.title} steps={META_ADS_TUTORIAL.steps} open={tutorial.open} onClose={tutorial.close} />
    );
    const howItWorks = (
        <button className="btn btn-secondary gt-open" onClick={tutorial.show}>
            <GraduationCap size={16} /> How it works
        </button>
    );
    const [preset, setPreset] = useState('last_7d');
    const [account, setAccount] = useState(null);
    const [campaigns, setCampaigns] = useState([]);
    const [activity, setActivity] = useState([]);
    const [loading, setLoading] = useState(true);
    const [notConnected, setNotConnected] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busyId, setBusyId] = useState(null);
    const [editing, setEditing] = useState(null); // { id, value }
    // No workspace once loading has finished: nothing to load, so no spinner (the layout explains why).
    const waiting = loading && (workspaceLoading || Boolean(currentWorkspace));

    const money = useCallback(
        (v) => {
            if (v === null || v === undefined) return '—';
            try {
                return new Intl.NumberFormat(undefined, { style: 'currency', currency: account?.currency || 'USD' }).format(v);
            } catch {
                return Number(v).toFixed(2);
            }
        },
        [account?.currency]
    );
    const count = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString());

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [ov, cs, act] = await Promise.all([
                apiClient(`/ads/overview?preset=${preset}`),
                apiClient(`/ads/campaigns?preset=${preset}`),
                apiClient('/ads/activity'),
            ]);
            setAccount(ov.account);
            setCampaigns(cs.campaigns || []);
            setActivity(act.activity || []);
            setNotConnected(false);
        } catch (err) {
            if (err.status === 404) setNotConnected(true);
            else setError(err.message || 'Meta Ads could not be loaded.');
        } finally {
            setLoading(false);
        }
    }, [preset]);

    useEffect(() => {
        if (currentWorkspace?.id) load();
    }, [currentWorkspace?.id, load]);

    const toggleStatus = async (c) => {
        const next = c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
        const verb = next === 'PAUSED' ? 'Pause' : 'Resume';
        if (!window.confirm(`${verb} "${c.name}"? ${next === 'PAUSED' ? 'Its ads stop delivering and spending.' : 'Its ads start delivering and spending again.'}`)) return;
        setBusyId(c.id);
        setError('');
        setNotice('');
        try {
            await apiClient(`/ads/campaigns/${c.id}/status`, { method: 'POST', body: { status: next } });
            setNotice(`${c.name} is ${next === 'PAUSED' ? 'paused' : 'active again'}.`);
            await load();
        } catch (err) {
            setError(err.message || 'The campaign could not be changed.');
        } finally {
            setBusyId(null);
        }
    };

    const saveBudget = async (c) => {
        const value = Number(String(editing?.value || '').replace(',', '.'));
        if (!Number.isFinite(value) || value < 1) {
            setError('Enter a daily budget of at least 1.');
            return;
        }
        const minor = Math.round(value * 100);
        if (!window.confirm(`Change the daily budget of "${c.name}" from ${money(fromMinor(c.dailyBudget))} to ${money(value)}?`)) return;
        setBusyId(c.id);
        setError('');
        setNotice('');
        try {
            await apiClient(`/ads/campaigns/${c.id}/budget`, { method: 'POST', body: { dailyBudget: minor } });
            setNotice(`Daily budget of ${c.name} is now ${money(value)}.`);
            setEditing(null);
            await load();
        } catch (err) {
            setError(err.message || 'The budget could not be changed.');
        } finally {
            setBusyId(null);
        }
    };

    if (!loading && notConnected) {
        return (
            <div className="ads-page animate-fade-in">
                <div className="page-header">
                    <div>
                        <h1>Meta Ads</h1>
                        <p className="page-subtitle">See how your Facebook and Instagram campaigns perform, and pause, resume or adjust them.</p>
                    </div>
                    {howItWorks}
                </div>
                <div className="card ads-empty">
                    <Megaphone size={40} />
                    <h3>Connect a Meta ad account</h3>
                    <p>Sign in with Facebook and choose the ad account to show here. KenganSocial only changes a campaign when you do it on this page.</p>
                    <Link to="/dashboard/connections" className="btn btn-primary">
                        Go to Connections
                    </Link>
                </div>
                {tutorialUi}
            </div>
        );
    }

    return (
        <div className="ads-page animate-fade-in">
            <div className="page-header">
                <div>
                    <h1>Meta Ads</h1>
                    <p className="page-subtitle">
                        {account ? `${account.name} · ${account.currency}` : 'Your ad account'}. Changes you make here go live on Meta straight away and are recorded below.
                    </p>
                </div>
                <div className="ads-toolbar">
                    {howItWorks}
                    <label htmlFor="ads-preset" className="sr-only">Period</label>
                    <select id="ads-preset" className="input" value={preset} onChange={(e) => setPreset(e.target.value)}>
                        {PRESETS.map(([id, label]) => (
                            <option key={id} value={id}>
                                {label}
                            </option>
                        ))}
                    </select>
                    <button className="btn btn-secondary" onClick={load} disabled={loading} aria-label="Reload">
                        <RefreshCw size={16} className={loading ? 'spin' : ''} />
                    </button>
                </div>
            </div>

            {error && (
                <div className="error-banner" role="alert">
                    {error}
                </div>
            )}
            {notice && (
                <div className="success-banner" role="status">
                    {notice}
                </div>
            )}

            {waiting && !account ? (
                <div className="card ads-empty">
                    <Loader2 size={28} className="spin" />
                </div>
            ) : (
                <>
                    <div className="ads-totals">
                        {[
                            ['Spend', money(account?.totals?.spend)],
                            ['Reach', count(account?.totals?.reach)],
                            ['Impressions', count(account?.totals?.impressions)],
                            ['Clicks', count(account?.totals?.clicks)],
                            ['CTR', account?.totals?.ctr != null ? `${Number(account.totals.ctr).toFixed(2)}%` : '—'],
                            ['Cost per click', money(account?.totals?.cpc)],
                        ].map(([label, value]) => (
                            <div key={label} className="card ads-metric">
                                <span>{label}</span>
                                <strong>{value}</strong>
                            </div>
                        ))}
                    </div>

                    <section className="card ads-campaigns">
                        <h3>Campaigns</h3>
                        {campaigns.length === 0 ? (
                            <p className="ads-muted">No campaigns in this ad account yet. Create one in Meta Ads Manager and it will appear here.</p>
                        ) : (
                            <div className="ads-table-wrap">
                                <table className="ads-table">
                                    <thead>
                                        <tr>
                                            <th scope="col">Campaign</th>
                                            <th scope="col">Daily budget</th>
                                            <th scope="col">Spend</th>
                                            <th scope="col">Reach</th>
                                            <th scope="col">Clicks</th>
                                            <th scope="col">Results</th>
                                            <th scope="col">
                                                <span className="sr-only">Actions</span>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {campaigns.map((c) => {
                                            const busy = busyId === c.id;
                                            const isEditing = editing?.id === c.id;
                                            return (
                                                <tr key={c.id}>
                                                    <td>
                                                        <strong>{c.name}</strong>
                                                        <span className={`ads-status ads-status--${String(c.effectiveStatus || c.status).toLowerCase()}`}>
                                                            {String(c.effectiveStatus || c.status).replace(/_/g, ' ').toLowerCase()}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        {isEditing ? (
                                                            <span className="ads-budget-edit">
                                                                <label htmlFor={`budget-${c.id}`} className="sr-only">New daily budget</label>
                                                                <input
                                                                    id={`budget-${c.id}`}
                                                                    className="input input-sm"
                                                                    inputMode="decimal"
                                                                    value={editing.value}
                                                                    onChange={(e) => setEditing({ id: c.id, value: e.target.value })}
                                                                    onKeyDown={(e) => e.key === 'Enter' && saveBudget(c)}
                                                                    autoFocus
                                                                />
                                                                <button className="btn btn-primary btn-sm" onClick={() => saveBudget(c)} disabled={busy}>
                                                                    Save
                                                                </button>
                                                                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)} disabled={busy}>
                                                                    Cancel
                                                                </button>
                                                            </span>
                                                        ) : c.dailyBudget ? (
                                                            <span className="ads-budget">
                                                                {money(fromMinor(c.dailyBudget))}
                                                                <button
                                                                    className="btn-icon btn-ghost"
                                                                    onClick={() => setEditing({ id: c.id, value: String(fromMinor(c.dailyBudget)) })}
                                                                    aria-label={`Change the daily budget of ${c.name}`}
                                                                    title="Change daily budget"
                                                                >
                                                                    <Pencil size={14} />
                                                                </button>
                                                            </span>
                                                        ) : (
                                                            <span className="ads-muted" title="The budget is set on the ad sets (change it in Ads Manager)">
                                                                {c.lifetimeBudget ? `${money(fromMinor(c.lifetimeBudget))} lifetime` : 'Set on ad sets'}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td>{money(c.insights.spend)}</td>
                                                    <td>{count(c.insights.reach)}</td>
                                                    <td>{count(c.insights.clicks)}</td>
                                                    <td>{c.insights.result ? `${count(c.insights.result.value)} ${RESULT_LABEL[c.insights.result.type] || ''}` : '—'}</td>
                                                    <td>
                                                        {(c.status === 'ACTIVE' || c.status === 'PAUSED') && (
                                                            <button className="btn btn-secondary btn-sm" onClick={() => toggleStatus(c)} disabled={busy}>
                                                                {busy ? <Loader2 size={14} className="spin" /> : c.status === 'ACTIVE' ? <Pause size={14} /> : <Play size={14} />}
                                                                {c.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        <a className="ads-link" href="https://adsmanager.facebook.com/" target="_blank" rel="noreferrer">
                            Create or edit ads in Meta Ads Manager <ExternalLink size={13} />
                        </a>
                    </section>

                    <section className="card ads-activity">
                        <h3>
                            <History size={16} /> Changes made from KenganSocial
                        </h3>
                        {activity.length === 0 ? (
                            <p className="ads-muted">No changes yet.</p>
                        ) : (
                            <ul>
                                {activity.map((a) => (
                                    <li key={a.id}>
                                        <span>
                                            {ACTIVITY_LABEL[a.action] || a.action} <strong>{a.campaignName}</strong>
                                            {a.action === 'daily_budget' ? ` from ${money(fromMinor(a.from))} to ${money(fromMinor(a.to))}` : ''}
                                        </span>
                                        <time>{a.at ? new Date(a.at).toLocaleString() : ''}</time>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </>
            )}
            {tutorialUi}
        </div>
    );
}
