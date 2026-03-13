import { getFirestore } from '../config/firebase.js';
import * as youtubeUtil from '../utils/youtube.js';

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

        const connections = [];
        snapshot.forEach(doc => {
            connections.push(doc.data());
        });

        res.json({ connections });
    } catch (error) {
        console.error('[Connection Controller] Get connections error:', error);
        res.status(500).json({ error: 'Failed to fetch social connections' });
    }
}

/**
 * Mocking the addition of a connection (In a real app, this would be an OAuth callback).
 */
export async function addConnection(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId } = req.params;
        const { platform, accountId, username, photoURL, accessToken, refreshToken, expiresAt, groupName } = req.body;

        if (!platform || !accountId) {
            return res.status(400).json({ error: 'Platform and Account ID are required' });
        }

        const now = new Date().toISOString();
        let connectionData = {
            id: `${platform}_${accountId}`,
            platform,
            accountId,
            username: username || 'User',
            photoURL: photoURL || null,
            accessToken,
            refreshToken: refreshToken || null,
            expiresAt: expiresAt || null,
            status: 'active',
            groupName: groupName || null,
            createdAt: now,
            updatedAt: now,
        };

        // YouTube specific simulation
        if (platform === 'youtube' && !accessToken) {
            const mockYoutube = await youtubeUtil.verifyYouTubeTokens('mock_code');
            connectionData = {
                ...connectionData,
                id: `youtube_${mockYoutube.profile.id}`,
                accountId: mockYoutube.profile.id,
                username: mockYoutube.profile.title,
                photoURL: mockYoutube.profile.thumbnails.default.url,
                accessToken: mockYoutube.accessToken,
                refreshToken: mockYoutube.refreshToken,
                expiresAt: new Date(Date.now() + mockYoutube.expiresIn * 1000).toISOString(),
            };
        }

        const connectionRef = db.collection('workspaces')
            .doc(workspaceId)
            .collection('connections')
            .doc(connectionData.id);

        await connectionRef.set(connectionData);

        res.status(201).json({ connection: connectionData });
    } catch (error) {
        console.error('[Connection Controller] Add connection error:', error);
        res.status(500).json({ error: 'Failed to add social connection' });
    }
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
        const updates = req.body;

        updates.updatedAt = new Date().toISOString();

        await db.collection('workspaces')
            .doc(workspaceId)
            .collection('connections')
            .doc(connectionId)
            .update(updates);

        res.json({ message: 'Connection updated successfully' });
    } catch (error) {
        console.error('[Connection Controller] Update connection error:', error);
        res.status(500).json({ error: 'Failed to update social connection' });
    }
}
