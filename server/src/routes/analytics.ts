import express, { Request, Response } from 'express';
import { db } from '../utils/firestore';
import admin from 'firebase-admin';
import { fetchers, calculateBestPostingTimes } from '../services/analytics/analyticsService';
import { withWorkspace } from '../middleware/withWorkspace';
import { decrypt } from '../utils/tokenEncryption';

const router = express.Router();

// GET /api/analytics/overview?period=7d|30d|90d
router.get('/overview', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const { period = '30d' } = req.query;

    try {
        // 1. Fetch all connected platforms for this workspace
        const connsSnap = await db.collection('workspaces').doc(workspaceId).collection('connections').get();
        if (connsSnap.empty) {
            return res.json({ summary: { totalReach: 0, totalImpressions: 0, avgEngagementRate: 0, totalFollowerGrowth: 0 }, byPlatform: {}, topPosts: [], growthChart: [] });
        }

        const data: any = {
            summary: { totalReach: 0, totalImpressions: 0, avgEngagementRate: 0, totalFollowerGrowth: 0 },
            byPlatform: {},
            topPosts: [],
            growthChart: []
        };

        const promises = connsSnap.docs.map(async (doc) => {
            const platform = doc.id;
            const conData = doc.data();
            if (fetchers[platform] && conData.accessToken) {
                try {
                    const decryptedToken = decrypt(conData.accessToken);
                    const stats = await fetchers[platform](workspaceId, decryptedToken, conData.accountId);
                    data.byPlatform[platform] = stats;
                    data.summary.totalReach += stats.reach;
                    data.summary.totalImpressions += stats.impressions;
                    data.summary.totalFollowerGrowth += stats.followerGrowth;
                    data.topPosts.push(...stats.topPosts);
                } catch (e: any) {
                    console.error(`Overview fetch fail for ${platform}:`, e.message);
                }
            }
        });

        await Promise.all(promises);

        // Finalize summary Calculations
        const platformCount = Object.keys(data.byPlatform).length;
        data.summary.avgEngagementRate = platformCount > 0
            ? (Object.values(data.byPlatform).reduce((acc: number, cur: any) => acc + (cur.engagementRate || 0), 0) as number) / platformCount
            : 0;

        // Sort Top Posts
        data.topPosts.sort((a: any, b: any) => b.reach - a.reach);
        data.topPosts = data.topPosts.slice(0, 10);

        // Best Posting Times (Dynamic calculation based on workspace history)
        data.bestPostingTimes = await calculateBestPostingTimes(workspaceId);

        res.json({ success: true, ...data });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
