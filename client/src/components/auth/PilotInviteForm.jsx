import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { pendingInviteCode } from '../../lib/pilotInvite';

/** Private pilot: a signed-in account that hasn't joined yet enters its one-time invite code. */
export default function PilotInviteForm() {
    const { user, redeemInvite, logout } = useAuth();
    const [code, setCode] = useState(pendingInviteCode);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submit = async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            await redeemInvite(code.trim());
        } catch (err) {
            setError(err?.message || "That invite code didn't work.");
            setBusy(false);
        }
    };

    return (
        <main className="auth-page">
            <section className="auth-card">
                <h1>Private beta</h1>
                <p>Kengan Social is invitation-only for now. Enter the invite code you were sent to join with <strong>{user?.email}</strong>.</p>
                <form onSubmit={submit}>
                    <label htmlFor="pilot-invite-code">Invite code</label>
                    <input
                        id="pilot-invite-code"
                        className="input"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        required
                        minLength={8}
                        maxLength={64}
                    />
                    {error ? <p role="alert" className="auth-error">{error}</p> : null}
                    <button className="btn btn-primary" type="submit" disabled={busy || code.trim().length < 8}>
                        {busy ? 'Joining…' : 'Join the beta'}
                    </button>
                </form>
                <button className="btn btn-ghost" type="button" onClick={logout}>Sign out and use another account</button>
            </section>
        </main>
    );
}
