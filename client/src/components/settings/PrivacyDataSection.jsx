/**
 * Settings › Security: download everything KenganSocial stores about you (POPIA right of access).
 * Account deletion is the DeleteAccount card below it.
 */
import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { auth } from '../../lib/firebase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export default function PrivacyDataSection() {
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(null);

    const download = async () => {
        setBusy(true);
        setMessage(null);
        try {
            const token = await auth.currentUser?.getIdToken();
            const res = await fetch(`${API_URL}/privacy/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Your data could not be exported.');
            const url = URL.createObjectURL(await res.blob());
            const a = document.createElement('a');
            a.href = url;
            a.download = `kengansocial-data-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setMessage({ tone: 'success', text: 'Your data was downloaded as a JSON file.' });
        } catch (error) {
            setMessage({ tone: 'error', text: error.message });
        } finally {
            setBusy(false);
        }
    };

    return (
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
                <button className="btn btn-secondary" onClick={download} disabled={busy}>
                    {busy ? <Loader2 size={18} className="spin" /> : <Download size={18} />} Download my data
                </button>
            </div>
        </div>
    );
}
