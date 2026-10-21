import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { COMPANY, PRIVACY, TERMS } from '../content/legal';
import './Auth.css';
import './Onboarding.css';

/** The points people agree to, in plain words; the full documents are linked. */
const KEY_POINTS = [
    'We use the social accounts you connect only to do what you ask: publish, reply, show your analytics and run ads you confirm.',
    'We never sell your data, and we never use your content, your connected accounts or your audience’s messages to train AI.',
    'Automations only reply to people who contacted you first, within each platform’s rules, and stop when someone opts out.',
    'You can disconnect any account, or delete your whole account, at any time in Settings.',
    `Your personal information is handled under POPIA by ${COMPANY.operator}, the company that runs ${COMPANY.product}.`,
];

function Check({ id, checked, onChange, required, children }) {
    return (
        <label className={`consent-box ${required ? 'required' : ''} ${checked ? 'checked' : ''}`} htmlFor={id}>
            <div className="consent-box__check">
                <input id={id} type="checkbox" style={{ opacity: 0, position: 'absolute', cursor: 'pointer' }} checked={checked} onChange={(e) => onChange(e.target.checked)} />
                {checked && '✓'}
            </div>
            <div className="consent-box__text">{children}</div>
        </label>
    );
}

/**
 * Shown to every signed-in user who hasn't accepted the current Terms of Service and Privacy
 * Policy: after the first sign-in (email or Google) and again whenever either document changes.
 * Acceptance is recorded on the server with the versions, time and IP (POST /api/auth/consent).
 */
export default function ConsentPage() {
    const { profile, acceptLegal, logout, needsOnboarding } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const isUpdate = !!profile?.legal;
    const [agree, setAgree] = useState(false);
    const [adult, setAdult] = useState(false);
    const [marketing, setMarketing] = useState(profile?.legal?.marketingConsent === true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        document.title = `${isUpdate ? 'Updated terms' : 'Before you continue'} | ${COMPANY.product}`;
    }, [isUpdate]);

    const accept = async () => {
        setSaving(true);
        setError('');
        try {
            const session = await acceptLegal({ marketing, source: isUpdate ? 'update' : 'first_login' });
            const stillOnboarding = session?.user?.onboardingComplete !== true && !session?.user?.consents;
            const from = location.state?.from;
            navigate(stillOnboarding || needsOnboarding ? '/onboarding' : from && !from.startsWith('/consent') ? from : '/dashboard', { replace: true });
        } catch (err) {
            setError(err.message || 'Your answer could not be saved. Try again.');
            setSaving(false);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-page__bg">
                <div className="auth-page__orb auth-page__orb--1" />
                <div className="auth-page__orb auth-page__orb--2" />
            </div>

            <main className="auth-card auth-card--wide animate-fade-in" aria-labelledby="consent-title">
                <div className="auth-card__header">
                    <div className="auth-card__logo">K</div>
                    <h1 id="consent-title">{isUpdate ? 'We’ve updated our terms' : 'Before you continue'}</h1>
                    <p>
                        {isUpdate
                            ? `Our Terms of Service and Privacy Policy changed on ${TERMS.effectiveDate}. Please read and accept them to keep using ${COMPANY.product}.`
                            : `${COMPANY.product} is run by ${COMPANY.operator}. Please read how we handle your account and the social accounts you connect.`}
                    </p>
                </div>

                <ul className="consent-points">
                    {KEY_POINTS.map((point) => (
                        <li key={point}>{point}</li>
                    ))}
                </ul>

                <p className="consent-docs">
                    Read the full{' '}
                    <Link to="/terms" target="_blank" rel="noreferrer">
                        Terms of Service
                    </Link>
                    ,{' '}
                    <Link to="/privacy" target="_blank" rel="noreferrer">
                        Privacy Policy
                    </Link>{' '}
                    and how to{' '}
                    <Link to="/data-deletion" target="_blank" rel="noreferrer">
                        delete your data
                    </Link>
                    . Versions of {TERMS.effectiveDate}
                    {PRIVACY.effectiveDate !== TERMS.effectiveDate ? ` and ${PRIVACY.effectiveDate}` : ''}.
                </p>

                {error && (
                    <div className="auth-card__error" role="alert">
                        {error}
                    </div>
                )}

                <div className="onboarding-fields">
                    <Check id="consent-terms" checked={agree} onChange={setAgree} required>
                        <strong>
                            Terms and privacy <span className="popia-badge">POPIA</span>
                        </strong>
                        I have read and agree to the Terms of Service and Privacy Policy, and I consent to {COMPANY.operator} processing my personal information as they describe.
                    </Check>
                    <Check id="consent-age" checked={adult} onChange={setAdult} required>
                        <strong>Age</strong>I am 18 or older.
                    </Check>
                    <Check id="consent-marketing" checked={marketing} onChange={setMarketing}>
                        <strong>Optional: product news</strong>
                        Email me product updates and tips. You can unsubscribe at any time.
                    </Check>
                </div>

                <div className="auth-card__form">
                    <button id="consent-accept" className="btn btn-primary btn-lg" onClick={accept} disabled={!agree || !adult || saving}>
                        {saving ? 'Saving…' : 'Agree and continue'}
                    </button>
                </div>
                <p className="auth-card__footer">
                    Don’t agree?{' '}
                    <button type="button" className="auth-card__link-btn" onClick={() => logout().then(() => navigate('/', { replace: true }))}>
                        Sign out
                    </button>
                    {isUpdate && (
                        <>
                            {' '}or{' '}
                            <Link to="/data-deletion" target="_blank" rel="noreferrer">
                                delete your data
                            </Link>
                        </>
                    )}
                    .
                </p>
            </main>
        </div>
    );
}
