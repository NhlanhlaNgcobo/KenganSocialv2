import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    ReactNode
} from 'react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged, signOut as firebaseSignOut, User } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { PLAN_LIMITS } from '../utils/planLimits';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Plan = 'starter' | 'nano' | 'creator' | 'agency';

export interface Workspace {
    id: string;
    name: string;
    ownerId: string;
    plan: Plan;
    members: string[];
    onboardingComplete: boolean;
    createdAt: string;
}

export interface AuthContextValue {
    user: User | null;
    workspace: Workspace | null;
    plan: Plan | null;
    planLimits: typeof PLAN_LIMITS[Plan] | null;
    usage: Record<string, number> | null;
    loading: boolean;
    signOut: () => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({
    user: null,
    workspace: null,
    plan: null,
    planLimits: null,
    usage: null,
    loading: true,
    signOut: async () => { }
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [workspace, setWorkspace] = useState<Workspace | null>(null);
    const [plan, setPlan] = useState<Plan | null>(null);
    const [planLimits, setPlanLimits] = useState<typeof PLAN_LIMITS[Plan] | null>(null);
    const [usage, setUsage] = useState<Record<string, number> | null>(null);
    const [loading, setLoading] = useState(true);

    const navigate = useNavigate();

    // Fetch workspace, plan and usage stats from the backend /api/auth/me
    async function fetchUserProfile(firebaseUser: User) {
        try {
            const idToken = await firebaseUser.getIdToken();

            const res = await fetch('/api/auth/me', {
                headers: { Authorization: `Bearer ${idToken}` }
            });

            if (!res.ok) throw new Error('Failed to fetch user profile');

            const data = await res.json();

            setWorkspace(data.workspace ?? null);
            setPlan(data.plan ?? null);
            setPlanLimits(data.planLimits ?? null);
            setUsage(data.usage ?? null);

            // Redirect to onboarding if workspace doesn't exist or onboarding is incomplete
            if (!data.workspace || !data.workspace.onboardingComplete) {
                navigate('/onboarding');
            }
        } catch (err) {
            console.error('Failed to load user profile:', err);
            setWorkspace(null);
            setPlan(null);
            setPlanLimits(null);
            setUsage(null);
        }
    }

    // Firebase auth state listener
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth!, async (firebaseUser) => {
            setUser(firebaseUser);

            if (firebaseUser) {
                await fetchUserProfile(firebaseUser);
            } else {
                // Clear all state on sign-out
                setWorkspace(null);
                setPlan(null);
                setPlanLimits(null);
                setUsage(null);
            }

            setLoading(false);
        });

        return () => unsubscribe();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sign-out handler
    async function signOut() {
        await firebaseSignOut(auth!);
        setUser(null);
        setWorkspace(null);
        setPlan(null);
        setPlanLimits(null);
        setUsage(null);
        navigate('/login');
    }

    const value: AuthContextValue = {
        user,
        workspace,
        plan,
        planLimits,
        usage,
        loading,
        signOut
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
    return useContext(AuthContext);
}
