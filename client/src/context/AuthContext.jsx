import { createContext, useContext, useEffect, useState } from 'react';
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signOut,
    updateProfile,
} from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from '../lib/firebase';
import { apiClient } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [workspace, setWorkspace] = useState(null);
    const [plan, setPlan] = useState('starter');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isFirebaseConfigured || !auth) {
            setLoading(false);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            setUser(firebaseUser);

            if (!firebaseUser) {
                setProfile(null);
                setWorkspace(null);
                setPlan('starter');
                setLoading(false);
                return;
            }

            try {
                const data = await apiClient('/auth/me');
                setProfile(data.user);
                setWorkspace(data.workspace || null);
                setPlan(data.plan || data.user?.plan || 'starter');
            } catch (_profileErr) {
                try {
                    const data = await apiClient('/auth/profile', {
                        method: 'POST',
                        body: JSON.stringify({
                            displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0],
                            photoURL: firebaseUser.photoURL,
                        }),
                    });
                    setProfile(data.user);
                    setWorkspace(data.workspace || null);
                    setPlan(data.workspace?.plan || data.user?.plan || 'starter');
                } catch (createErr) {
                    console.error('Failed to auto-create profile:', createErr);
                    setProfile(null);
                    setWorkspace(null);
                    setPlan('starter');
                }
            }

            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

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

        let data;
        try {
            data = await apiClient('/auth/profile', {
                method: 'POST',
                body: JSON.stringify({ displayName }),
            });
        } catch (_profileErr) {
            data = await apiClient('/auth/profile', {
                method: 'PUT',
                body: JSON.stringify({ displayName }),
            });
        }

        if (data?.user) {
            setProfile(data.user);
            setWorkspace(data.workspace || null);
            setPlan(data.workspace?.plan || data.user?.plan || 'starter');
        }

        return result.user;
    };

    const loginWithGoogle = async () => {
        if (!auth || !googleProvider) throw new Error('Firebase is not configured');
        const result = await signInWithPopup(auth, googleProvider);

        try {
            const data = await apiClient('/auth/profile', {
                method: 'POST',
                body: JSON.stringify({
                    displayName: result.user.displayName,
                    photoURL: result.user.photoURL,
                }),
            });
            setProfile(data.user);
            setWorkspace(data.workspace || null);
            setPlan(data.workspace?.plan || data.user?.plan || 'starter');
        } catch {
            const data = await apiClient('/auth/me');
            setProfile(data.user);
            setWorkspace(data.workspace || null);
            setPlan(data.plan || data.user?.plan || 'starter');
        }

        return result.user;
    };

    const logout = async () => {
        if (auth) {
            await signOut(auth);
        }
        setUser(null);
        setProfile(null);
        setWorkspace(null);
        setPlan('starter');
    };

    /** Re-reads the profile and workspace after they change (e.g. at the end of onboarding). */
    const refreshProfile = async () => {
        const data = await apiClient('/auth/me');
        setProfile(data.user);
        setWorkspace(data.workspace || null);
        setPlan(data.plan || data.user?.plan || 'starter');
        return data;
    };

    const value = {
        user,
        profile,
        refreshProfile,
        workspace,
        plan,
        loading,
        isFirebaseConfigured,
        login,
        register,
        loginWithGoogle,
        logout,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
