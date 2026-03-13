import { getFirestore } from '../config/firebase.js';

/**
 * @fileoverview
 * Analytics Service
 * 
 * Aggregates engagement data across social platforms:
 * - Per-post metrics (likes, comments, shares, views)
 * - Platform-level performance summaries
 * - Growth tracking over time
 */

/**
 * Get aggregated analytics for a workspace.
 * @param {string} workspaceId
 * @param {string} [period='30d'] - Time period (7d, 30d, 90d)
 * @returns {Promise<object>}
 */
export async function getWorkspaceAnalytics(workspaceId, period = '30d') {
    const db = getFirestore();
    const daysMap = { '7d': 7, '30d': 30, '90d': 90 };
    const days = daysMap[period] || 30;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoff = cutoffDate.toISOString();

    // Get all published content within the period
    let posts = [];
    try {
        const contentSnapshot = await db.collection('workspaces')
            .doc(workspaceId)
            .collection('content')
            .where('status', '==', 'published')
            .where('publishedAt', '>=', cutoff)
            .orderBy('publishedAt', 'desc')
            .get();

        contentSnapshot.forEach(doc => posts.push(doc.data()));
    } catch (queryErr) {
        // Compound query may require a Firestore composite index
        // Fall back to simpler query or return empty
        console.warn('[Analytics] Compound query failed (missing index?), trying fallback:', queryErr.message);
        try {
            const fallback = await db.collection('workspaces')
                .doc(workspaceId)
                .collection('content')
                .where('status', '==', 'published')
                .get();
            fallback.forEach(doc => posts.push(doc.data()));
        } catch {
            // Collection may not exist yet for new users — that's fine
            posts = [];
        }
    }

    // Aggregate metrics from each post's metrics field
    let totalLikes = 0;
    let totalComments = 0;
    let totalShares = 0;
    let totalViews = 0;
    const platformBreakdown = {};

    posts.forEach(post => {
        const m = post.metrics || {};
        totalLikes += m.likes || 0;
        totalComments += m.comments || 0;
        totalShares += m.shares || 0;
        totalViews += m.views || 0;

        // Per-platform breakdown
        (post.platforms || []).forEach(platform => {
            if (!platformBreakdown[platform]) {
                platformBreakdown[platform] = { likes: 0, comments: 0, shares: 0, views: 0, posts: 0 };
            }
            platformBreakdown[platform].likes += m.likes || 0;
            platformBreakdown[platform].comments += m.comments || 0;
            platformBreakdown[platform].shares += m.shares || 0;
            platformBreakdown[platform].views += m.views || 0;
            platformBreakdown[platform].posts += 1;
        });
    });

    const totalEngagement = totalLikes + totalComments + totalShares;
    const engagementRate = totalViews > 0 ? ((totalEngagement / totalViews) * 100).toFixed(2) : 0;

    return {
        period,
        totalPosts: posts.length,
        totalLikes,
        totalComments,
        totalShares,
        totalViews,
        totalEngagement,
        engagementRate: Number(engagementRate),
        platformBreakdown,
        topPosts: posts.slice(0, 5).map(p => ({
            id: p.id,
            caption: p.caption?.substring(0, 80),
            platforms: p.platforms,
            publishedAt: p.publishedAt,
            metrics: p.metrics,
        })),
    };
}

/**
 * Get connection-level analytics (follower counts, etc.).
 * @param {string} workspaceId
 * @returns {Promise<Array>}
 */
export async function getConnectionAnalytics(workspaceId) {
    const db = getFirestore();

    const snapshot = await db.collection('workspaces')
        .doc(workspaceId)
        .collection('connections')
        .where('status', '==', 'active')
        .get();

    const connections = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        connections.push({
            platform: data.platform,
            username: data.username,
            followers: data.followers || 0,
            following: data.following || 0,
            postCount: data.postCount || 0,
        });
    });

    return connections;
}
