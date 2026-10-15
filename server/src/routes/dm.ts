import express, { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { db } from '../utils/firestore';
import { withWorkspace } from '../middleware/withWorkspace';
import { processInstagramWebhook, sendInstagramDM, validSignature, verifyToken } from '../services/instagram-dm';

const router = express.Router();

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Express 4 does not catch async errors: without this, a Firestore error crashes the server. */
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch((error: any) => {
        console.error(`[Inbox] ${req.method} ${req.path} failed:`, error.message);
        if (res.headersSent) return next(error);
        res.status(error.status || 500).json({ error: error.status ? error.message : 'Something went wrong with the inbox. Try again.' });
    });

function requireWorkspace(req: Request, res: Response, next: NextFunction) {
    if (!(req as any).workspaceId) return res.status(403).json({ error: 'WORKSPACE_REQUIRED' });
    next();
}

const guard = [withWorkspace, requireWorkspace];
const ws = (req: Request) => db.collection('workspaces').doc((req as any).workspaceId);

// ─────────────────────────────────────────────────────────────────────────────
// KEYWORD AUTO-REPLIES
// ─────────────────────────────────────────────────────────────────────────────

router.post('/automations', ...guard, route(async (req, res) => {
    if ((req as any).plan === 'starter') return res.status(402).json({ error: 'Upgrade to Nano or higher to create auto-replies.' });
    const { platform, trigger, keyword, replyTemplate } = req.body || {};
    if (!String(keyword || '').trim() || !String(replyTemplate || '').trim()) {
        return res.status(400).json({ error: 'Add a keyword and a reply.' });
    }
    const data = {
        platform: platform || 'instagram',
        trigger: trigger || 'keyword',
        keyword: String(keyword).trim().toLowerCase().slice(0, 100),
        replyTemplate: String(replyTemplate).trim().slice(0, 1000),
        isActive: true,
        sentCount: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const ref = ws(req).collection('dmAutomations').doc();
    await ref.set(data);
    res.json({ success: true, id: ref.id, ...data });
}));

router.get('/automations', ...guard, route(async (req, res) => {
    const snap = await ws(req).collection('dmAutomations').get();
    res.json({ success: true, automations: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
}));

router.put('/automations/:id', ...guard, route(async (req, res) => {
    const ref = ws(req).collection('dmAutomations').doc(String(req.params.id));
    if (!(await ref.get()).exists) return res.status(404).json({ error: 'Auto-reply not found' });
    const { isActive, replyTemplate, keyword } = req.body || {};
    await ref.update({
        ...(isActive !== undefined && { isActive: !!isActive }),
        ...(replyTemplate && { replyTemplate: String(replyTemplate).slice(0, 1000) }),
        ...(keyword && { keyword: String(keyword).toLowerCase().slice(0, 100) }),
    });
    res.json({ success: true });
}));

router.delete('/automations/:id', ...guard, route(async (req, res) => {
    await ws(req).collection('dmAutomations').doc(String(req.params.id)).delete();
    res.json({ success: true });
}));

// ─────────────────────────────────────────────────────────────────────────────
// APPROVAL QUEUE
// ─────────────────────────────────────────────────────────────────────────────

router.get('/queue', ...guard, route(async (req, res) => {
    const plan = (req as any).plan;
    if (plan === 'starter' || plan === 'nano') return res.status(402).json({ error: 'Upgrade to Creator or higher for the reply queue.' });
    const snap = await ws(req).collection('dmQueue').where('status', '==', 'pending').limit(50).get();
    res.json({ success: true, queue: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
}));

async function sendQueued(req: Request, res: Response, text?: string) {
    const ref = ws(req).collection('dmQueue').doc(String(req.params.id));
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Message not found' });
    const data = doc.data()!;
    const reply = String(text ?? data.aiSuggestedReply ?? '').trim();
    await sendInstagramDM((req as any).workspaceId, data.senderId, reply);
    await ref.update({ status: 'sent', aiSuggestedReply: reply, sentAt: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ success: true });
}

router.post('/queue/:id/send', ...guard, route((req, res) => sendQueued(req, res)));

router.post('/queue/:id/edit-send', ...guard, route((req, res) => sendQueued(req, res, req.body?.text)));

router.post('/queue/:id/dismiss', ...guard, route(async (req, res) => {
    const ref = ws(req).collection('dmQueue').doc(String(req.params.id));
    if (!(await ref.get()).exists) return res.status(404).json({ error: 'Message not found' });
    await ref.update({ status: 'dismissed' });
    res.json({ success: true });
}));

// ─────────────────────────────────────────────────────────────────────────────
// INSTAGRAM WEBHOOK (same handler as /api/webhooks/meta)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/webhook/instagram', (req: Request, res: Response) => {
    const token = verifyToken();
    if (req.query['hub.mode'] === 'subscribe' && token && req.query['hub.verify_token'] === token) {
        return res.status(200).send(req.query['hub.challenge']);
    }
    res.sendStatus(403);
});

router.post('/webhook/instagram', (req: Request, res: Response) => {
    if (!validSignature((req as any).rawBody, req.headers['x-hub-signature-256'] as string)) return res.sendStatus(401);
    // Acknowledge at once; Meta retries slow or failed deliveries.
    res.sendStatus(200);
    processInstagramWebhook(req.body).catch((error) => console.error('[Instagram DM] Webhook failed:', error.message));
});

export default router;
