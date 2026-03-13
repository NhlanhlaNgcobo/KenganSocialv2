import { getFirestore } from '../config/firebase.js';

/**
 * Create a new user profile in Firestore after sign-up.
 * Also creates a default workspace for the user.
 */
export async function createUserProfile(req, res) {
    try {
        const db = getFirestore();
        const { uid, email } = req.user;
        const { displayName, photoURL } = req.body;

        // Check if profile already exists
        const existingUser = await db.collection('users').doc(uid).get();
        if (existingUser.exists) {
            return res.status(409).json({ error: 'User profile already exists' });
        }

        const now = new Date().toISOString();

        // Create user doc
        const userData = {
            uid,
            email,
            displayName: displayName || email.split('@')[0],
            photoURL: photoURL || null,
            plan: 'free',
            createdAt: now,
            updatedAt: now,
        };

        await db.collection('users').doc(uid).set(userData);

        // Create a default workspace
        const workspaceRef = db.collection('workspaces').doc();
        const workspaceData = {
            id: workspaceRef.id,
            name: `${userData.displayName}'s Workspace`,
            ownerId: uid,
            plan: 'free',
            createdAt: now,
            updatedAt: now,
        };

        await workspaceRef.set(workspaceData);

        // Add user as owner of the workspace
        await workspaceRef.collection('members').doc(uid).set({
            uid,
            role: 'owner',
            joinedAt: now,
        });

        // Update user with default workspace ID
        await db.collection('users').doc(uid).update({
            defaultWorkspaceId: workspaceRef.id,
        });

        res.status(201).json({
            user: { ...userData, defaultWorkspaceId: workspaceRef.id },
            workspace: workspaceData,
        });
    } catch (error) {
        console.error('[Auth Controller] Create profile error:', error);
        res.status(500).json({ error: 'Failed to create user profile' });
    }
}

/**
 * Get the authenticated user's profile.
 */
export async function getUserProfile(req, res) {
    try {
        const db = getFirestore();
        const userDoc = await db.collection('users').doc(req.user.uid).get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User profile not found' });
        }

        res.json({ user: userDoc.data() });
    } catch (error) {
        console.error('[Auth Controller] Get profile error:', error);
        res.status(500).json({ error: 'Failed to fetch user profile' });
    }
}

/**
 * Update the authenticated user's profile.
 */
export async function updateUserProfile(req, res) {
    try {
        const db = getFirestore();
        const { displayName, photoURL, bio } = req.body;

        const updates = { updatedAt: new Date().toISOString() };
        if (displayName !== undefined) updates.displayName = displayName;
        if (photoURL !== undefined) updates.photoURL = photoURL;
        if (bio !== undefined) updates.bio = bio;

        await db.collection('users').doc(req.user.uid).update(updates);

        const updatedDoc = await db.collection('users').doc(req.user.uid).get();

        res.json({ user: updatedDoc.data() });
    } catch (error) {
        console.error('[Auth Controller] Update profile error:', error);
        res.status(500).json({ error: 'Failed to update user profile' });
    }
}
