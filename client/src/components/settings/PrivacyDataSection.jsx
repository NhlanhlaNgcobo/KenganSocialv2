/**
 * Settings › Privacy & data: download everything stored about you, and delete your account
 * (POPIA rights; Meta, TikTok and YouTube require an easy in-app way to delete data).
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { AlertTriangle, Download, Loader2, Trash2 } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { auth } from '../../lib/firebase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export default function PrivacyDataSection() {
    const navigate = useNavigate();
    const [exporting, setExporting] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [message, setMessage] = useState(null);

    const download = async () => {
        setExporting(true);
        setMessage(null);
        try {
            const token = await auth.currentUser?.getIdToken();
            const res = await fetch(`${API_URL}/privacy/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Your data could not be exported.');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `kengansocial-data-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setMessage({ tone: 'success', text: 'Your data was downloaded as a JSON file.' });
        } catch (error) {
            setMessage({ tone: 'error', text: error.message });
        } finally {
            setExporting(false);
        }
    };

    const deleteAccount = async () => {
        if (confirmText !== 'DELETE') return;
        setDeleting(true);
        setMessage(null);
        try {
            const result = await apiClient('/privacy/account', { method: 'DELETE', body: { confirm: 'DELETE' } });
            localStorage.removeItem('kengan_current_workspace_id');
            // Leave the signed-in area first; signing out inside it would redirect to the login page.
            navigate(`/data-deletion/status?code=${encodeURIComponent(result.confirmationCode)}`, { replace: true });
            await signOut(auth).catch(() => {});
        } catch (error) {
            setMessage({ tone: 'error', text: error.message });
            setDeleting(false);
        }
    };

    return (
        <>
            <div className="settings-section card">
                <h3>Your data</h3>
                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    Download everything KenganSocial stores about you: your profile, workspaces, posts, connected-account details (never the access tokens), analytics, messages and leads.
                </p>
                {message ? (
                    <p className={`settings-privacy-msg is-${message.tone}`} role="status">
                        {message.text}
                    </p>
                ) : null}
                <div className="section-footer">
                    <button className="btn btn-secondary" onClick={download} disabled={exporting}>
                        {exporting ? <Loader2 size={18} className="spin" /> : <Download size={18} />} Download my data
                    </button>
                </div>
                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 16 }}>
                    To remove one platform’s data, disconnect it in <Link to="/dashboard/connections">Connections</Link>: we revoke our access there and delete what it brought in. See the <Link to="/privacy">Privacy Policy</Link> and <Link to="/data-deletion">Data Deletion</Link> page.
                </p>
            </div>

            <div className="settings-section card settings-danger">
                <h3>
                    <AlertTriangle size={18} /> Delete account
                </h3>
                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    This revokes every connected social account at its platform, then permanently deletes the workspaces you own (posts, media, analytics, messages, leads and team access) and your sign-in. Any paid time left on your plan is lost. This cannot be undone; download your data first if you want a copy.
                </p>
                <div className="input-group full-width">
                    <label htmlFor="delete-confirm">Type DELETE to confirm</label>
                    <input id="delete-confirm" className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" autoComplete="off" />
                </div>
                <div className="section-footer">
                    <button className="btn btn-danger" onClick={deleteAccount} disabled={confirmText !== 'DELETE' || deleting}>
                        {deleting ? <Loader2 size={18} className="spin" /> : <Trash2 size={18} />} Delete my account
                    </button>
                </div>
            </div>
        </>
    );
}
