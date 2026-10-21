/**
 * GET /api/privacy/export: a signed-in person downloads everything stored about them (POPIA right
 * of access). Deletion and Meta's callbacks are in routes/data-deletion.ts.
 */
import express from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { exportAccountData } from '../services/account-data';

const router = express.Router();

router.get('/export', requireAuth, async (req: Request, res: Response) => {
    try {
        const data = await exportAccountData((req as any).user.uid);
        res.setHeader('Content-Disposition', `attachment; filename="kengansocial-data-${new Date().toISOString().slice(0, 10)}.json"`);
        res.json(data);
    } catch (err: any) {
        console.error('[Privacy] Export failed:', err.message);
        res.status(500).json({ error: 'Your data could not be exported. Try again or email privacy@kengansocial.com.' });
    }
});

export default router;
