import { useState } from 'react';
import { Loader2, X } from 'lucide-react';

const COLORS = ['#8b5cf6', '#3b82f6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#64748b'];

/** Add or edit a client brand. */
export default function ClientModal({ client, onSave, onClose }) {
    const [form, setForm] = useState({
        name: client?.name || '',
        contactName: client?.contactName || '',
        contactEmail: client?.contactEmail || '',
        contactPhone: client?.contactPhone || '',
        color: client?.color || COLORS[0],
    });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));

    const submit = async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            await onSave(form);
        } catch (err) {
            setError(err.message);
            setBusy(false);
        }
    };

    return (
        <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <form className="modal surface" onSubmit={submit}>
                <div className="modal-header">
                    <h3>{client ? 'Edit client' : 'Add a client'}</h3>
                    <button type="button" className="btn-icon btn-ghost" onClick={onClose} aria-label="Close">
                        <X size={16} />
                    </button>
                </div>
                <div className="modal-body">
                    <label className="field">
                        <span>Brand or company name</span>
                        <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} required autoFocus placeholder="e.g. Umhlanga Coffee Co." />
                    </label>
                    <div className="field-row">
                        <label className="field">
                            <span>
                                Contact person <em>optional</em>
                            </span>
                            <input className="input" value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} maxLength={80} />
                        </label>
                        <label className="field">
                            <span>
                                Contact email <em>optional</em>
                            </span>
                            <input className="input" type="email" value={form.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} maxLength={120} />
                        </label>
                    </div>
                    <label className="field">
                        <span>
                            WhatsApp number <em>optional</em>
                        </span>
                        <input className="input" inputMode="tel" value={form.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} maxLength={30} placeholder="082 123 4567" />
                        <small>Used to send review links straight to the client on WhatsApp.</small>
                    </label>
                    <div className="field">
                        <span>Colour</span>
                        <div className="cl-colors">
                            {COLORS.map((c) => (
                                <button key={c} type="button" className={`cl-color ${form.color === c ? 'is-active' : ''}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={`Colour ${c}`} />
                            ))}
                        </div>
                    </div>
                    {error ? <div className="error-banner">{error}</div> : null}
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-ghost" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={busy || !form.name.trim()}>
                        {busy ? <Loader2 size={15} className="spin" /> : null} {client ? 'Save' : 'Add client'}
                    </button>
                </div>
            </form>
        </div>
    );
}
