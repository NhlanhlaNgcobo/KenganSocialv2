import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
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
        id: 'linkedin',
        name: 'LinkedIn',
        emoji: '💼',
        bg: '#0A66C2',
        desc: 'Professional posts & articles',
    },
    {
        id: 'pinterest',
        name: 'Pinterest',
        emoji: '📌',
        bg: '#E60023',
        desc: 'Pins, boards & idea content',
    },
    {
        id: 'threads',
        name: 'Threads',
        emoji: '🧵',
        bg: '#000000',
        desc: 'Text posts & conversations',
    },
];

const PLANS = [
    {
        id: 'starter',
        name: 'Starter',
        monthlyPrice: 0,
        desc: 'Try KenganSocial free — no card needed.',
        features: ['10 posts/mo', '3 exports', '2 connections', '0.5 GB storage'],
        popular: false,
        cta: 'Start Free',
        type: 'free',
    },
    {
        id: 'nano',
        name: 'Nano Creator',
        monthlyPrice: 149,
        desc: 'Perfect for growing individual creators.',
        features: ['30 posts/mo', '10 exports', '3 connections', '5 hrs transcription', '2 GB storage'],
        popular: false,
        cta: 'Subscribe',
        type: 'paid',
    },
    {
        id: 'creator',
        name: 'Creator Pro',
        monthlyPrice: 349,
        desc: 'Everything you need to go full-time.',
        features: ['100 posts/mo', '30 exports', '5 connections', '20 hrs transcription', '1,000 AI calls', '10 GB storage'],
        popular: true,
        cta: 'Subscribe',
        type: 'paid',
    },
    {
        id: 'agency',
        name: 'Agency',
        monthlyPrice: 2499,
        desc: 'Unlimited everything for teams & agencies.',
        features: ['Unlimited posts', 'Unlimited AI calls', 'Unlimited connections', '50 GB storage', 'Priority support'],
        popular: false,
        cta: 'Subscribe',
        type: 'paid',
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
            // Update main profile with basic info and consents
            await setDoc(
                doc(db, 'users', user.uid),
                {
                    fullName: fullName.trim(),
                    niche: industry,
                    consents: {
                        popia: popiaConsent,
                        marketing: marketingConsent,
                        timestamp: new Date().toISOString()
                    }
                },
                { merge: true }
            );

            // Also keep subcollection for audit trail
            await setDoc(
                doc(db, 'users', user.uid, 'consents', 'initial'),
                {
                    popiaConsent,
                    marketingConsent,
                    timestamp: serverTimestamp(),
                    acceptedAt: serverTimestamp(),
                    version: '1.0'
                },
                { merge: true }
            );

            onNext({ fullName: fullName.trim(), workspaceName: workspaceName.trim(), industry });
        } catch (err) {
            setError('Failed to save. Please try again.');
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
    const [connected, setConnected] = useState({});

    const handleConnect = (platformId) => {
        // Redirect to OAuth flow
        window.location.href = `/api/connections/${platformId}/auth`;
    };

    return (
        <div className="onboarding-card animate-fade-in">
            <div className="onboarding-card__header">
                <h2>Connect your accounts</h2>
                <p>Link your social platforms to start scheduling and publishing. You can add more later in Settings.</p>
            </div>

            <div className="platforms-grid stagger-children">
                {PLATFORMS.map((p) => (
                    <div
                        key={p.id}
                        className={`platform-card ${connected[p.id] ? 'connected' : ''}`}
                    >
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
                        {connected[p.id] ? (
                            <span className="platform-card__btn platform-card__btn--connected">✓ Connected</span>
                        ) : (
                            <button
                                id={`ob-connect-${p.id}`}
                                className="platform-card__btn platform-card__btn--connect"
                                onClick={() => handleConnect(p.id)}
                            >
                                Connect
                            </button>
                        )}
                    </div>
                ))}
            </div>

            <div className="onboarding-actions">
                <button className="btn btn-ghost" onClick={onBack} id="ob-connect-back">
                    ← Back
                </button>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <button className="btn btn-ghost" onClick={onNext} id="ob-connect-skip">
                        Skip for now
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
        </div>
    );
}

// ─── STEP 3 — Plan Selection ───────────────────────────────────────────────────
function StepPlan({ onComplete, onBack }) {
    const { user } = useAuth();
    const API_ROOT = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api$/, '');
    const [annual, setAnnual] = useState(false);
    const [loading, setLoading] = useState(null);

    const getPrice = (plan) => {
        if (plan.monthlyPrice === 0) return 'Free';
        const price = annual
            ? Math.floor(plan.monthlyPrice * 0.8)
            : plan.monthlyPrice;
        return `R${price.toLocaleString()}`;
    };

    const getPeriod = (plan) => {
        if (plan.monthlyPrice === 0) return '';
        return annual ? '/mo · billed annually' : '/mo';
    };

    const handleSelect = async (plan) => {
        setLoading(plan.id);
        try {
            if (plan.type === 'free') {
                // Set starter plan and complete onboarding
                await onComplete('starter');
            } else {
                // Redirect to Paystack checkout
                const token = await user.getIdToken();
                const res = await fetch(`${API_ROOT}/api/billing/create-checkout`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        planName: plan.id,
                        interval: annual ? 'yearly' : 'monthly',
                    }),
                });
                const { url } = await res.json();
                if (url) window.location.href = url;
            }
        } catch (err) {
            console.error('Plan selection failed:', err);
        } finally {
            setLoading(null);
        }
    };

    return (
        <div className="onboarding-card animate-fade-in">
            <div className="onboarding-card__header">
                <h2>Choose your plan</h2>
                <p>Start free anytime. Upgrade when you're ready to grow.</p>
            </div>

            {/* Annual toggle */}
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
                {annual && <span className="discount-badge">Save 20%</span>}
            </div>

            <div className="plans-grid stagger-children">
                {PLANS.map((plan) => (
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
                        <div className="plan-card__desc">{plan.desc}</div>
                        <ul className="plan-card__features">
                            {plan.features.map((f) => (
                                <li key={f}>{f}</li>
                            ))}
                        </ul>
                        <button
                            id={`ob-plan-${plan.id}`}
                            className={`plan-card__btn ${plan.type === 'free' ? 'plan-card__btn--free' : 'plan-card__btn--paid'}`}
                            onClick={() => handleSelect(plan)}
                            disabled={loading === plan.id}
                        >
                            {loading === plan.id ? 'Loading…' : plan.cta}
                        </button>
                    </div>
                ))}
            </div>

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
                    <li>Set up your brand kit in Settings</li>
                </ul>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                    By using KenganSocial you agree to our{' '}
                    <Link
                        to="/legal"
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
    const { user } = useAuth();
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
        try {
            await setDoc(
                doc(db, 'users', user.uid),
                {
                    onboardingComplete: true,
                    niche: userData.industry || '',
                    plan,
                    onboardingCompletedAt: serverTimestamp(),
                },
                { merge: true }
            );
            setShowWelcome(true);
        } catch (err) {
            console.error('Failed to complete onboarding:', err);
        }
    };

    const handleWelcomeClose = () => {
        setShowWelcome(false);
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
