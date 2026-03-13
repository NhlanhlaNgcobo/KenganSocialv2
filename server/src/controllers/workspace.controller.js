import { getFirestore } from '../config/firebase.js';

/**
 * Get all workspaces for the authenticated user.
 */
export async function getWorkspaces(req, res) {
    try {
        const db = getFirestore();
        const uid = req.user.uid;

        const snapshot = await db.collection('workspaces')
            .where('ownerId', '==', uid)
            .get();

        const workspaces = [];
        snapshot.forEach(doc => {
            workspaces.push(doc.data());
        });

        // Sort client-side to avoid needing a composite index
        workspaces.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

        res.json({ workspaces });
    } catch (error) {
        console.error('[Workspace Controller] Get workspaces error:', error);
        res.status(500).json({ error: 'Failed to fetch workspaces' });
    }
}

/**
 * Create a new workspace.
 */
export async function createWorkspace(req, res) {
    try {
        const db = getFirestore();
        const uid = req.user.uid;
        const { name } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Workspace name is required' });
        }

        const now = new Date().toISOString();
        const workspaceRef = db.collection('workspaces').doc();

        const workspaceData = {
            id: workspaceRef.id,
            name,
            ownerId: uid,
            plan: 'free',
            createdAt: now,
            updatedAt: now,
        };

        await workspaceRef.set(workspaceData);

        // Add owner as a member
        await workspaceRef.collection('members').doc(uid).set({
            uid,
            role: 'owner',
            joinedAt: now,
        });

        res.status(201).json({ workspace: workspaceData });
    } catch (error) {
        console.error('[Workspace Controller] Create workspace error:', error);
        res.status(500).json({ error: 'Failed to create workspace' });
    }
}

/**
 * Get a specific workspace by ID.
 * (Membership check is handled by middleware)
 */
export async function getWorkspaceById(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId } = req.params;

        const doc = await db.collection('workspaces').doc(workspaceId).get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Workspace not found' });
        }

        res.json({ workspace: doc.data() });
    } catch (error) {
        console.error('[Workspace Controller] Get workspace error:', error);
        res.status(500).json({ error: 'Failed to fetch workspace' });
    }
}
