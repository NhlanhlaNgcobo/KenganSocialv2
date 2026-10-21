import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { apiClient } from '../lib/api';
import { BILLING_EMAIL, fetchPlanCatalog, formatZar } from '../utils/planLimits';
import './Onboarding.css';


// ─── Constants ────────────────────────────────────────────────────────────────

const INDUSTRIES = [
    'Content Creator', 'E-Commerce / Retail', 'Restaurant & Food',
    'Fitness & Wellness', 'Beauty & Fashion', 'Real Estate',
    'Music & Entertainment', 'Travel & Hospitality', 'Education & Coaching',
    'Finance & Legal', 'Technology & SaaS', 'Non-Profit',
    'Healthcare', 'Other',
];

const PLATFORMS = [
    {
        id: 'youtube',
        name: 'YouTube',
        emoji: '▶️',
        bg: '#FF0000',
        desc: 'Schedule Shorts & long-form videos',
    },
    {
        id: 'instagram',
        name: 'Instagram',
        emoji: '📸',
        bg: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)',
        desc: 'Reels, stories & carousel posts',
    },
    {
        id: 'tiktok',
        name: 'TikTok',
        emoji: '🎵',
        bg: '#010101',
        desc: 'Short-form video & trends',
    },
    {
        id: 'facebook',
        name: 'Facebook',
        emoji: '👍',
        bg: '#1877F2',
        desc: 'Page posts, Reels & comments',
    },
];

const STEPS = ['Account Setup', 'Connect Accounts', 'Choose Plan'];

// ─── Step indicator ────────────────────────────────────────────────────────────
function StepProgress({ current }) {
    return (
        <div className="onboarding-progress">
            {STEPS.map((label, i) => {
                const status = i < current ? 'completed' : i === current ? 'active' : '';
                return (
                    <div key={label} className={`onboarding-progress__step ${status}`}>
                        <div className="onboarding-progress__circle">
                            {i < current ? '✓' : i + 1}
                        </div>
                        <span className="onboarding-progress__label">{label}</span>
                    </div>
                );
            })}
        </div>
    );
}

// ─── STEP 1 — Account Setup ────────────────────────────────────────────────────
function StepSetup({ onNext }) {
    const { user } = useAuth();
    const [fullName, setFullName] = useState(user?.displayName || '');
    const [workspaceName, setWorkspaceName] = useState('');
    const [industry, setIndustry] = useState('');
    const [popiaConsent, setPopiaConsent] = useState(false);
    const [marketingConsent, setMarketingConsent] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const valid =
        fullName.trim().length > 0 &&
        workspaceName.trim().length >= 3 &&
        workspaceName.trim().length <= 50 &&
        industry !== '' &&
        popiaConsent;

    const handleNext = async () => {
        if (!valid) return;
        setSaving(true);
        setError('');
        try {
            // The server saves the profile, the consent record (POPIA audit trail) and the
            // workspace name together.
            await apiClient('/auth/onboarding', {
                method: 'POST',
                body: { fullName: fullName.trim(), niche: industry, workspaceName: workspaceName.trim(), popiaConsent, marketingConsent },
            });

            onNext({ fullName: fullName.trim(), workspaceName: workspaceName.trim(), industry });
        } catch (err) {
            console.error('Onboarding save failed:', err);
            setError(err.message || 'Could not save your details. Try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="onboarding-card animate-fade-in">
            <div className="onboarding-card__header">
                <h2>Set up your account</h2>
                <p>Tell us a bit about yourself and your workspace.</p>
            </div>

            {error && <div className="error-banner" style={{ marginBottom: 20 }}>{error}</div>}

            <div className="onboarding-fields">
                {/* Full name */}
                <div className="input-group">
                    <label htmlFor="ob-fullname">Full Name</label>
                    <input
                        id="ob-fullname"
                        type="text"
                        className="input"
                        placeholder="Nhlanhla Ngcobo"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                    />
                </div>

                {/* Workspace name */}
                <div className="input-group">
                    <label htmlFor="ob-workspace">
                        Workspace Name
                        <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>
                            (3–50 characters)
                        </span>
                    </label>
                    <input
                        id="ob-workspace"
                        type="text"
                        className="input"
                        placeholder="e.g. Kengan Studio"
                        value={workspaceName}
                        minLength={3}
                        maxLength={50}
                        onChange={(e) => setWorkspaceName(e.target.value)}
                    />
                </div>

                {/* Industry selector */}
                <div className="input-group">
                    <label htmlFor="ob-industry">Industry / Niche</label>
                    <div style={{ position: 'relative' }}>
                        <select
                            id="ob-industry"
                            className="onboarding-select"
                            value={industry}
                            onChange={(e) => setIndustry(e.target.value)}
                        >
                            <option value="">Select your niche…</option>
                            {INDUSTRIES.map((ind) => (
                                <option key={ind} value={ind}>{ind}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Consent Section (South African Law Requirement) */}
                <div className="onboarding-fields" style={{ marginTop: 24 }}>
                    <label
                        className={`consent-box required ${popiaConsent ? 'checked' : ''}`}
                        htmlFor="ob-popia"
                    >
                        <div className="consent-box__check">
                            <input
                                id="ob-popia"
                                type="checkbox"
                                style={{ opacity: 0, position: 'absolute', cursor: 'pointer' }}
                                checked={popiaConsent}
                                onChange={(e) => setPopiaConsent(e.target.checked)}
                            />
                            {popiaConsent && '✓'}
                        </div>
                        <div className="consent-box__text">
                            <strong>Privacy & POPIA Consent <span className="popia-badge">POPIA</span></strong>
                            I consent to KenganSocial processing my personal information in accordance with the
                            <Link to="/privacy" target="_blank" style={{ color: 'var(--brand)', textDecoration: 'underline', marginLeft: 4 }}>Privacy Policy</Link>
                            and POPIA. I am 18 or older.
                        </div>
                    </label>

                    <label
                        className={`consent-box ${marketingConsent ? 'checked' : ''}`}
                        htmlFor="ob-marketing"
                    >
                        <div className="consent-box__check">
                            <input
                                id="ob-marketing"
                                type="checkbox"
                                style={{ opacity: 0, position: 'absolute', cursor: 'pointer' }}
                                checked={marketingConsent}
                                onChange={(e) => setMarketingConsent(e.target.checked)}
                            />
                            {marketingConsent && '✓'}
                        </div>
                        <div className="consent-box__text">
                            <strong>Optional: Marketing Updates</strong>
                            I agree to receive product updates, tips, and marketing communications from KenganSocial.
                        </div>
                    </label>
                </div>
            </div>

            <div className="onboarding-actions onboarding-actions--end">
                <button
                    id="ob-setup-next"
                    className="btn btn-primary btn-lg"
                    disabled={!valid || saving}
                    onClick={handleNext}
                >
                    {saving ? 'Saving…' : 'Continue →'}
                </button>
            </div>
        </div>
    );
}

// ─── STEP 2 — Connect Accounts ─────────────────────────────────────────────────
function StepConnect({ onNext, onBack }) {
    const [connecting, setConnecting] = useState(null);
    const [error, setError] = useState('');

    const handleConnect = async (platform) => {
        setConnecting(platform.id);
        setError('');
        try {
            // The server builds the OAuth link for this workspace (it needs the signed-in user's token).
            const data = await apiClient(`/connections/${platform.id}/auth-url`);
            if (!data?.url) throw new Error('Could not start the connection. Try again.');
            window.location.assign(data.url);
        } catch (err) {
            setError(
                /OAUTH_NOT_CONFIGURED/.test(err.message || '')
                    ? `${platform.name} is not set up on the server yet. You can connect it later from Connections.`
                    : err.message || 'Could not start the connection. Try again.'
            );
            setConnecting(null);
        }
    };

    return (
        <div className="onboarding-card animate-fade-in">
            <div className="onboarding-card__header">
                <h2>Connect your accounts</h2>
                <p>Link your social platforms to start scheduling and publishing. You can add more later from Connections.</p>
            </div>

            {error && <div className="error-banner" role="alert" style={{ marginBottom: 20 }}>{error}</div>}

            <div className="platforms-grid stagger-children">
                {PLATFORMS.map((p) => (
                    <div key={p.id} className="platform-card">
                        <div
                            className="platform-card__icon"
                            style={{ background: p.bg, fontSize: '1.5rem' }}
                        >
                            {p.emoji}
                        </div>
                        <div className="platform-card__info">
                            <div className="platform-card__name">{p.name}</div>
                            <div className="platform-card__desc">{p.desc}</div>
                        </div>
                        <button
                            id={`ob-connect-${p.id}`}
                            className="platform-card__btn platform-card__btn--connect"
                            onClick={() => handleConnect(p)}
                            disabled={Boolean(connecting)}
                        >
                            {connecting === p.id ? 'Opening…' : 'Connect'}
                        </button>
                    </div>
                ))}
            </div>

            <div className="onboarding-actions">
                <button className="btn btn-ghost" onClick={onBack} id="ob-connect-back">
                    ← Back
                </button>
                <button
                    id="ob-connect-next"
                    className="btn btn-primary"
                    onClick={onNext}
                >
                    Continue →
                </button>
            </div>
        </div>
    );
}

// ─── STEP 3 — Plan Selection ───────────────────────────────────────────────────
function StepPlan({ onComplete, onBack }) {
    const [catalog, setCatalog] = useState(null);
    const [catalogError, setCatalogError] = useState('');
    const [reloadKey, setReloadKey] = useState(0);
    const [annual, setAnnual] = useState(false);
    const [loading, setLoading] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        fetchPlanCatalog()
            .then((data) => {
                if (!cancelled) {
                    setCatalog(data);
                    setCatalogError('');
                }
            })
            .catch((err) => {
                if (!cancelled) setCatalogError(err.message || 'Could not load plans.');
            });
        return () => {
            cancelled = true;
        };
    }, [reloadKey]);

    const discount = catalog?.annualDiscountPercent || 0;
    const supportEmail = catalog?.supportEmail || BILLING_EMAIL;
    const plans = (catalog?.plans || []).filter((plan) => !plan.contactOnly);

    const getPrice = (plan) => {
        if (plan.monthlyPriceZar === 0) return 'Free';
        return formatZar(annual ? plan.annualMonthlyPriceZar : plan.monthlyPriceZar);
    };

    const getPeriod = (plan) => {
        if (plan.monthlyPriceZar === 0) return '';
        return annual ? '/mo · billed annually' : '/mo';
    };

    const handleSelect = async (plan) => {
        setLoading(plan.id);
        setError('');
        try {
            if (!plan.purchasable) {
                await onComplete('starter');
                return;
            }
            // Finish onboarding first so someone who leaves checkout lands in the app, not back here.
            // The plan itself only changes once the payment clears.
            await apiClient('/auth/onboarding', { method: 'POST', body: { complete: true, plan: 'starter' } });
            const data = await apiClient('/billing/create-checkout', {
                method: 'POST',
                body: { planName: plan.id, interval: annual ? 'yearly' : 'monthly' },
            });
            if (!data?.url) throw new Error('Checkout could not be started. Try again.');
            window.location.assign(data.url);
        } catch (err) {
            setError(
                plan.purchasable
                    ? `${err.message || 'Checkout could not be started.'} You can start on the free plan and upgrade later from Billing.`
                    : err.message || 'Could not finish setup. Try again.'
            );
            setLoading(null);
        }
    };

    return (
        <div className="onboarding-card animate-fade-in">
            <div className="onboarding-card__header">
                <h2>Choose your plan</h2>
                <p>Start free anytime. Upgrade when you're ready to grow.</p>
            </div>

            {discount > 0 && (
                <div className="billing-toggle">
                    <span className={`billing-toggle__label ${!annual ? 'active' : ''}`}>Monthly</span>
                    <label className="toggle-switch" htmlFor="ob-annual-toggle">
                        <input
                            id="ob-annual-toggle"
                            type="checkbox"
                            checked={annual}
                            onChange={(e) => setAnnual(e.target.checked)}
                        />
                        <div className="toggle-switch__track" />
                        <div className="toggle-switch__thumb" />
                    </label>
                    <span className={`billing-toggle__label ${annual ? 'active' : ''}`}>
                        Annual
                    </span>
                    <span className="discount-badge">Save {discount}%</span>
                </div>
            )}

            {error && <div className="error-banner" role="alert" style={{ marginBottom: 20 }}>{error}</div>}

            {!catalog ? (
                <div className="onboarding-plans-status">
                    {catalogError ? (
                        <>
                            <span>{catalogError}</span>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                    setCatalogError('');
                                    setReloadKey((k) => k + 1);
                                }}
                            >
                                Retry
                            </button>
                            <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => handleSelect({ id: 'starter', purchasable: false })}
                                disabled={Boolean(loading)}
                            >
                                Start free
                            </button>
                        </>
                    ) : (
                        <span>Loading plans…</span>
                    )}
                </div>
            ) : (
                <div className="plans-grid stagger-children">
                    {plans.map((plan) => (
                        <div
                            key={plan.id}
                            className={`plan-card ${plan.popular ? 'popular' : ''}`}
                        >
                            {plan.popular && (
                                <div className="plan-card__popular-badge">⭐ Most Popular</div>
                            )}
                            <div className="plan-card__name">{plan.name}</div>
                            <div className="plan-card__price">
                                {getPrice(plan)}
                                <span>{getPeriod(plan)}</span>
                            </div>
                            <div className="plan-card__desc">{plan.description}</div>
                            <ul className="plan-card__features">
                                {plan.features.map((f) => (
                                    <li key={f}>{f}</li>
                                ))}
                            </ul>
                            <button
                                id={`ob-plan-${plan.id}`}
                                className={`plan-card__btn ${plan.purchasable ? 'plan-card__btn--paid' : 'plan-card__btn--free'}`}
                                onClick={() => handleSelect(plan)}
                                disabled={Boolean(loading)}
                            >
                                {loading === plan.id
                                    ? plan.purchasable ? 'Opening checkout…' : 'Finishing…'
                                    : plan.purchasable ? 'Subscribe' : 'Start free'}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {catalog && (
                <p className="onboarding-note">
                    Need more than Agency?{' '}
                    <a href={`mailto:${supportEmail}?subject=${encodeURIComponent('Enterprise plan enquiry')}`}>Email {supportEmail}</a>
                    {' '}about Enterprise.
                </p>
            )}

            <div className="onboarding-actions">
                <button className="btn btn-ghost" onClick={onBack} id="ob-plan-back">
                    ← Back
                </button>
            </div>
        </div>
    );
}

// ─── Welcome Modal ─────────────────────────────────────────────────────────────
function WelcomeModal({ name, onClose }) {
    return (
        <div className="welcome-modal-overlay">
            <div className="welcome-modal animate-fade-in">
                <div className="welcome-modal__emoji">🎉</div>
                <h2>Welcome to KenganSocial, {name?.split(' ')[0] || 'Creator'}!</h2>
                <p>
                    Your workspace is live. Here's how to hit the ground running in
                    the next 5 minutes.
                </p>
                <ul className="welcome-modal__checklist">
                    <li>Connect at least one social account</li>
                    <li>Schedule your first post using the Content Studio</li>
                    <li>Explore AI tools to generate captions &amp; scripts</li>
                    <li>Set up your brand kit in <Link to="/dashboard/marketing?tab=brand">Marketing → Brand</Link></li>
                </ul>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                    By using KenganSocial you agree to our{' '}
                    <Link
                        to="/terms"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--brand)', textDecoration: 'underline' }}
                    >
                        view full documents
                    </Link>
                    .
                </p>
                <button
                    id="ob-welcome-close"
                    className="btn btn-primary btn-lg"
                    style={{ width: '100%' }}
                    onClick={onClose}
                >
                    Take me to my Dashboard →
                </button>
            </div>
        </div>
    );
}

// ─── Main Onboarding Page ──────────────────────────────────────────────────────
export default function OnboardingPage() {
    const { refreshProfile } = useAuth();
    const { fetchWorkspaces } = useWorkspace();
    const navigate = useNavigate();
    const [step, setStep] = useState(0);
    const [userData, setUserData] = useState({});
    const [showWelcome, setShowWelcome] = useState(false);

    const handleStep1Complete = (data) => {
        setUserData((prev) => ({ ...prev, ...data }));
        setStep(1);
    };

    const handleStep2Next = () => setStep(2);
    const handleStep2Back = () => setStep(0);
    const handleStep3Back = () => setStep(1);

    const handleComplete = async (plan) => {
        // Errors surface in the plan step so the user can retry.
        await apiClient('/auth/onboarding', { method: 'POST', body: { complete: true, plan } });
        setShowWelcome(true);
    };

    const handleWelcomeClose = async () => {
        setShowWelcome(false);
        // Pick up the new name and workspace name before showing the dashboard.
        await Promise.allSettled([refreshProfile(), fetchWorkspaces()]);
        navigate('/dashboard');
    };

    return (
        <div className="onboarding-page">
            {/* Ambient background */}
            <div className="onboarding-page__bg">
                <div className="onboarding-page__orb onboarding-page__orb--1" />
                <div className="onboarding-page__orb onboarding-page__orb--2" />
            </div>

            <div className="onboarding-inner">
                {/* Logo */}
                <Link to="/" className="onboarding-logo">
                    <div className="onboarding-logo__mark">K</div>
                    <span className="onboarding-logo__text">KenganSocial</span>
                </Link>

                {/* Step progress */}
                <StepProgress current={step} />

                {/* Steps */}
                {step === 0 && <StepSetup onNext={handleStep1Complete} />}
                {step === 1 && (
                    <StepConnect onNext={handleStep2Next} onBack={handleStep2Back} />
                )}
                {step === 2 && (
                    <StepPlan onComplete={handleComplete} onBack={handleStep3Back} />
                )}
            </div>

            {/* Welcome modal */}
            {showWelcome && (
                <WelcomeModal name={userData.fullName} onClose={handleWelcomeClose} />
            )}
        </div>
    );
}
