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
            // Sign-up races: the auth listener can create the profile from the email prefix
            // before the name from the sign-up form arrives. Take the real name, and rename the
            // still-default workspace to match.
            const existing: any = userDoc.data();
            const prefix = decoded.email?.split('@')[0];
            const name = typeof displayName === 'string' ? displayName.trim().slice(0, 100) : '';
            if (name && existing.displayName === prefix && name !== prefix) {
                const now = new Date().toISOString();
                await userDoc.ref.update({ displayName: name, updatedAt: now });
                const owned = await db.collection('workspaces').where('ownerId', '==', decoded.uid).limit(1).get();
                const ws = owned.docs[0];
                if (ws && ws.data().name === `${prefix}'s Workspace`) await ws.ref.update({ name: `${name}'s Workspace`, updatedAt: now });
                existing.displayName = name;
            }
            return res.status(200).json({ user: { uid: decoded.uid, ...existing } });
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

// ─── POST /api/auth/onboarding ───────────────────────────────────────────────
// Saves onboarding answers server-side (the browser never writes profiles directly).
// Step 1: { fullName, niche, workspaceName, popiaConsent, marketingConsent }
// Finish: { complete: true, plan }
router.post('/onboarding', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'MISSING_TOKEN' });
        const decoded = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
        const body = req.body || {};
        const now = new Date().toISOString();
        const userRef = db.collection('users').doc(decoded.uid);
        const updates: Record<string, unknown> = { updatedAt: now };

        if (body.complete) {
            updates.onboardingComplete = true;
            updates.onboardingCompletedAt = now;
            if (['starter', 'nano', 'creator', 'agency'].includes(body.plan)) updates.selectedPlan = body.plan;
        } else {
            const fullName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 100) : '';
            const workspaceName = typeof body.workspaceName === 'string' ? body.workspaceName.trim() : '';
            if (!fullName) return res.status(400).json({ error: 'Add your name.' });
            if (workspaceName.length < 3 || workspaceName.length > 50) return res.status(400).json({ error: 'Workspace names are 3–50 characters.' });
            if (body.popiaConsent !== true) return res.status(400).json({ error: 'Consent to the privacy policy is required to continue.' });

            const consents = { popia: true, marketing: body.marketingConsent === true, timestamp: now, version: '1.0' };
            Object.assign(updates, { displayName: fullName, fullName, niche: String(body.niche || '').slice(0, 60), consents });
            // POPIA audit trail, recorded by the server with the request IP.
            await userRef.collection('consents').doc('initial').set(
                { popiaConsent: true, marketingConsent: consents.marketing, acceptedAt: now, version: '1.0', ip: req.ip || null, userAgent: String(req.headers['user-agent'] || '').slice(0, 300) },
                { merge: true }
            );
            const owned = await db.collection('workspaces').where('ownerId', '==', decoded.uid).limit(1).get();
            if (!owned.empty) await owned.docs[0].ref.update({ name: workspaceName, niche: updates.niche, updatedAt: now });
        }

        await userRef.set(updates, { merge: true });
        const user = await userRef.get();
        return res.status(200).json({ user: { uid: decoded.uid, ...user.data() } });
    } catch (err: any) {
        console.error('Onboarding save error:', err.message);
        return res.status(500).json({ error: 'Could not save your details. Try again.' });
    }
});

export default router;
