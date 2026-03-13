import { getFirestore } from '../config/firebase.js';
import { processScheduledPosts } from '../services/scheduler.service.js';

/**
 * @fileoverview
 * Scheduler Cron Job
 * 
 * Runs on a configurable interval (default: every 60 seconds)
 * and processes all workspaces' scheduled posts that are due.
 * 
 * In production, this should be replaced with a Firebase Cloud Function
 * triggered by Cloud Scheduler for better reliability and scaling.
 */

let intervalId = null;

/**
 * Start the scheduler cron loop.
 * @param {number} [intervalMs=60000] - How often to check for due posts
 */
export function startSchedulerCron(intervalMs = 60000) {
    if (intervalId) {
        console.log('[Cron] Scheduler already running');
        return;
    }

    console.log(`[Cron] Scheduler started — checking every ${intervalMs / 1000}s`);

    intervalId = setInterval(async () => {
        try {
            const db = getFirestore();

            // Get all workspaces
            const snapshot = await db.collection('workspaces').get();

            for (const doc of snapshot.docs) {
                const workspaceId = doc.id;
                const result = await processScheduledPosts(workspaceId);

                if (result.total > 0) {
                    console.log(
                        `[Cron] Workspace ${workspaceId}: ${result.published} published, ${result.failed} failed`
                    );
                }
            }
        } catch (error) {
            console.error('[Cron] Scheduler error:', error.message);
            if (error.code === 7) {
                console.error('💡 TIP: This is a PERMISSION_DENIED error. Ensure your Service Account has "Firebase Admin" role and Firestore API is enabled.');
            }
        }
    }, intervalMs);
}

/**
 * Stop the scheduler cron loop.
 */
export function stopSchedulerCron() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log('[Cron] Scheduler stopped');
    }
}
