import express from 'express';
import type { Request, Response } from 'express';
import admin from 'firebase-admin';
import { db } from '../utils/firestore';
import { redis } from '../utils/redis';
import { PLAN_LIMITS } from '../utils/planLimits';
import { getMonth } from '../utils/dateUtils';
import { applyDevPlanOverride } from '../utils/devPlan';

const router = express.Router();

// ─── Helper: fetch usage stats from Redis for the current month ─────────────
async function getUsageStats(workspaceId: string, plan: keyof typeof PLAN_LIMITS) {
    if (!redis || redis.status !== 'ready') {
        return Object.fromEntries(
            Object.keys(PLAN_LIMITS[plan]).map((feature) => [feature, 0])
        ) as Record<string, number>;
    }

    const month = getMonth();
    const features = Object.keys(PLAN_LIMITS[plan]) as Array<keyof typeof PLAN_LIMITS.starter>;
    const stats: Record<string, number> = {};

    for (const feature of features) {
        // Agency usage tracked under a different key prefix
        const prefix = plan === 'agency' ? 'agency_usage' : 'usage';
        const key = `${prefix}:${workspaceId}:${feature}:${month}`;
        const val = await redis.get(key).catch(() => null);
        stats[feature] = val ? parseFloat(val) : 0;
    }

    return stats;
}

// ─── POST /api/auth/verify ───────────────────────────────────────────────────
// Verify Firebase JWT and return { user, workspace, plan }
router.post('/verify', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'MISSING_TOKEN', message: 'Authorization header is required.' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);

        // Fetch user document from Firestore
        const userDoc = await db.collection('users').doc(decoded.uid).get();
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User profile not found.' });
        }

        const user = { uid: decoded.uid, ...userDoc.data() };

        // Fetch associated workspace
        const workspaceSnap = await db
            .collection('workspaces')
            .where('ownerId', '==', decoded.uid)
            .limit(1)
            .get();

        if (workspaceSnap.empty) {
            return res.status(200).json({ user, workspace: null, plan: null });
        }

        const workspaceDoc = workspaceSnap.docs[0];
        const workspace = { id: workspaceDoc.id, ...workspaceDoc.data() };
        const plan = applyDevPlanOverride((workspace as any).plan ?? 'starter');

        return res.status(200).json({ user, workspace, plan });
    } catch (err: any) {
        console.error('Auth verify error:', err);
        if (err.code === 'auth/id-token-expired') {
            return res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'Firebase token has expired.' });
        }
        return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Could not verify Firebase token.' });
    }
});

// ─── POST /api/auth/workspace/create ────────────────────────────────────────
// Create a new workspace for the authenticated user, default plan: 'starter'
router.post('/workspace/create', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'MISSING_TOKEN' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);

        const { name } = req.body;
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'INVALID_NAME', message: 'Workspace name is required.' });
        }

        // Check if workspace already exists for this user
        const existing = await db
            .collection('workspaces')
            .where('ownerId', '==', decoded.uid)
            .limit(1)
            .get();

        if (!existing.empty) {
            return res.status(409).json({ error: 'WORKSPACE_EXISTS', message: 'User already has a workspace.' });
        }

        // Create the workspace document
        const workspaceRef = db.collection('workspaces').doc();
        const now = new Date().toISOString();

        await workspaceRef.set({
            name: name.trim(),
            ownerId: decoded.uid,
            members: [decoded.uid],
            plan: 'starter',
            createdAt: now,
            updatedAt: now,
            onboardingComplete: false
        });

        // Mark onboarding as pending on the user doc
        await db.collection('users').doc(decoded.uid).set(
            { workspaceId: workspaceRef.id, updatedAt: now },
            { merge: true }
        );

        const workspace = {
            id: workspaceRef.id,
            name: name.trim(),
            ownerId: decoded.uid,
            plan: 'starter',
            createdAt: now
        };

        return res.status(201).json({ workspace, plan: 'starter' });
    } catch (err) {
        console.error('Workspace create error:', err);
        return res.status(500).json({ error: 'SERVER_ERROR', message: 'Failed to create workspace.' });
    }
});

// ─── POST /api/auth/profile ──────────────────────────────────────────────────
// Create/Auto-create user profile and default workspace
router.post('/profile', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'MISSING_TOKEN' });
        }
        const idToken = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        const { displayName, photoURL } = req.body;

        const userDoc = await db.collection('users').doc(decoded.uid).get();
        if (userDoc.exists) {
            return res.status(200).json({ user: { uid: decoded.uid, ...userDoc.data() } });
        }

        const now = new Date().toISOString();
        const userData = {
            uid: decoded.uid,
            email: decoded.email,
            displayName: displayName || decoded.email?.split('@')[0],
            photoURL: photoURL || null,
            plan: 'starter',
            createdAt: now,
            updatedAt: now,
        };

        await db.collection('users').doc(decoded.uid).set(userData);

        // Create default workspace
        const workspaceRef = db.collection('workspaces').doc();
        const workspaceData = {
            id: workspaceRef.id,
            name: `${userData.displayName}'s Workspace`,
            ownerId: decoded.uid,
            members: [decoded.uid],
            plan: 'starter',
            createdAt: now,
            updatedAt: now,
            onboardingComplete: false
        };

        await workspaceRef.set(workspaceData);

        return res.status(201).json({
            user: userData,
            workspace: workspaceData
        });
    } catch (err: any) {
        console.error('Profile create error:', err);
        return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
    }
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
// Return user + workspace + plan + current month usage stats
router.get('/me', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'MISSING_TOKEN' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);

        const userDoc = await db.collection('users').doc(decoded.uid).get();
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'USER_NOT_FOUND' });
        }

        const user = { uid: decoded.uid, ...userDoc.data() };

        const workspaceSnap = await db
            .collection('workspaces')
            .where('ownerId', '==', decoded.uid)
            .limit(1)
            .get();

        if (workspaceSnap.empty) {
            return res.status(200).json({ user, workspace: null, plan: null, usage: null, planLimits: null });
        }

        const workspaceDoc = workspaceSnap.docs[0];
        const workspace = { id: workspaceDoc.id, ...workspaceDoc.data() };
        const plan = applyDevPlanOverride((workspace as any).plan ?? 'starter') as keyof typeof PLAN_LIMITS;

        let usage: Record<string, number>;
        try {
            usage = await getUsageStats(workspaceDoc.id, plan);
        } catch (usageErr) {
            console.warn('Auth /me usage lookup unavailable, defaulting to zero usage.');
            usage = Object.fromEntries(
                Object.keys(PLAN_LIMITS[plan]).map((feature) => [feature, 0])
            ) as Record<string, number>;
        }

        return res.status(200).json({
            user,
            workspace,
            plan,
            usage,
            planLimits: PLAN_LIMITS[plan]
        });
    } catch (err: any) {
        console.error('Auth /me error:', err);
        if (err?.code === 'auth/id-token-expired' || err?.code === 'auth/argument-error') {
            return res.status(401).json({ error: 'INVALID_TOKEN' });
        }
        return res.status(500).json({ error: 'AUTH_PROFILE_UNAVAILABLE' });
    }
});

// ─── PUT /api/auth/profile ───────────────────────────────────────────────────
router.put('/profile', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'MISSING_TOKEN' });
        }
        const idToken = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        const { displayName, photoURL, bio } = req.body;

        const updates: any = { updatedAt: new Date().toISOString() };
        if (displayName !== undefined) updates.displayName = String(displayName).slice(0, 100);
        if (photoURL !== undefined) {
            // Either an https link or a small inline image (the Settings page uploads a 256px JPEG).
            const value = photoURL === null ? null : String(photoURL);
            const isHttps = value !== null && /^https:\/\//i.test(value) && value.length <= 2048;
            const isSmallImage = value !== null && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 300_000;
            if (value !== null && !isHttps && !isSmallImage) {
                return res.status(400).json({ error: 'INVALID_PHOTO', message: 'Photo must be an https URL or an image under 200KB.' });
            }
            updates.photoURL = value;
        }
        if (bio !== undefined) updates.bio = String(bio).slice(0, 1000);

        await db.collection('users').doc(decoded.uid).update(updates);
        const updated = await db.collection('users').doc(decoded.uid).get();

        return res.status(200).json({ user: { uid: decoded.uid, ...updated.data() } });
    } catch (err: any) {
        return res.status(500).json({ error: 'UPDATE_FAILED' });
    }
});

export default router;
