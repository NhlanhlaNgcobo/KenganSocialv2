import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * Signed-in routes. Waits for the profile before deciding, then:
 * - signed out → /login
 * - current Terms / Privacy Policy not accepted (first sign-in, or after they change) → /consent
 * - onboarding not finished → /onboarding (which itself stays reachable)
 * - onboarding finished and visiting /onboarding → /dashboard
 */
export default function AuthGuard({ children }) {
    const { user, profile, loading, needsOnboarding, needsConsent } = useAuth();
    const { pathname, search, state } = useLocation();
    const onOnboarding = pathname.startsWith('/onboarding');
    const onConsent = pathname.startsWith('/consent');

    if (loading) {
        return (
            <div className="auth-loading" role="status" aria-label="Loading your account">
                <div className="auth-loading__spinner" />
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (needsConsent && !onConsent) {
        return <Navigate to="/consent" replace state={{ from: `${pathname}${search}` }} />;
    }
    if (!needsConsent && onConsent) {
        // Just accepted (or already had): continue to the page they were opening.
        const from = typeof state?.from === 'string' && !state.from.startsWith('/consent') ? state.from : '/dashboard';
        return <Navigate to={needsOnboarding ? '/onboarding' : from} replace />;
    }

    if (needsOnboarding && !onOnboarding && !onConsent) {
        return <Navigate to="/onboarding" replace />;
    }

    // Only an explicit "finished" flag sends people away from onboarding, so someone part-way
    // through (consents saved, plan not yet picked) can reload the page and carry on.
    if (onOnboarding && profile?.onboardingComplete === true) {
        return <Navigate to="/dashboard" replace />;
    }

    return children;
}
