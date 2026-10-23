import express from 'express';
import type { Request, Response } from 'express';
import { getAuth as firebaseAuth } from 'firebase-admin/auth';
import { db } from '../utils/firestore';
import { redis } from '../utils/redis';
import { PLAN_LIMITS } from '../utils/planLimits';
import { getMonth } from '../utils/dateUtils';
import { applyDevPlanOverride } from '../utils/devPlan';
import { effectivePlan, newWorkspaceTrial } from '../utils/trial';
import { LEGAL_VERSIONS, hasCurrentConsent } from '../config/legal';

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

// ─── Helpers: errors and the session payload ────────────────────────────────
// Every error carries a sentence the app can show as-is (`error`) plus a stable `code`.
const AUTH_ERRORS = {
    MISSING_TOKEN: [401, 'You are signed out. Sign in again to continue.'],
    TOKEN_EXPIRED: [401, 'Your session has expired. Sign in again to continue.'],
    INVALID_TOKEN: [401, 'We could not confirm your sign-in. Sign in again to continue.'],
    USER_NOT_FOUND: [404, 'We could not find your profile. Sign out and sign in again.'],
} as const;

function sendAuthError(res: Response, code: keyof typeof AUTH_ERRORS) {
    const [status, error] = AUTH_ERRORS[code];
    return res.status(status).json({ error, code });
}

function tokenErrorCode(err: any): keyof typeof AUTH_ERRORS {
    return err?.code === 'auth/id-token-expired' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
}

/**
 * The signed-in session: user, owned workspace, effective plan (with the development plan
 * override), this month's usage and the plan limits. Shared by GET /me and POST /profile so the
 * client always receives one shape.
 */
async function buildSession(uid: string, user: Record<string, unknown>) {
    const workspaceSnap = await db
        .collection('workspaces')
        .where('ownerId', '==', uid)
        .limit(1)
        .get();

    if (workspaceSnap.empty) {
        return { user, workspace: null, plan: null, usage: null, planLimits: null };
    }

    const workspaceDoc = workspaceSnap.docs[0];
    const workspace = { ...workspaceDoc.data(), id: workspaceDoc.id };
    const plan = applyDevPlanOverride(effectivePlan(workspace)) as keyof typeof PLAN_LIMITS;

    let usage: Record<string, number>;
    try {
        usage = await getUsageStats(workspaceDoc.id, plan);
    } catch {
        console.warn('Auth session usage lookup unavailable, defaulting to zero usage.');
        usage = Object.fromEntries(
            Object.keys(PLAN_LIMITS[plan]).map((feature) => [feature, 0])
        ) as Record<string, number>;
    }

    return { user, workspace, plan, usage, planLimits: PLAN_LIMITS[plan] };
}

// ─── POST /api/auth/verify ───────────────────────────────────────────────────
// Verify Firebase JWT and return { user, workspace, plan }
router.post('/verify', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return sendAuthError(res, 'MISSING_TOKEN');
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decoded = await firebaseAuth().verifyIdToken(idToken);

        // Fetch user document from Firestore
        const userDoc = await db.collection('users').doc(decoded.uid).get();
        if (!userDoc.exists) {
            return sendAuthError(res, 'USER_NOT_FOUND');
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
        const plan = applyDevPlanOverride(effectivePlan(workspace));

        return res.status(200).json({ user, workspace, plan });
    } catch (err: any) {
        console.error('Auth verify error:', err);
        return sendAuthError(res, tokenErrorCode(err));
    }
});

// ─── POST /api/auth/workspace/create ────────────────────────────────────────
// Create a new workspace for the authenticated user, default plan: 'starter'
router.post('/workspace/create', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return sendAuthError(res, 'MISSING_TOKEN');
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decoded = await firebaseAuth().verifyIdToken(idToken);

        const { name } = req.body;
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'Give your workspace a name.', code: 'INVALID_NAME' });
        }

        // Check if workspace already exists for this user
        const existing = await db
            .collection('workspaces')
            .where('ownerId', '==', decoded.uid)
            .limit(1)
            .get();

        if (!existing.empty) {
            return res.status(409).json({ error: 'You already have a workspace.', code: 'WORKSPACE_EXISTS' });
        }

        // Create the workspace document
        const workspaceRef = db.collection('workspaces').doc();
        const now = new Date().toISOString();

        // A user's first workspace starts with the full-access trial (utils/trial.ts).
        const trial = newWorkspaceTrial();
        await workspaceRef.set({
            name: name.trim(),
            ownerId: decoded.uid,
            members: [decoded.uid],
            plan: 'starter',
            ...trial,
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
            ...trial,
            createdAt: now
        };

        return res.status(201).json({ workspace, plan: effectivePlan(workspace) });
    } catch (err) {
        console.error('Workspace create error:', err);
        return res.status(500).json({ error: 'Could not create the workspace. Try again.', code: 'SERVER_ERROR' });
    }
});

// ─── POST /api/auth/profile ──────────────────────────────────────────────────
// Create the user profile and default workspace on first sign-in. Always answers with the
// same session shape as GET /me ({ user, workspace, plan, usage, planLimits }), whether the
// profile was just created or already existed, so callers never downgrade the plan.
router.post('/profile', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return sendAuthError(res, 'MISSING_TOKEN');
        }
        const idToken = authHeader.split('Bearer ')[1];
        const decoded = await firebaseAuth().verifyIdToken(idToken);
        const { displayName, photoURL } = req.body || {};
        const userRef = db.collection('users').doc(decoded.uid);
        const prefix = decoded.email?.split('@')[0];
        const name = typeof displayName === 'string' ? displayName.trim().slice(0, 100) : '';

        let userDoc = await userRef.get();
        if (!userDoc.exists) {
            const now = new Date().toISOString();
            const userData = {
                uid: decoded.uid,
                email: decoded.email,
                displayName: name || prefix,
                photoURL: typeof photoURL === 'string' && /^https:\/\//i.test(photoURL) ? photoURL.slice(0, 2048) : null,
                plan: 'starter',
                onboardingComplete: false,
                createdAt: now,
                updatedAt: now,
            };
            const workspaceRef = db.collection('workspaces').doc();
            const workspaceData = {
                id: workspaceRef.id,
                name: `${userData.displayName}'s Workspace`,
                ownerId: decoded.uid,
                members: [decoded.uid],
                plan: 'starter',
                // New accounts start with the full-access trial (utils/trial.ts).
                ...newWorkspaceTrial(),
                createdAt: now,
                updatedAt: now,
                onboardingComplete: false
            };

            // The auth listener and the sign-in handler can both call this at once. `create`
            // fails if the profile already exists, and the batch makes the profile and its
            // workspace appear together, so only one default workspace is ever made.
            const batch = db.batch();
            batch.create(userRef, userData);
            batch.set(workspaceRef, workspaceData);
            try {
                await batch.commit();
                return res.status(201).json(await buildSession(decoded.uid, userData));
            } catch (createErr: any) {
                if (createErr?.code !== 6 /* ALREADY_EXISTS */) throw createErr;
                userDoc = await userRef.get();
            }
        }

        // Sign-up races: the auth listener can create the profile from the email prefix
        // before the name from the sign-up form arrives. Take the real name, and rename the
        // still-default workspace to match.
        const existing: any = userDoc.data();
        if (name && existing.displayName === prefix && name !== prefix) {
            const now = new Date().toISOString();
            await userRef.update({ displayName: name, updatedAt: now });
            const owned = await db.collection('workspaces').where('ownerId', '==', decoded.uid).limit(1).get();
            const ws = owned.docs[0];
            if (ws && ws.data().name === `${prefix}'s Workspace`) await ws.ref.update({ name: `${name}'s Workspace`, updatedAt: now });
            existing.displayName = name;
        }
        return res.status(200).json(await buildSession(decoded.uid, { uid: decoded.uid, ...existing }));
    } catch (err: any) {
        if (String(err?.code || '').startsWith('auth/')) return sendAuthError(res, tokenErrorCode(err));
        console.error('Profile create error:', err);
        return res.status(500).json({ error: 'Could not set up your profile. Refresh the page to try again.', code: 'SERVER_ERROR' });
    }
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
// Return user + workspace + plan + current month usage stats
router.get('/me', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return sendAuthError(res, 'MISSING_TOKEN');
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decoded = await firebaseAuth().verifyIdToken(idToken);

        const userDoc = await db.collection('users').doc(decoded.uid).get();
        if (!userDoc.exists) {
            return sendAuthError(res, 'USER_NOT_FOUND');
        }

        return res.status(200).json(await buildSession(decoded.uid, { uid: decoded.uid, ...userDoc.data() }));
    } catch (err: any) {
        console.error('Auth /me error:', err);
        if (String(err?.code || '').startsWith('auth/')) {
            return sendAuthError(res, tokenErrorCode(err));
        }
        return res.status(500).json({ error: 'We could not load your account. Refresh the page to try again.', code: 'AUTH_PROFILE_UNAVAILABLE' });
    }
});

// ─── PUT /api/auth/profile ───────────────────────────────────────────────────
router.put('/profile', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return sendAuthError(res, 'MISSING_TOKEN');
        }
        const idToken = authHeader.split('Bearer ')[1];
        const decoded = await firebaseAuth().verifyIdToken(idToken);
        const { displayName, photoURL, bio } = req.body;

        const updates: any = { updatedAt: new Date().toISOString() };
        if (displayName !== undefined) {
            const name = String(displayName).trim().slice(0, 100);
            if (!name) return res.status(400).json({ error: 'Add your name.', code: 'INVALID_NAME' });
            updates.displayName = name;
        }
        if (photoURL !== undefined) {
            // Either an https link or a small inline image (the Settings page uploads a 256px JPEG).
            const value = photoURL === null ? null : String(photoURL);
            const isHttps = value !== null && /^https:\/\//i.test(value) && value.length <= 2048;
            const isSmallImage = value !== null && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 300_000;
            if (value !== null && !isHttps && !isSmallImage) {
                return res.status(400).json({ error: 'Use a JPEG, PNG or WebP image under 200 KB, or an https link.', code: 'INVALID_PHOTO' });
            }
            updates.photoURL = value;
        }
        if (bio !== undefined) updates.bio = String(bio).slice(0, 1000);

        await db.collection('users').doc(decoded.uid).update(updates);
        const updated = await db.collection('users').doc(decoded.uid).get();

        return res.status(200).json({ user: { uid: decoded.uid, ...updated.data() } });
    } catch (err: any) {
        if (String(err?.code || '').startsWith('auth/')) return sendAuthError(res, tokenErrorCode(err));
        console.error('Profile update error:', err?.message);
        return res.status(500).json({ error: 'Could not save your profile. Try again.', code: 'UPDATE_FAILED' });
    }
});

// ─── POST /api/auth/consent ──────────────────────────────────────────────────
// Records acceptance of the current Terms of Service and Privacy Policy (POPIA audit trail).
// Body: { termsVersion, privacyVersion, acceptTerms: true, confirmAge: true, marketing?: boolean, source? }
// Each version pair gets its own record, so earlier acceptances stay in the trail.
router.post('/consent', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) return sendAuthError(res, 'MISSING_TOKEN');
        const decoded = await firebaseAuth().verifyIdToken(authHeader.split('Bearer ')[1]);
        const body = req.body || {};
        if (body.acceptTerms !== true) return res.status(400).json({ error: 'Accept the Terms of Service and Privacy Policy to continue.' });
        if (body.confirmAge !== true) return res.status(400).json({ error: 'You must be 18 or older to use KenganSocial.' });
        if (body.termsVersion !== LEGAL_VERSIONS.terms || body.privacyVersion !== LEGAL_VERSIONS.privacy) {
            // The page was loaded before the documents changed: reload to see and accept the current ones.
            return res.status(409).json({ error: 'The Terms or Privacy Policy changed while this page was open. Reload the page to see the current versions.', code: 'OUTDATED_VERSION', current: LEGAL_VERSIONS });
        }

        const now = new Date().toISOString();
        const marketingConsent = body.marketing === true;
        const source = ['signup', 'first_login', 'update'].includes(body.source) ? body.source : 'first_login';
        const userRef = db.collection('users').doc(decoded.uid);
        const recordId = `legal_${LEGAL_VERSIONS.terms}_${LEGAL_VERSIONS.privacy}`.replace(/[^A-Za-z0-9_]+/g, '-');
        await userRef.collection('consents').doc(recordId).set({
            termsVersion: LEGAL_VERSIONS.terms,
            privacyVersion: LEGAL_VERSIONS.privacy,
            termsAccepted: true,
            privacyAccepted: true,
            popiaProcessingConsent: true,
            ageConfirmed: true,
            marketingConsent,
            source,
            acceptedAt: now,
            ip: req.ip || null,
            userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
        });
        await userRef.set(
            { legal: { termsVersion: LEGAL_VERSIONS.terms, privacyVersion: LEGAL_VERSIONS.privacy, acceptedAt: now, marketingConsent }, updatedAt: now },
            { merge: true }
        );
        const user = await userRef.get();
        return res.status(200).json({ user: { uid: decoded.uid, ...user.data() } });
    } catch (err: any) {
        console.error('Consent save error:', err.message);
        return res.status(500).json({ error: 'Your answer could not be saved. Try again.' });
    }
});

// ─── POST /api/auth/onboarding ───────────────────────────────────────────────
// Saves onboarding answers server-side (the browser never writes profiles directly).
// Step 1: { fullName, niche, workspaceName, popiaConsent, marketingConsent }
// Finish: { complete: true, plan }
router.post('/onboarding', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) return sendAuthError(res, 'MISSING_TOKEN');
        const decoded = await firebaseAuth().verifyIdToken(authHeader.split('Bearer ')[1]);
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
            // Consent is given on the consent step (POST /consent) before onboarding.
            const profile = (await userRef.get()).data();
            if (!hasCurrentConsent(profile)) return res.status(409).json({ error: 'Accept the Terms of Service and Privacy Policy first.', code: 'CONSENT_REQUIRED' });

            const consents = { popia: true, marketing: profile?.legal?.marketingConsent === true, timestamp: profile?.legal?.acceptedAt || now, version: LEGAL_VERSIONS.terms };
            Object.assign(updates, { displayName: fullName, fullName, niche: String(body.niche || '').slice(0, 60), consents });
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
