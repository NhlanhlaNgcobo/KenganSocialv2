import express, { Request, Response, NextFunction } from 'express';
import { db } from '../utils/firestore';

import { fetchTrendingResult } from '../services/trending/trendingService';

const router = express.Router();

import { withWorkspace } from '../middleware/withWorkspace';
import { planRateLimit } from '../middleware/planGate';

// GET /api/trending?niche=fitness&limit=20[&refresh=1]
router.get('/', withWorkspace, planRateLimit(), async (req: Request, res: Response) => {
    const niche = typeof req.query.niche === 'string' && req.query.niche.trim() ? req.query.niche.trim().slice(0, 60) : 'general';
    const limit = req.query.limit;
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const plan = (req as any).plan;

    try {
        // Run service fetcher (handles caching internally; refresh=1 bypasses the 2h cache)
        const result = await fetchTrendingResult(niche, plan as string, { refresh });

        // Apply optional limit
        const limitNum = parseInt(limit as string, 10);
        const results = result.cards.slice(0, Number.isNaN(limitNum) ? 20 : Math.min(Math.max(limitNum, 1), 50));

        res.json({
            success: true,
            count: results.length,
            data: results,
            generatedAt: result.generatedAt,
            // 'live' when built from YouTube/TikTok/Perplexity data; 'ai-ideas' when no live source is connected.
            source: result.dataSource,
            cached: result.cached,
            refreshThrottled: !!result.refreshThrottled,
        });
    } catch (err: any) {
        console.error('Trending Route Error:', err);
        res.status(500).json({ error: 'Failed to generate trending content' });
    }
});

// GET /api/trending/niches — Optionally retrieve list of active cached niches
router.get('/niches', withWorkspace, async (req: Request, res: Response) => {
    try {
        const snap = await db.collection('trending_cache').get();
        const niches = snap.docs.map(doc => doc.data().niche);
        res.json({ success: true, niches: [...new Set(niches)] });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
