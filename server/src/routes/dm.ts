import express, { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { db } from '../utils/firestore';
import { withWorkspace } from '../middleware/withWorkspace';
import { DmError, PRIVATE_REPLY_WINDOW_MS, isMetaChannel, replyWindowEndsAt, sendDM } from '../services/meta/messaging';
import { privateReply, publicReply } from '../services/meta/comments';

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
const millis = (v: any) => (typeof v?.toMillis === 'function' ? v.toMillis() : Number(v) || null);

// ─────────────────────────────────────────────────────────────────────────────
// KEYWORD AUTO-REPLIES (Instagram DMs and Facebook Messenger)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/automations', ...guard, route(async (req, res) => {
    if ((req as any).plan === 'starter') return res.status(402).json({ error: 'Upgrade to Nano or higher to create auto-replies.' });
    const { platform, keyword, replyTemplate } = req.body || {};
    if (platform !== undefined && !isMetaChannel(platform)) return res.status(400).json({ error: 'Auto-replies work on Instagram and Facebook Messenger.' });
    if (!String(keyword || '').trim() || !String(replyTemplate || '').trim()) {
        return res.status(400).json({ error: 'Add a keyword and a reply.' });
    }
    const data = {
        platform: platform || 'instagram',
        trigger: 'keyword',
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
// APPROVAL QUEUE (messages the automations didn't answer)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/queue', ...guard, route(async (req, res) => {
    const plan = (req as any).plan;
    if (plan === 'starter' || plan === 'nano') return res.status(402).json({ error: 'Upgrade to Creator or higher for the reply queue.' });
    const snap = await ws(req).collection('dmQueue').where('status', '==', 'pending').limit(50).get();
    const queue = await Promise.all(
        snap.docs.map(async (d) => {
            const data = d.data();
            const platform = isMetaChannel(data.platform) ? data.platform : 'instagram';
            // The window moves when the person writes again, so read it from the thread, not the queued copy.
            const windowEndsAt = (await replyWindowEndsAt((req as any).workspaceId, platform, data.senderId)) || data.windowEndsAt || null;
            return { id: d.id, ...data, platform, receivedAt: millis(data.receivedAt), windowEndsAt };
        })
    );
    queue.sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0));
    res.json({ success: true, queue });
}));

async function sendQueued(req: Request, res: Response, text?: string) {
    const ref = ws(req).collection('dmQueue').doc(String(req.params.id));
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Message not found' });
    const data = doc.data()!;
    if (data.status !== 'pending') return res.status(409).json({ error: 'This message was already handled.' });
    const reply = String(text ?? data.aiSuggestedReply ?? '').trim();
    const platform = isMetaChannel(data.platform) ? data.platform : 'instagram';
    await sendDM((req as any).workspaceId, platform, data.senderId, reply);
    await ref.update({ status: 'sent', aiSuggestedReply: reply, sentBy: (req as any).uid || null, sentAt: admin.firestore.FieldValue.serverTimestamp() });
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
// COMMENTS (Instagram media and Facebook Page posts)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/comments', ...guard, route(async (req, res) => {
    const status = req.query.status === 'done' ? ['replied', 'dismissed'] : ['open'];
    const snap = await ws(req).collection('inboxComments').where('status', 'in', status).limit(100).get();
    const comments = snap.docs
        .map((d) => {
            const c = d.data();
            return {
                id: d.id,
                platform: c.platform,
                commentId: c.commentId,
                postId: c.postId,
                fromName: c.fromName,
                fromUsername: c.fromUsername,
                text: c.text,
                status: c.status,
                createdAt: c.createdAt,
                replies: c.replies || [],
                automation: c.automation || null,
                privateReplySent: !!c.privateReplySentAt,
                privateReplyOpen: !c.privateReplySentAt && c.createdAt > Date.now() - PRIVATE_REPLY_WINDOW_MS,
            };
        })
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ success: true, comments });
}));

async function loadComment(req: Request) {
    const ref = ws(req).collection('inboxComments').doc(String(req.params.id));
    const snap = await ref.get();
    if (!snap.exists) throw new DmError('Comment not found.', 404);
    return { ref, data: snap.data()! };
}

const replyText = (req: Request) => {
    const text = String(req.body?.text || '').trim();
    if (!text) throw new DmError('Write a reply first.');
    return text.slice(0, 1000);
};

router.post('/comments/:id/reply', ...guard, route(async (req, res) => {
    const { data } = await loadComment(req);
    await publicReply((req as any).workspaceId, data as any, replyText(req), { by: 'user', uid: (req as any).uid });
    res.json({ success: true });
}));

router.post('/comments/:id/private-reply', ...guard, route(async (req, res) => {
    const { data } = await loadComment(req);
    await privateReply((req as any).workspaceId, data as any, replyText(req), { by: 'user', uid: (req as any).uid });
    res.json({ success: true });
}));

router.post('/comments/:id/dismiss', ...guard, route(async (req, res) => {
    const { ref } = await loadComment(req);
    await ref.update({ status: 'dismissed' });
    res.json({ success: true });
}));

// Incoming messages and comments arrive on the shared Meta webhook: /api/webhooks/meta (routes/webhooks.routes.js).

export default router;
