import { getWorkspaceAnalytics, getConnectionAnalytics } from '../services/analytics.service.js';

/**
 * GET /api/analytics/:workspaceId
 * Get full analytics dashboard data for a workspace.
 */
export async function getDashboardAnalytics(req, res) {
    try {
        const { workspaceId } = req.params;
        const { period } = req.query; // ?period=7d|30d|90d

        const [overview, connections] = await Promise.all([
            getWorkspaceAnalytics(workspaceId, period),
            getConnectionAnalytics(workspaceId),
        ]);

        res.json({
            overview,
            connections,
        });
    } catch (error) {
        console.error('[Analytics Controller] Dashboard error:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
}

/**
 * GET /api/analytics/:workspaceId/posts
 * Get per-post performance data.
 */
export async function getPostAnalytics(req, res) {
    try {
        const { workspaceId } = req.params;
        const { period } = req.query;

        const analytics = await getWorkspaceAnalytics(workspaceId, period);

        res.json({
            topPosts: analytics.topPosts,
            totalPosts: analytics.totalPosts,
        });
    } catch (error) {
        console.error('[Analytics Controller] Post analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch post analytics' });
    }
}
