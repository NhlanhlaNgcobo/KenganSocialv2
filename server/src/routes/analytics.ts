import express, { Request, Response } from 'express';
import { db } from '../utils/firestore';
import { fetchConnectionAnalytics, calculateBestPostingTimes, AnalyticsSnapshot, AnalyticsPost } from '../services/analytics/analyticsService';
import { withWorkspace } from '../middleware/withWorkspace';

const router = express.Router();

const ALLOWED_PERIODS = [7, 30, 90];

function parsePeriod(raw: unknown): number {
    const days = parseInt(String(raw ?? '30').replace(/d$/i, ''), 10);
    return ALLOWED_PERIODS.includes(days) ? days : 30;
}

function postScore(p: AnalyticsPost) {
    return p.views ?? (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0);
}

// GET /api/analytics/overview?period=7d|30d|90d
// Live: each request reads the connected platforms' APIs for the chosen period.
router.get('/overview', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    if (!workspaceId) {
        return res.status(404).json({ error: 'No workspace found for this account.' });
    }
    const periodDays = parsePeriod(req.query.period);

    try {
        const connsSnap = await db.collection('workspaces').doc(workspaceId).collection('connections').get();

        const snapshots: AnalyticsSnapshot[] = await Promise.all(
            connsSnap.docs.map((doc) => fetchConnectionAnalytics(workspaceId, doc.id, doc.data(), periodDays))
        );

        const ok = snapshots.filter((s) => s.status === 'ok');
        const total = (pick: (s: AnalyticsSnapshot) => number | null) => {
            const values = ok.map(pick).filter((v): v is number => v !== null);
            return values.length ? values.reduce((a, b) => a + b, 0) : null;
        };
        const rates = ok.map((s) => s.engagementRate).filter((v): v is number => v !== null);

        const byPlatform: Record<string, Omit<AnalyticsSnapshot, 'posts'> & { postCount: number }> = {};
        for (const s of snapshots) {
            const { posts, ...rest } = s;
            byPlatform[s.platform] = { ...rest, postCount: posts.length };
        }

        // Growth chart: one row per day with each platform's reach, only from real per-day data.
        const rows = new Map<string, Record<string, number | string>>();
        for (const s of ok) {
            for (const d of s.byDay) {
                if (d.reach === null || !d.date) continue;
                const row = rows.get(d.date) || { date: d.date };
                row[s.platform] = d.reach;
                rows.set(d.date, row);
            }
        }
        const growthChart = [...rows.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));

        // Top posts published within the period; best times use every recent post we could read.
        const allPosts = ok.flatMap((s) => s.posts);
        const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
        const topPosts = allPosts
            .filter((p) => p.publishedAt && new Date(p.publishedAt).getTime() >= cutoff)
            .sort((a, b) => postScore(b) - postScore(a))
            .slice(0, 10);

        res.json({
            success: true,
            periodDays,
            connectedCount: connsSnap.size,
            summary: {
                totalReach: total((s) => s.reach),
                totalImpressions: total((s) => s.impressions),
                avgEngagementRate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
                totalFollowerGrowth: total((s) => s.followerGrowth),
                platformsReporting: ok.length,
                platformsUnavailable: snapshots.length - ok.length,
            },
            byPlatform,
            topPosts,
            growthChart,
            bestPostingTimes: calculateBestPostingTimes(allPosts),
        });
    } catch (err: any) {
        console.error('[Analytics] Overview failed:', err.message);
        res.status(500).json({ error: 'Could not load analytics. Try again.' });
    }
});

export default router;
