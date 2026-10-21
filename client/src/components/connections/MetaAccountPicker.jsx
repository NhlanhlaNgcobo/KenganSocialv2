import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { apiClient } from '../../lib/api';
import './ConnectPermissions.css';

const LABELS = {
    instagram: { title: 'Choose an Instagram account', noun: 'Instagram account' },
    facebook: { title: 'Choose a Facebook Page', noun: 'Page' },
    meta_ads: { title: 'Choose an ad account', noun: 'ad account' },
};

/**
 * After a Meta sign-in that found several Pages, Instagram accounts or ad accounts, the person picks
 * the one this workspace should use. The server holds the list (and its tokens) for 15 minutes.
 */
export default function MetaAccountPicker({ platform, onDone, onCancel }) {
    const label = LABELS[platform];
    const [candidates, setCandidates] = useState(null);
    const [choice, setChoice] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const firstRef = useRef(null);

    useEffect(() => {
        let alive = true;
        apiClient(`/connections/${platform}/candidates`)
            .then((data) => {
                if (!alive) return;
                setCandidates(data.candidates || []);
                setChoice(data.candidates?.[0]?.accountId || '');
            })
            .catch((err) => alive && setError(err.message || 'The list could not be loaded. Connect again.'));
        return () => {
            alive = false;
        };
    }, [platform]);

    useEffect(() => {
        if (candidates?.length) firstRef.current?.focus();
    }, [candidates]);

    const cancel = async () => {
        if (busy) return;
        apiClient(`/connections/${platform}/candidates`, { method: 'DELETE' }).catch(() => {});
        onCancel();
    };

    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && cancel();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    const connect = async () => {
        setBusy(true);
        setError('');
        try {
            await apiClient(`/connections/${platform}/select`, { method: 'POST', body: { accountId: choice } });
            onDone(candidates.find((c) => c.accountId === choice)?.name);
        } catch (err) {
            setError(err.message || 'The account could not be connected. Try again.');
            setBusy(false);
        }
    };

    if (!label) return null;
    return (
        <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
            <div className="modal cp-modal" role="dialog" aria-modal="true" aria-labelledby="map-title">
                <div className="modal-header">
                    <h3 id="map-title">{label.title}</h3>
                    <button className="btn btn-ghost btn-sm" onClick={cancel} disabled={busy} aria-label="Close">
                        <X size={16} />
                    </button>
                </div>
                <div className="modal-body">
                    <p className="cp-lead">You manage more than one {label.noun}. Pick the one this workspace should use.</p>
                    {error && (
                        <p className="connect-inline-error" role="alert">
                            {error}
                        </p>
                    )}
                    {!candidates && !error && (
                        <p className="cp-note">
                            <Loader2 size={15} className="spin" /> <span>Loading your accounts…</span>
                        </p>
                    )}
                    {candidates?.length > 0 && (
                        <fieldset className="map-list">
                            <legend className="sr-only">{label.title}</legend>
                            {candidates.map((c, i) => (
                                <label key={c.accountId} className={`map-option ${choice === c.accountId ? 'is-selected' : ''}`}>
                                    <input
                                        ref={i === 0 ? firstRef : undefined}
                                        type="radio"
                                        name="meta-account"
                                        value={c.accountId}
                                        checked={choice === c.accountId}
                                        onChange={() => setChoice(c.accountId)}
                                    />
                                    {c.avatar ? <img src={c.avatar} alt="" className="map-avatar" /> : <span className="map-avatar map-avatar--blank" aria-hidden="true" />}
                                    <span className="map-text">
                                        <strong>{c.name}</strong>
                                        <span>
                                            {[c.detail, c.followers ? `${Number(c.followers).toLocaleString()} followers` : ''].filter(Boolean).join(' · ') || c.accountId}
                                        </span>
                                    </span>
                                </label>
                            ))}
                        </fieldset>
                    )}
                    <p className="cp-note cp-note--text">To use a different one later, disconnect it and connect again.</p>
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={cancel} disabled={busy}>
                        Cancel
                    </button>
                    <button id="map-connect" className="btn btn-primary" onClick={connect} disabled={busy || !choice}>
                        {busy ? 'Connecting…' : 'Connect'}
                    </button>
                </div>
            </div>
        </div>
    );
}
