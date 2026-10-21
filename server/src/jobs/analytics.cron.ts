import cron from 'node-cron';
import { db } from '../utils/firestore';
import { effectivePlan } from '../utils/trial';
import { syncWorkspaceAnalytics } from '../services/analytics/analyticsService';

/**
 * Automates the synchronization of social media analytics every 6 hours.
 * This ensures the dashboard stays updated with the latest trends and performance metrics.
 * Schedule: every 6 hours
 */
export function startAnalyticsCron() {
    console.log('🕒 [Cron] Analytics Synchronization Job Started (6h intervals)');

    cron.schedule('0 */6 * * *', async () => {
        console.log('🔥 [Cron] Beginning multi-platform analytics sync...');

        try {
            // 1. Fetch all active workspaces that have connected accounts
            const wsSnap = await db.collection('workspaces').get();
            const workspaces = wsSnap.docs;

            console.log(`📡 [Cron] Syncing analytics for ${workspaces.length} workspaces.`);

            // 2. Process each workspace in sequential groups to avoid hitting global API rate limits across all platforms
            for (const wsDoc of workspaces) {
                try {
                    const workspaceId = wsDoc.id;
                    const wsData = wsDoc.data();
                    const plan = effectivePlan(wsData);

                    console.log(`⚡ [Cron] Syncing workspace: ${workspaceId} (Plan: ${plan})...`);
                    await syncWorkspaceAnalytics(workspaceId, plan);

                    // Small delay to prevent burst costs/rate limits across many providers
                    await new Promise(r => setTimeout(r, 2000));
                } catch (err: any) {
                    console.error(`❌ [Cron] Failed for workspace "${wsDoc.id}":`, err.message);
                }
            }

            console.log('✅ [Cron] Analytics synchronization cycle complete.');
        } catch (err: any) {
            console.error('❌ [Cron] Critical error in analytics cycle:', err.message);
        }
    });
}
