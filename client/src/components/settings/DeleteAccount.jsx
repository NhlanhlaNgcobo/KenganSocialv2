import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { AlertCircle, Loader2, Trash2 } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { auth } from '../../lib/firebase';

/**
 * Self-serve account deletion (Settings → Security). The server cancels any paid plan, revokes
 * connected accounts and deletes the user's workspaces, files and sign-in, then returns a
 * confirmation code shown on /data-deletion/status.
 */
export default function DeleteAccount({ ownsWorkspace }) {
    const navigate = useNavigate();
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const remove = async () => {
        setBusy(true);
        setError('');
        try {
            const res = await apiClient('/data-deletion/account', { method: 'DELETE', body: { confirm: 'DELETE' } });
            try {
                localStorage.removeItem('kengan_current_workspace_id');
            } catch {
                /* storage unavailable */
            }
            await signOut(auth).catch(() => {});
            navigate(`/data-deletion/status?code=${encodeURIComponent(res.confirmationCode)}`, { replace: true });
        } catch (err) {
            setError(err.message || 'Your account could not be deleted. Please try again.');
            setBusy(false);
        }
    };

    return (
        <div className="settings-section card" aria-labelledby="delete-account-title">
            <h3 id="delete-account-title">Delete account</h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                This permanently deletes your KenganSocial account and cannot be undone.
                {ownsWorkspace
                    ? ' Workspaces you own are deleted for everyone in them, with their content, schedules, automations and files. Connected social accounts are disconnected and their access revoked, and any paid plan is cancelled.'
                    : ' You are removed from the workspaces you belong to.'}{' '}
                Billing records are kept for 5 years, as tax law requires.
            </p>
            {error && (
                <div className="error-banner" role="alert">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                </div>
            )}
            <div className="input-group full-width" style={{ marginTop: 16 }}>
                <label htmlFor="delete-confirm">
                    Type <strong>DELETE</strong> to confirm
                </label>
                <input id="delete-confirm" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} />
            </div>
            <div className="section-footer">
                <button className="btn btn-danger" onClick={remove} disabled={busy || confirm !== 'DELETE'}>
                    {busy ? <Loader2 size={18} className="spin" /> : <Trash2 size={18} />} Delete my account
                </button>
            </div>
        </div>
    );
}
