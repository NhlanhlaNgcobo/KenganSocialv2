import { getFirestore } from '../config/firebase.js';

/**
 * Get all content for a workspace.
 */
export async function getContent(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId } = req.params;

        const snapshot = await db.collection('workspaces')
            .doc(workspaceId)
            .collection('content')
            .orderBy('createdAt', 'desc')
            .get();

        const contentList = [];
        snapshot.forEach(doc => {
            contentList.push(doc.data());
        });

        res.json({ content: contentList });
    } catch (error) {
        console.error('[Content Controller] Get content error:', error);
        res.status(500).json({ error: 'Failed to fetch content' });
    }
}

/**
 * Create a new content piece (Post/Draft).
 */
export async function createContent(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId } = req.params;
        const { type, mediaUrl, thumbnailURL, caption, platforms, status, scheduledAt } = req.body;

        if (!type || !caption) {
            return res.status(400).json({ error: 'Type and Caption are required' });
        }

        const now = new Date().toISOString();
        const contentRef = db.collection('workspaces')
            .doc(workspaceId)
            .collection('content')
            .doc();

        const contentData = {
            id: contentRef.id,
            type,
            mediaUrl: mediaUrl || null,
            thumbnailURL: thumbnailURL || null,
            caption,
            platforms: platforms || [],
            status: status || 'draft',
            scheduledAt: scheduledAt || null,
            publishedAt: null,
            metrics: {},
            createdAt: now,
            updatedAt: now,
        };

        await contentRef.set(contentData);

        res.status(201).json({ content: contentData });
    } catch (error) {
        console.error('[Content Controller] Create content error:', error);
        res.status(500).json({ error: 'Failed to create content' });
    }
}

/**
 * Update content (e.g., updating a draft or rescheduling).
 */
export async function updateContent(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId, contentId } = req.params;
        const updates = req.body;

        updates.updatedAt = new Date().toISOString();

        await db.collection('workspaces')
            .doc(workspaceId)
            .collection('content')
            .doc(contentId)
            .update(updates);

        const updatedDoc = await db.collection('workspaces')
            .doc(workspaceId)
            .collection('content')
            .doc(contentId)
            .get();

        res.json({ content: updatedDoc.data() });
    } catch (error) {
        console.error('[Content Controller] Update content error:', error);
        res.status(500).json({ error: 'Failed to update content' });
    }
}

/**
 * Delete content.
 */
export async function deleteContent(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId, contentId } = req.params;

        await db.collection('workspaces')
            .doc(workspaceId)
            .collection('content')
            .doc(contentId)
            .delete();

        res.json({ message: 'Content deleted successfully' });
    } catch (error) {
        console.error('[Content Controller] Delete content error:', error);
        res.status(500).json({ error: 'Failed to delete content' });
    }
}
