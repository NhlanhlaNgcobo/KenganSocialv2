import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Check, ShieldCheck, X } from 'lucide-react';
import { NEVER, PLATFORM_PERMISSIONS } from '../../content/platform-permissions';
import { useAuth } from '../../context/AuthContext';
import './ConnectPermissions.css';

/**
 * Explains, before the platform's own consent screen, what KenganSocial will ask that platform for
 * and why, what we never do, and how to disconnect. Continue starts the platform sign-in.
 */
export default function ConnectPermissions({ platform, onContinue, onCancel, busy }) {
    const info = PLATFORM_PERMISSIONS[platform];
    const continueRef = useRef(null);
    const { capabilities } = useAuth();
    // TikTok's Sandbox only lets in accounts added as testers ("non_sandbox_target" otherwise).
    const tiktokBeta = platform === 'tiktok' && capabilities?.beta;

    useEffect(() => {
        continueRef.current?.focus();
        const onKey = (e) => e.key === 'Escape' && !busy && onCancel();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [busy, onCancel]);

    if (!info) return null;
    return (
        <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
            <div className="modal cp-modal" role="dialog" aria-modal="true" aria-labelledby="cp-title">
                <div className="modal-header">
                    <h3 id="cp-title">Connect {info.name}</h3>
                    <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy} aria-label="Close">
                        <X size={16} />
                    </button>
                </div>
                <div className="modal-body">
                    {tiktokBeta ? (
                        <p className="cp-beta" role="note">
                            <strong>Beta:</strong> your TikTok account must be added as a tester first. If TikTok says
                            “non_sandbox_target”, send your TikTok username to the KenganSocial team and try again once you’re added.
                        </p>
                    ) : null}
                    <p className="cp-lead">
                        You’ll sign in with {info.signInWith}, which asks you to allow KenganSocial to:
                    </p>
                    <ul className="cp-list">
                        {info.asks.map(([title, detail]) => (
                            <li key={title}>
                                <Check size={16} aria-hidden="true" />
                                <span>
                                    <strong>{title}.</strong> {detail}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <p className="cp-lead">We never:</p>
                    <ul className="cp-list cp-list--never">
                        {NEVER.map((n) => (
                            <li key={n}>
                                <X size={16} aria-hidden="true" />
                                <span>{n}</span>
                            </li>
                        ))}
                    </ul>
                    <p className="cp-note">
                        <ShieldCheck size={15} aria-hidden="true" /> <span>Needs: {info.requirements}</span>
                    </p>
                    <p className="cp-note cp-note--text">
                        You can disconnect at any time on this page. We then revoke our access and delete this account’s data within 7 days.{' '}
                        <Link to="/privacy" target="_blank" rel="noreferrer">
                            Privacy Policy
                        </Link>
                    </p>
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>
                        Cancel
                    </button>
                    <button ref={continueRef} id="cp-continue" className="btn btn-primary" onClick={onContinue} disabled={busy}>
                        {busy ? 'Opening…' : `Continue to ${info.signInWith}`}
                    </button>
                </div>
            </div>
        </div>
    );
}
