import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * Signed-in routes. Waits for the profile before deciding, then:
 * - signed out → /login
 * - onboarding not finished → /onboarding (which itself stays reachable)
 * - onboarding finished and visiting /onboarding → /dashboard
 */
export default function AuthGuard({ children }) {
    const { user, profile, loading, needsOnboarding } = useAuth();
    const { pathname } = useLocation();
    const onOnboarding = pathname.startsWith('/onboarding');

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

    if (needsOnboarding && !onOnboarding) {
        return <Navigate to="/onboarding" replace />;
    }

    // Only an explicit "finished" flag sends people away from onboarding, so someone part-way
    // through (consents saved, plan not yet picked) can reload the page and carry on.
    if (onOnboarding && profile?.onboardingComplete === true) {
        return <Navigate to="/dashboard" replace />;
    }

    return children;
}
