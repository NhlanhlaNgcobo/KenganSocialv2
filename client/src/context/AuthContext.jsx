import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    sendPasswordResetEmail,
    signOut,
    updateProfile,
} from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from '../lib/firebase';
import { apiClient } from '../lib/api';
import { PRIVACY, TERMS } from '../content/legal';

const AuthContext = createContext(null);

/** True when a signed-in user hasn't accepted the current Terms and Privacy Policy (first sign-in or after an update). */
function requiresConsent(profile) {
    if (!profile) return false;
    return profile.legal?.termsVersion !== TERMS.effectiveDate || profile.legal?.privacyVersion !== PRIVACY.effectiveDate;
}

/**
 * True when a signed-in user still has to finish onboarding. New profiles are created with
 * onboardingComplete: false; profiles that saved the onboarding consents (step 1) count as done
 * even if the best-effort "finish" call failed, and so do older profiles that finished before the
 * flag existed.
 */
function requiresOnboarding(profile) {
    if (!profile) return false;
    return profile.onboardingComplete !== true && !profile.consents;
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [workspace, setWorkspace] = useState(null);
    const [plan, setPlan] = useState('starter');
    // Without Firebase there is no session to wait for.
    const [loading, setLoading] = useState(Boolean(isFirebaseConfigured && auth));

    /** Applies a session payload from /auth/me or POST /auth/profile (both return the same shape). */
    const applySession = useCallback((data) => {
        setProfile(data?.user || null);
        setWorkspace(data?.workspace || null);
        setPlan(data?.plan || 'starter');
    }, []);

    const clearSession = useCallback(() => {
        setProfile(null);
        setWorkspace(null);
        setPlan('starter');
    }, []);

    /** Re-reads the profile and workspace after they change (onboarding, settings, photo). */
    const refreshProfile = useCallback(async () => {
        const data = await apiClient('/auth/me');
        applySession(data);
        return data;
    }, [applySession]);

    /** Creates the profile on first sign-in (or returns the existing one) and applies it. */
    const ensureProfile = useCallback(async (body) => {
        const data = await apiClient('/auth/profile', { method: 'POST', body: JSON.stringify(body) });
        applySession(data);
        return data;
    }, [applySession]);

    useEffect(() => {
        if (!isFirebaseConfigured || !auth) return;

        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            setUser(firebaseUser);

            if (!firebaseUser) {
                clearSession();
                setLoading(false);
                return;
            }

            // Hold route guards until the profile is known, so they never decide on a stale one.
            setLoading(true);
            try {
                await refreshProfile();
            } catch {
                try {
                    await ensureProfile({
                        displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0],
                        photoURL: firebaseUser.photoURL,
                    });
                } catch (createErr) {
                    console.error('Failed to load or create profile:', createErr);
                    clearSession();
                }
            }

            setLoading(false);
        });

        return () => unsubscribe();
    }, [clearSession, ensureProfile, refreshProfile]);

    const login = async (email, password) => {
        if (!auth) throw new Error('Firebase is not configured');
        const result = await signInWithEmailAndPassword(auth, email, password);
        return result.user;
    };

    const register = async (email, password, displayName) => {
        if (!auth) throw new Error('Firebase is not configured');
        const result = await createUserWithEmailAndPassword(auth, email, password);

        if (displayName) {
            await updateProfile(result.user, { displayName });
        }

        // The auth listener may have created the profile from the email prefix already; this
        // call passes the real name, and the server answers with the full session either way.
        try {
            await ensureProfile({ displayName });
        } catch (profileErr) {
            console.error('Failed to save the profile name:', profileErr);
        }

        return result.user;
    };

    /** Signs in with Google and returns { user, needsOnboarding } so callers can route. */
    const loginWithGoogle = async () => {
        if (!auth || !googleProvider) throw new Error('Firebase is not configured');
        const result = await signInWithPopup(auth, googleProvider);

        let data = null;
        try {
            data = await ensureProfile({
                displayName: result.user.displayName,
                photoURL: result.user.photoURL,
            });
        } catch {
            data = await refreshProfile().catch(() => null);
        }

        return { user: result.user, needsOnboarding: requiresOnboarding(data?.user) };
    };

    /**
     * Records acceptance of the current Terms and Privacy Policy, then reloads the session.
     * source: 'signup' | 'first_login' | 'update' (kept in the consent record).
     */
    const acceptLegal = async ({ marketing = false, source = 'first_login' } = {}) => {
        await apiClient('/auth/consent', {
            method: 'POST',
            body: { termsVersion: TERMS.effectiveDate, privacyVersion: PRIVACY.effectiveDate, acceptTerms: true, confirmAge: true, marketing, source },
        });
        return refreshProfile();
    };

    /** Emails a password reset link. Firebase does not reveal whether the account exists. */
    const resetPassword = async (email) => {
        if (!auth) throw new Error('Firebase is not configured');
        await sendPasswordResetEmail(auth, email);
    };

    const logout = async () => {
        if (auth) {
            await signOut(auth);
        }
        setUser(null);
        clearSession();
    };

    const value = {
        user,
        profile,
        refreshProfile,
        workspace,
        plan,
        loading,
        needsOnboarding: requiresOnboarding(profile),
        needsConsent: requiresConsent(profile),
        acceptLegal,
        isFirebaseConfigured,
        login,
        register,
        loginWithGoogle,
        resetPassword,
        logout,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its provider
export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
