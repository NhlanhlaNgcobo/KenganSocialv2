import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '../lib/api';
import { COMPANY } from '../content/legal';
import './Legal.css';

const STATUS_TEXT = {
    received: 'Received. Your data is being deleted.',
    completed: 'Completed. The data connected to this request has been deleted.',
};

/**
 * Public status of a data deletion request (/data-deletion/status?code=...). Meta links people
 * here after they remove KenganSocial from Facebook or Instagram; the code is the one we returned.
 */
export default function DeletionStatusPage() {
    const [params, setParams] = useSearchParams();
    const [code, setCode] = useState(params.get('code') || '');
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const lookup = async (value) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        setLoading(true);
        setError('');
        setResult(null);
        try {
            setResult(await apiClient(`/data-deletion/status/${encodeURIComponent(trimmed)}`));
            setParams({ code: trimmed }, { replace: true });
        } catch (err) {
            setError(err.status === 404 ? 'No deletion request has this code. Check it and try again.' : 'The status could not be loaded. Please try again shortly.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        document.title = `Deletion status | ${COMPANY.product}`;
        if (params.get('code')) lookup(params.get('code'));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="legal-root">
            <nav className="legal-nav">
                <Link to="/" className="legal-nav-logo">
                    <span className="legal-logo-k">Kengan</span>
                    <span className="legal-logo-s">Social</span>
                </Link>
                <div className="legal-nav-tabs">
                    <Link to="/data-deletion" className="legal-nav-tab">
                        Data Deletion
                    </Link>
                </div>
            </nav>

            <div className="legal-hero">
                <div className="legal-hero-label">Legal</div>
                <h1 className="legal-hero-title">Deletion request status</h1>
                <div className="legal-hero-sub">Enter the confirmation code you received when you asked us to delete your data.</div>
            </div>

            <main className="legal-content" style={{ maxWidth: 560, margin: '0 auto' }}>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        lookup(code);
                    }}
                    style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                >
                    <label htmlFor="deletion-code" className="legal-sidebar-label" style={{ width: '100%' }}>
                        Confirmation code
                    </label>
                    <input
                        id="deletion-code"
                        className="input"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="e.g. KS-8F2A91C4"
                        autoComplete="off"
                        style={{ flex: '1 1 220px' }}
                    />
                    <button type="submit" className="btn btn-primary" disabled={loading || !code.trim()}>
                        {loading ? 'Checking…' : 'Check status'}
                    </button>
                </form>

                {error && (
                    <p className="legal-section-body" role="alert" style={{ marginTop: 20 }}>
                        {error}
                    </p>
                )}
                {result && (
                    <div className="legal-section" style={{ marginTop: 24 }} aria-live="polite">
                        <h2 className="legal-section-heading">{STATUS_TEXT[result.status] || result.status}</h2>
                        <div className="legal-section-body">
                            Code: {result.code}
                            {'\n'}Requested: {new Date(result.requestedAt).toLocaleString('en-ZA')}
                            {result.completedAt ? `\nCompleted: ${new Date(result.completedAt).toLocaleString('en-ZA')}` : ''}
                        </div>
                    </div>
                )}

                <p className="legal-section-body" style={{ marginTop: 28 }}>
                    Questions? Email <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>.
                </p>
            </main>
        </div>
    );
}
