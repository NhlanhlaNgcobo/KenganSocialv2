import cron from 'node-cron';
import { db } from '../utils/firestore';
import { fetchTrendingByNiche } from '../services/trending/trendingService';

/**
 * Automates the refreshing of trending content ideas every 2 hours.
 * This ensures the shared cache stays fresh for all users based on their niches.
 * Schedule: every 2 hours
 */
export function startTrendingCron() {
    console.log('🕒 [Cron] Trending Content Ideas Refresh Engine Started (2h intervals)');

    cron.schedule('0 */2 * * *', async () => {
        console.log('🔥 [Cron] Refreshing active trending niches...');

        try {
            // 1. Identify all active niches by scanning the existing cache
            // In a production environment with thousands of niches, you might prioritize by user count
            const snap = await db.collection('trending_cache').get();
            const niches = snap.docs.map(doc => doc.data().niche);
            const uniqueNiches = [...new Set<string>(niches.filter((n): n is string => typeof n === 'string' && Boolean(n.trim())))];

            console.log(`📡 [Cron] Found ${uniqueNiches.length} active niches to update.`);

            // 2. Refresh each niche in sequence to avoid hitting rate limits or consuming too much memory/credits at once
            for (const niche of uniqueNiches) {
                try {
                    console.log(`⚡ [Cron] Refreshing niche: ${niche}...`);
                    // Passing 'nano' as plan ensures Perplexity is triggered to get fresh real-time data
                    await fetchTrendingByNiche(niche, 'nano');
                    // Small delay to prevent burst costs/rate limits
                    await new Promise(r => setTimeout(r, 10000));
                } catch (err: any) {
                    console.error(`❌ [Cron] Failed to refresh niche "${niche}":`, err.message);
                }
            }

            console.log('✅ [Cron] Trending refresh cycle complete.');
        } catch (err: any) {
            console.error('❌ [Cron] Critical error in trending refresh cycle:', err.message);
        }
    });
}
