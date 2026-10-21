import express, { Request, Response, NextFunction } from 'express';
import { withWorkspace } from '../middleware/withWorkspace';
import { AdsError, DATE_PRESETS, getAccountOverview, listCampaigns, recentActivity, setCampaignStatus, setDailyBudget, type DatePreset } from '../services/meta/ads';

/**
 * Meta Ads page (/dashboard/ads):
 *   GET  /api/ads/overview?preset=last_7d        account totals
 *   GET  /api/ads/campaigns?preset=last_7d       campaigns with results
 *   GET  /api/ads/activity                       recent changes made from KenganSocial
 *   POST /api/ads/campaigns/:id/status   { status: 'ACTIVE' | 'PAUSED' }
 *   POST /api/ads/campaigns/:id/budget   { dailyBudget }  (minor units, e.g. cents)
 * Any member of the workspace can make changes (as with posting); each is recorded in adsActivity.
 */

const router = express.Router();

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch((error: any) => {
        console.error(`[Ads] ${req.method} ${req.path} failed:`, error.message);
        if (res.headersSent) return next(error);
        res.status(error instanceof AdsError ? error.status : 500).json({ error: error instanceof AdsError ? error.message : 'Meta Ads could not be loaded. Try again.' });
    });

function requireWorkspace(req: Request, res: Response, next: NextFunction) {
    if (!(req as any).workspaceId) return res.status(403).json({ error: 'WORKSPACE_REQUIRED' });
    next();
}

const guard = [withWorkspace, requireWorkspace];
const preset = (req: Request): DatePreset => (DATE_PRESETS.includes(req.query.preset as DatePreset) ? (req.query.preset as DatePreset) : 'last_7d');

router.get('/overview', ...guard, route(async (req, res) => {
    res.json({ success: true, account: await getAccountOverview((req as any).workspaceId, preset(req)) });
}));

router.get('/campaigns', ...guard, route(async (req, res) => {
    res.json({ success: true, campaigns: await listCampaigns((req as any).workspaceId, preset(req)) });
}));

router.get('/activity', ...guard, route(async (req, res) => {
    res.json({ success: true, activity: await recentActivity((req as any).workspaceId) });
}));

router.post('/campaigns/:id/status', ...guard, route(async (req, res) => {
    const status = req.body?.status;
    if (status !== 'ACTIVE' && status !== 'PAUSED') return res.status(400).json({ error: 'Status must be ACTIVE or PAUSED.' });
    res.json({ success: true, ...(await setCampaignStatus((req as any).workspaceId, (req as any).uid, String(req.params.id), status)) });
}));

router.post('/campaigns/:id/budget', ...guard, route(async (req, res) => {
    res.json({ success: true, ...(await setDailyBudget((req as any).workspaceId, (req as any).uid, String(req.params.id), Number(req.body?.dailyBudget))) });
}));

export default router;
