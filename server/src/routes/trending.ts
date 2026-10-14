import express, { Request, Response, NextFunction } from 'express';
import { db } from '../utils/firestore';
import admin from 'firebase-admin';
import { fetchTrendingByNiche } from '../services/trending/trendingService';

const router = express.Router();

import { withWorkspace } from '../middleware/withWorkspace';
import { planRateLimit } from '../middleware/planGate';

// GET /api/trending?niche=fitness&limit=20
router.get('/', withWorkspace, planRateLimit(), async (req: Request, res: Response) => {
    const { niche = 'general', limit = 20 } = req.query;
    const plan = (req as any).plan;

    try {
        // Run service fetcher (handles caching internally)
        const trendingCards = await fetchTrendingByNiche(niche as string, plan as string);

        // Apply optional limit
        const limitNum = parseInt(limit as string, 10);
        const results = trendingCards.slice(0, Number.isNaN(limitNum) ? 20 : limitNum);

        res.json({ success: true, count: results.length, data: results });
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
