import { useState } from 'react';
import { Check, Copy, Link2, Loader2, Mail, MessageCircle, X } from 'lucide-react';
import { agencyApi } from '../../lib/agency-api';
import { mailtoLink, reviewMessage, whatsappLink } from './share';

const EXPIRY = [
    { days: 7, label: '7 days' },
    { days: 14, label: '14 days' },
    { days: 30, label: '30 days' },
    { days: 90, label: '90 days' },
];

/**
 * Creates a client review link for the chosen videos, then offers copy / WhatsApp / email.
 * @param {{ assets: object[], client: object|null, onClose: () => void, onSent: (review) => void }} props
 */
export default function SendReviewModal({ assets, client, onClose, onSent }) {
    const [title, setTitle] = useState(assets.length === 1 ? assets[0].title : `${client?.name ? `${client.name}: ` : ''}${assets.length} videos for review`);
    const [message, setMessage] = useState('');
    const [days, setDays] = useState(14);
    const [allowDownload, setAllowDownload] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [review, setReview] = useState(null);
    const [copied, setCopied] = useState(false);

    const send = async () => {
        setBusy(true);
        setError('');
        try {
            const { review: created } = await agencyApi.createReview({ assetIds: assets.map((a) => a.id), title, message, expiresInDays: days, allowDownload });
            setReview(created);
            onSent(created);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const text = review ? reviewMessage({ clientName: client?.name, contactName: client?.contactName, title: review.title, url: review.url, count: assets.length }) : '';

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(review.url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        } catch {
            setError("Couldn't copy. Select the link and copy it manually.");
        }
    };

    return (
        <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className="modal surface cl-send">
                <div className="modal-header">
                    <h3>{review ? 'Review link ready' : 'Send for approval'}</h3>
                    <button type="button" className="btn-icon btn-ghost" onClick={onClose} aria-label="Close">
                        <X size={16} />
                    </button>
                </div>

                {!review ? (
                    <div className="modal-body">
                        <div className="cl-send__thumbs">
                            {assets.slice(0, 6).map((a) => (
                                <span key={a.id} className="cl-send__thumb">
                                    {a.posterUrl ? <img src={a.posterUrl} alt="" /> : null}
                                </span>
                            ))}
                            <small>
                                {assets.length} video{assets.length === 1 ? '' : 's'}
                                {client ? ` for ${client.name}` : ''}
                            </small>
                        </div>
                        <label className="field">
                            <span>Title the client sees</span>
                            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
                        </label>
                        <label className="field">
                            <span>
                                Message <em>optional</em>
                            </span>
                            <textarea className="input" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Here are this week's Reels. Please approve by Thursday so we can post on Friday." />
                        </label>
                        <div className="field-row">
                            <div className="field">
                                <span>Link works for</span>
                                <div className="segmented">
                                    {EXPIRY.map((x) => (
                                        <button key={x.days} type="button" className={days === x.days ? 'is-active' : ''} onClick={() => setDays(x.days)}>
                                            {x.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <label className="check">
                                <input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} />
                                Let the client download the videos
                            </label>
                        </div>
                        <p className="muted cl-send__note">
                            Anyone with the link can view these videos and comment, so only share it with the client. Uploading a new version later updates the same link.
                        </p>
                        {error ? <div className="error-banner">{error}</div> : null}
                    </div>
                ) : (
                    <div className="modal-body">
                        <div className="cl-link">
                            <Link2 size={15} />
                            <input className="input" readOnly value={review.url} onFocus={(e) => e.target.select()} aria-label="Review link" />
                            <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
                                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
                            </button>
                        </div>
                        <div className="cl-share">
                            <a className="btn btn-primary cl-share__wa" href={whatsappLink(client?.contactPhone, text)} target="_blank" rel="noreferrer">
                                <MessageCircle size={16} /> Send on WhatsApp
                            </a>
                            <a className="btn btn-secondary" href={mailtoLink(client?.contactEmail, `For your review: ${review.title}`, text)}>
                                <Mail size={16} /> Send by email
                            </a>
                        </div>
                        <small className="muted">
                            {client?.contactPhone ? `WhatsApp opens a chat with ${client.contactName || client.name}.` : 'Add a WhatsApp number to the client to open their chat directly.'} You'll see their comments and approvals here.
                        </small>
                        {error ? <div className="error-banner">{error}</div> : null}
                    </div>
                )}

                <div className="modal-footer">
                    {review ? (
                        <button type="button" className="btn btn-primary" onClick={onClose}>
                            Done
                        </button>
                    ) : (
                        <>
                            <button type="button" className="btn btn-ghost" onClick={onClose}>
                                Cancel
                            </button>
                            <button type="button" className="btn btn-primary" onClick={send} disabled={busy || !title.trim()}>
                                {busy ? <Loader2 size={15} className="spin" /> : <Link2 size={15} />} Create review link
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
