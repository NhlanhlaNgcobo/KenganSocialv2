import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../lib/api';

/**
 * Private pilot admin (Firebase claim `pilotAdmin`, enforced by the server): invites, members,
 * quotas per tester, queues, server load and costs. Read-mostly; actions are invite/revoke only.
 */
const fmt = (v) => (v === null || v === undefined ? '—' : v === -1 ? '∞' : String(v));
const fetchAll = () => Promise.all([apiClient('/pilot/admin/overview'), apiClient('/pilot/admin/invites')]);
const usageCell = (u) => (u ? `${fmt(u.used)} / ${fmt(u.limit)}` : '—');

export default function PilotAdminPage() {
    const [overview, setOverview] = useState(null);
    const [invites, setInvites] = useState([]);
    const [error, setError] = useState('');
    const [note, setNote] = useState('');
    const [email, setEmail] = useState('');
    const [created, setCreated] = useState(null);

    const apply = useCallback(([o, i]) => {
        setOverview(o);
        setInvites(i.invites || []);
    }, []);
    const load = useCallback(() => {
        setError('');
        return fetchAll().then(apply).catch((err) => setError(err?.message || 'Could not load the pilot overview.'));
    }, [apply]);
    useEffect(() => {
        let live = true;
        fetchAll().then((r) => live && apply(r)).catch((err) => live && setError(err?.message || 'Could not load the pilot overview.'));
        return () => { live = false; };
    }, [apply]);

    const createInvite = async (e) => {
        e.preventDefault();
        try {
            const invite = await apiClient('/pilot/admin/invites', { method: 'POST', body: JSON.stringify({ note, email }) });
            setCreated(invite);
            setNote('');
            setEmail('');
            load();
        } catch (err) {
            setError(err?.message || 'Could not create the invite.');
        }
    };
    const act = async (path, confirmText) => {
        if (confirmText && !window.confirm(confirmText)) return;
        try {
            await apiClient(path, { method: 'POST' });
            load();
        } catch (err) {
            setError(err?.message || 'That action failed.');
        }
    };

    const inviteLink = created ? `${window.location.origin}/login?invite=${encodeURIComponent(created.code)}` : '';
    const s = overview?.server;

    return (
        <div className="page pilot-admin" style={{ display: 'grid', gap: '1.5rem' }}>
            <header>
                <h1>Private beta</h1>
                <p className="text-muted">
                    {overview ? `${overview.pilot ? 'Pilot mode on' : 'Pilot mode OFF (PILOT_MODE is not "true")'} · seats ${overview.seats.used} / ${overview.seats.max}` : 'Loading…'}
                </p>
                {error ? <p role="alert" className="auth-error">{error}</p> : null}
            </header>

            <section className="card">
                <h2>Invite a tester</h2>
                <form onSubmit={createInvite} style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
                    <label>Note<input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="Who is it for?" /></label>
                    <label>Only for email (optional)<input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
                    <button className="btn btn-primary" type="submit">Create invite</button>
                </form>
                {created ? (
                    <div role="status" style={{ marginTop: '.75rem' }}>
                        <p>Send this link (shown once; expires {new Date(created.expiresAt).toLocaleDateString()}):</p>
                        <code style={{ wordBreak: 'break-all' }}>{inviteLink}</code>{' '}
                        <button className="btn btn-sm" type="button" onClick={() => navigator.clipboard?.writeText(inviteLink)}>Copy</button>
                    </div>
                ) : null}
            </section>

            <section className="card">
                <h2>Testers and usage</h2>
                <div style={{ overflowX: 'auto' }}>
                    <table className="table">
                        <thead><tr><th>Email</th><th>Joined</th><th>AI today</th><th>AI month</th><th>Exports</th><th>Transcribe min</th><th>Posts</th><th /></tr></thead>
                        <tbody>
                            {(overview?.members || []).map((m) => {
                                const u = overview.usage?.find((r) => r.uid === m.uid);
                                return (
                                    <tr key={m.uid} style={m.revokedAt ? { opacity: 0.5 } : undefined}>
                                        <td>{m.email}</td>
                                        <td>{m.joinedAt?.slice(0, 10)}</td>
                                        <td>{usageCell(u?.aiToday)}</td>
                                        <td>{usageCell(u?.aiCalls)}</td>
                                        <td>{usageCell(u?.exports)}</td>
                                        <td>{usageCell(u?.transcribeMinutes)}</td>
                                        <td>{usageCell(u?.posts)}</td>
                                        <td>{m.revokedAt ? 'revoked' : <button className="btn btn-sm btn-danger" onClick={() => act(`/pilot/admin/members/${m.uid}/revoke`, `End beta access for ${m.email}? Their data is kept.`)}>Revoke</button>}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="card">
                <h2>Invites</h2>
                <table className="table">
                    <thead><tr><th>Note</th><th>For</th><th>Created</th><th>Status</th><th /></tr></thead>
                    <tbody>
                        {invites.map((i) => {
                            const status = i.status;
                            return (
                                <tr key={i.id}>
                                    <td>{i.note || '—'}</td>
                                    <td>{i.email || 'anyone'}</td>
                                    <td>{i.createdAt?.slice(0, 10)}</td>
                                    <td>{status}</td>
                                    <td>{status === 'open' ? <button className="btn btn-sm" onClick={() => act(`/pilot/admin/invites/${i.id}/revoke`)}>Withdraw</button> : null}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </section>

            <section className="card">
                <h2>Jobs, server and costs</h2>
                {overview ? (
                    <ul>
                        <li>Scheduled posts queue: {Object.entries(overview.queues?.scheduledPosts || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}</li>
                        <li>Editor exports, last 24 h: {Object.entries(overview.exportsLast24h || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}</li>
                        <li>Server: load {s?.loadavg?.map((x) => x.toFixed(2)).join(' / ')} on {s?.cpus} CPUs · memory free {s?.memFreeMB} / {s?.memTotalMB} MB · API process {s?.processRssMB} MB · up {Math.round((s?.uptimeS || 0) / 3600)} h</li>
                        <li>Costs: AI and transcription are self-hosted ($0 per call); storage ${overview.costs?.storageUSDPerGBMonth}/GB-month; the server is a fixed monthly cost.</li>
                    </ul>
                ) : null}
                <button className="btn" type="button" onClick={load}>Refresh</button>
            </section>
        </div>
    );
}
