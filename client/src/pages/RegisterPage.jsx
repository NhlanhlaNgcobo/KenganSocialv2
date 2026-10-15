import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { db } from '../lib/firebase';
import { authErrorMessage } from '../lib/auth-errors';
import './Auth.css';

const MIN_PASSWORD_LENGTH = 8;

export default function RegisterPage() {
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [marketingConsent, setMarketingConsent] = useState(false);
    const { register, loginWithGoogle } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (password.length < MIN_PASSWORD_LENGTH) {
            return setError(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
        }

        if (password !== confirmPassword) {
            return setError('The passwords do not match.');
        }

        if (!termsAccepted) {
            return setError('Accept the terms and privacy policy to continue.');
        }

        setLoading(true);
        try {
            const user = await register(email, password, displayName);

            // Save consents to Firestore subcollection (may fail if client rules are strict)
            try {
                await setDoc(doc(db, 'users', user.uid, 'consents', 'initial'), {
                    termsAccepted: true,
                    privacyAccepted: true,
                    ageConfirmed: true,
                    marketingConsent: marketingConsent,
                    acceptedAt: serverTimestamp(),
                    termsVersion: '1.0',
                    ipAddress: null // optionally capture server-side
                });
            } catch (err) {
                console.warn('Failed to save granular consents (Firestore rules):', err);
            }

            navigate('/onboarding');
        } catch (err) {
            setError(authErrorMessage(err, 'Could not create your account. Try again.'));
        } finally {
            setLoading(false);
        }
    };

    const handleGoogle = async () => {
        setError('');
        setLoading(true);
        try {
            const { needsOnboarding } = await loginWithGoogle();
            navigate(needsOnboarding ? '/onboarding' : '/dashboard');
        } catch (err) {
            setError(authErrorMessage(err, 'Google sign-in failed. Try again.'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-page__bg">
                <div className="auth-page__orb auth-page__orb--1" />
                <div className="auth-page__orb auth-page__orb--2" />
            </div>

            <div className="auth-card animate-fade-in">
                <div className="auth-card__header">
                    <div className="auth-card__logo">K</div>
                    <h1>Create account</h1>
                    <p>Start managing your social media like a pro</p>
                </div>

                {error && <div className="auth-card__error" role="alert">{error}</div>}

                <form className="auth-card__form" onSubmit={handleSubmit}>
                    <div className="input-group">
                        <label htmlFor="displayName">Full Name</label>
                        <input
                            id="displayName"
                            type="text"
                            className="input"
                            placeholder="John Doe"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            required
                        />
                    </div>

                    <div className="input-group">
                        <label htmlFor="email">Email</label>
                        <input
                            id="email"
                            type="email"
                            className="input"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    <div className="input-group">
                        <label htmlFor="password">Password</label>
                        <input
                            id="password"
                            type="password"
                            className="input"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="new-password"
                            aria-describedby="password-hint"
                            required
                        />
                        <small id="password-hint" className="auth-card__hint">At least {MIN_PASSWORD_LENGTH} characters.</small>
                    </div>

                    <div className="input-group">
                        <label htmlFor="confirmPassword">Confirm Password</label>
                        <input
                            id="confirmPassword"
                            type="password"
                            className="input"
                            placeholder="••••••••"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            autoComplete="new-password"
                            required
                        />
                    </div>

                    <div className="auth-consents">
                        <label className="checkbox-field">
                            <input
                                type="checkbox"
                                checked={termsAccepted}
                                onChange={(e) => setTermsAccepted(e.target.checked)}
                            />
                            <span>
                                I agree to the <Link to="/legal" onClick={e => e.stopPropagation()}>Terms of Service</Link>,{' '}
                                <Link to="/privacy" onClick={e => e.stopPropagation()}>Privacy Policy</Link>, and confirm I am 18+ years old.
                            </span>
                        </label>

                        <label className="checkbox-field">
                            <input
                                type="checkbox"
                                checked={marketingConsent}
                                onChange={(e) => setMarketingConsent(e.target.checked)}
                            />
                            <span>I'd like to receive product updates and tips via email.</span>
                        </label>
                    </div>

                    <button className="btn btn-primary btn-lg" type="submit" disabled={loading}>
                        {loading ? 'Creating account...' : 'Create Account'}
                    </button>
                </form>

                <div className="auth-card__divider">
                    <span>or</span>
                </div>

                <button
                    className="btn btn-secondary btn-lg auth-card__google"
                    onClick={handleGoogle}
                    disabled={loading}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Continue with Google
                </button>

                <p className="auth-card__footer">
                    Already have an account? <Link to="/login">Sign in</Link>
                </p>
            </div>
        </div>
    );
}
