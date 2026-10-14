import { getFirestore } from '../config/firebase.js';

function mapConnection(doc) {
    const data = doc.data();
    const { accessToken, refreshToken, ...safe } = data;
    return {
        id: doc.id,
        platform: safe.platform || doc.id,
        username: safe.accountName || safe.username || '',
        photoURL: safe.accountAvatar || safe.photoURL || null,
        followers: safe.followersCount ?? safe.followers ?? 0,
        groupName: safe.groupName || null,
        status: safe.status || 'active',
        connectedAt: safe.connectedAt || safe.createdAt || null,
        updatedAt: safe.updatedAt || null,
        ...safe,
    };
}

/**
 * Get all connected social accounts for a workspace.
 */
export async function getConnections(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId } = req.params;

        const snapshot = await db.collection('workspaces')
            .doc(workspaceId)
            .collection('connections')
            .orderBy('updatedAt', 'desc')
            .get();

        const connections = snapshot.docs.map(mapConnection);

        res.json({ connections });
    } catch (error) {
        console.error('[Connection Controller] Get connections error:', error);
        res.status(500).json({ error: 'Failed to fetch social connections' });
    }
}

/**
 * Manual creation is no longer supported for OAuth platforms.
 */
export async function addConnection(req, res) {
    return res.status(405).json({
        error: 'MANUAL_CONNECTION_CREATION_DISABLED',
        message: 'Use the OAuth connection flow at /api/connections/:platform/auth-url.',
    });
}

/**
 * Delete a social connection.
 */
export async function deleteConnection(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId, connectionId } = req.params;

        await db.collection('workspaces')
            .doc(workspaceId)
            .collection('connections')
            .doc(connectionId)
            .delete();

        res.json({ message: 'Connection removed successfully' });
    } catch (error) {
        console.error('[Connection Controller] Delete connection error:', error);
        res.status(500).json({ error: 'Failed to delete social connection' });
    }
}

/**
 * Update a social connection.
 */
export async function updateConnection(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId, connectionId } = req.params;
        const updates = {
            ...req.body,
        };

        delete updates.accessToken;
        delete updates.refreshToken;
        delete updates.platform;
        delete updates.accountId;

        updates.updatedAt = new Date().toISOString();

        await db.collection('workspaces')
            .doc(workspaceId)
            .collection('connections')
            .doc(connectionId)
            .update(updates);

        const updatedDoc = await db.collection('workspaces')
            .doc(workspaceId)
            .collection('connections')
            .doc(connectionId)
            .get();

        res.json({ connection: mapConnection(updatedDoc) });
    } catch (error) {
        console.error('[Connection Controller] Update connection error:', error);
        res.status(500).json({ error: 'Failed to update social connection' });
    }
}
