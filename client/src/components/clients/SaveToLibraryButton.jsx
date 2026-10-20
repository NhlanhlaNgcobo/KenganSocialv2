import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Check, FolderInput, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { agencyApi } from '../../lib/agency-api';
import { APPROVAL_PLANS } from '../../utils/planLimits';
import './SaveToLibraryButton.css';

/**
 * Saves a finished clip or launch/tutorial video into Clients & approvals, under a chosen client,
 * so it can be sent for approval. The dialog renders in a portal so card overflow/transforms cannot clip it. `downloadUrl` is the render's /api/video/manual-edit/download/<file> URL.
 */
export default function SaveToLibraryButton(props) {
    const { plan } = useAuth();
    // Clients & approvals is part of Creator Pro, Agency and Enterprise only.
    return APPROVAL_PLANS.includes(plan || 'starter') ? <SaveButton {...props} /> : null;
}

function SaveButton({ downloadUrl, title, caption = '', className = 'btn btn-ghost btn-sm' }) {
    const [open, setOpen] = useState(false);
    const [clients, setClients] = useState(null);
    const [clientId, setClientId] = useState('');
    const [busy, setBusy] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');

    const toggle = () => {
        setOpen((o) => !o);
        setError('');
        if (!clients) {
            agencyApi
                .clients()
                .then((d) => {
                    setClients(d.clients);
                    if (d.clients.length === 1) setClientId(d.clients[0].id);
                })
                .catch((err) => setError(err.message));
        }
    };

    const save = async () => {
        setBusy(true);
        setError('');
        try {
            await agencyApi.saveRender({ filename: String(downloadUrl).split('/').pop(), title, caption, clientId: clientId || null });
            setSaved(true);
            setOpen(false);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    if (saved) {
        return (
            <Link to="/dashboard/clients" className={className}>
                <Check size={14} /> In library
            </Link>
        );
    }

    return (
        <span className="stl">
            <button type="button" className={className} onClick={toggle} aria-expanded={open} title="Save to Clients & approvals">
                <FolderInput size={14} /> Save for approval
            </button>
            {open ? createPortal(
                <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
                    <div className="modal surface stl-modal" role="dialog" aria-label="Save for approval">
                        <div className="modal-header">
                            <h3>Save for approval</h3>
                        </div>
                        <div className="modal-body">
                            <p className="muted stl-note">Adds “{title}” to Clients &amp; approvals, where you can send it to the client for sign-off.</p>
                            <label className="field">
                                <span>Client</span>
                                <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={!clients}>
                                    <option value="">{clients ? 'No client' : 'Loading…'}</option>
                                    {(clients || []).map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {error ? <p className="stl-error">{error}</p> : null}
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                                Cancel
                            </button>
                            <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
                                {busy ? <Loader2 size={14} className="spin" /> : <FolderInput size={14} />} Save to library
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            ) : null}
        </span>
    );
}
