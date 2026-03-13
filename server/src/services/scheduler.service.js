import { getFirestore } from '../config/firebase.js';

/**
 * @fileoverview
 * Scheduler Service
 * 
 * Manages scheduled posts:
 * - Retrieves posts due for publishing
 * - Updates post statuses (draft → scheduled → published / failed)
 * - Provides scheduling analytics
 * 
 * In production, this would be triggered by a Cloud Function
 * or CRON job (e.g., Firebase Cloud Scheduler).
 */

/**
 * Get all posts that are scheduled and due for publishing.
 * @param {string} workspaceId
 * @returns {Promise<Array>}
 */
export async function getDuePosts(workspaceId) {
    const db = getFirestore();
    const now = new Date().toISOString();

    const snapshot = await db.collection('workspaces')
        .doc(workspaceId)
        .collection('content')
        .where('status', '==', 'scheduled')
        .get();

    let posts = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.scheduledAt && data.scheduledAt <= now) {
            posts.push({ ...data, _ref: doc.ref });
        }
    });

    // Sort by scheduledAt ascending
    posts.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

    return posts;
}

/**
 * Mark a post as published (or failed).
 * @param {FirebaseFirestore.DocumentReference} postRef
 * @param {'published' | 'failed'} status
 * @param {string} [errorMessage]
 */
export async function updatePostStatus(postRef, status, errorMessage = null) {
    const updates = {
        status,
        updatedAt: new Date().toISOString(),
    };

    if (status === 'published') {
        updates.publishedAt = new Date().toISOString();
    }

    if (errorMessage) {
        updates.publishError = errorMessage;
    }

    await postRef.update(updates);
}

/**
 * Process all due posts for a workspace.
 * This is the main loop called by the scheduler cron.
 * 
 * @param {string} workspaceId
 * @returns {Promise<{ published: number, failed: number }>}
 */
export async function processScheduledPosts(workspaceId) {
    const duePosts = await getDuePosts(workspaceId);
    let published = 0;
    let failed = 0;

    for (const post of duePosts) {
        try {
            // In a real implementation, this would:
            // 1. Fetch the connected social account tokens
            // 2. Call the respective platform APIs (TikTok, Instagram, etc.)
            // 3. Upload media and publish the post
            // 4. Store the platform-specific post IDs for analytics tracking

            // For now, simulate publishing
            console.log(`[Scheduler] Publishing post ${post.id} to platforms: ${post.platforms?.join(', ')}`);

            await updatePostStatus(post._ref, 'published');
            published++;
        } catch (error) {
            console.error(`[Scheduler] Failed to publish post ${post.id}:`, error.message);
            await updatePostStatus(post._ref, 'failed', error.message);
            failed++;
        }
    }

    return { published, failed, total: duePosts.length };
}

/**
 * Get scheduling analytics for a workspace.
 * @param {string} workspaceId
 * @returns {Promise<object>}
 */
export async function getSchedulerStats(workspaceId) {
    const db = getFirestore();
    const contentRef = db.collection('workspaces')
        .doc(workspaceId)
        .collection('content');

    const [scheduled, published, draft, failed] = await Promise.all([
        contentRef.where('status', '==', 'scheduled').count().get(),
        contentRef.where('status', '==', 'published').count().get(),
        contentRef.where('status', '==', 'draft').count().get(),
        contentRef.where('status', '==', 'failed').count().get(),
    ]);

    return {
        scheduled: scheduled.data().count,
        published: published.data().count,
        drafts: draft.data().count,
        failed: failed.data().count,
    };
}
