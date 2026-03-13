import { getFirestore } from '../config/firebase.js';
import { processScheduledPosts, getSchedulerStats } from '../services/scheduler.service.js';

/**
 * POST /api/scheduler/process/:workspaceId
 * Manually trigger processing of scheduled posts.
 * In production this would be called by a Cloud Function cron trigger.
 */
export async function triggerSchedulerProcess(req, res) {
    try {
        const { workspaceId } = req.params;

        const result = await processScheduledPosts(workspaceId);

        res.json({
            message: 'Scheduler run complete',
            ...result,
        });
    } catch (error) {
        console.error('[Scheduler Controller] Process error:', error);
        res.status(500).json({ error: 'Failed to process scheduled posts' });
    }
}

/**
 * GET /api/scheduler/stats/:workspaceId
 * Get scheduling statistics for a workspace.
 */
export async function getStats(req, res) {
    try {
        const { workspaceId } = req.params;
        const stats = await getSchedulerStats(workspaceId);
        res.json({ stats });
    } catch (error) {
        console.error('[Scheduler Controller] Stats error:', error);
        res.status(500).json({ error: 'Failed to fetch scheduler stats' });
    }
}

/**
 * GET /api/scheduler/queue/:workspaceId
 * Get the upcoming scheduled posts queue.
 */
export async function getQueue(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId } = req.params;

        const snapshot = await db.collection('workspaces')
            .doc(workspaceId)
            .collection('content')
            .where('status', '==', 'scheduled')
            .orderBy('scheduledAt', 'asc')
            .limit(20)
            .get();

        const queue = [];
        snapshot.forEach(doc => queue.push(doc.data()));

        res.json({ queue });
    } catch (error) {
        console.error('[Scheduler Controller] Queue error:', error);
        res.status(500).json({ error: 'Failed to fetch scheduler queue' });
    }
}
