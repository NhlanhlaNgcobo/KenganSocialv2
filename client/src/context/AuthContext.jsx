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
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // If Firebase is not configured, just stop loading
        if (!isFirebaseConfigured || !auth) {
            setLoading(false);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            setUser(firebaseUser);

            if (firebaseUser) {
                try {
                    const data = await apiClient('/auth/profile');
                    setProfile(data.user);
                } catch (err) {
                    // Profile doesn't exist yet — auto-create it
                    try {
                        const data = await apiClient('/auth/profile', {
                            method: 'POST',
                            body: JSON.stringify({
                                displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0],
                                photoURL: firebaseUser.photoURL,
                            }),
                        });
                        setProfile(data.user);
                    } catch (createErr) {
                        console.error('Failed to auto-create profile:', createErr);
                        setProfile(null);
                    }
                }
            } else {
                setProfile(null);
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

        // Create profile on backend
        let data;
        try {
            data = await apiClient('/auth/profile', {
                method: 'POST',
                body: JSON.stringify({ displayName }),
            });
        } catch (err) {
            // Profile may already exist due to onAuthStateChanged triggering first.
            // Update the existing profile with the correct displayName.
            data = await apiClient('/auth/profile', {
                method: 'PUT',
                body: JSON.stringify({ displayName }),
            });
        }

        if (data?.user) {
            setProfile(data.user);
        }

        return result.user;
    };

    const loginWithGoogle = async () => {
        if (!auth || !googleProvider) throw new Error('Firebase is not configured');
        const result = await signInWithPopup(auth, googleProvider);

        // Try creating profile — will 409 if exists
        try {
            const data = await apiClient('/auth/profile', {
                method: 'POST',
                body: JSON.stringify({
                    displayName: result.user.displayName,
                    photoURL: result.user.photoURL,
                }),
            });
            setProfile(data.user);
        } catch {
            // Profile exists, fetch it
            const data = await apiClient('/auth/profile');
            setProfile(data.user);
        }

        return result.user;
    };

    const logout = async () => {
        if (auth) {
            await signOut(auth);
        }
        setUser(null);
        setProfile(null);
    };

    const value = {
        user,
        profile,
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
