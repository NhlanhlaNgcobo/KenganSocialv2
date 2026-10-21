/**
 * Privacy and platform-compliance endpoints (mounted at /api/privacy):
 *
 *  POST /meta/data-deletion   Meta "Data Deletion Request" callback (signed_request). Deletes the
 *                             person's Meta connections and the data they brought in; answers
 *                             { url, confirmation_code } as Meta requires.
 *  POST /meta/deauthorize     Meta "Deauthorize" callback: the person removed the app on
 *                             Facebook/Instagram. Their connections are marked revoked, tokens dropped.
 *  GET  /deletion-status/:code  Public status of a deletion request (the page Meta links to).
 *  GET  /export               Signed in: download everything stored about you (JSON).
 *  DELETE /account            Signed in: delete your account and all its data. Body { confirm: "DELETE" }.
 */
import express from 'express';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/firestore';
import { requireAuth } from '../middleware/auth.middleware.js';
import { deleteMetaPlatformData, metaUserLinks, parseSignedRequest, recordDeletion, revokeConnection } from '../services/platform-access';
import { deleteAccount, exportAccountData } from '../services/account-data';

const router = express.Router();
const clientUrl = () => (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
const limiter = rateLimit({ windowMs: 60 * 1000, max: 30 });

router.post('/meta/data-deletion', limiter, async (req: Request, res: Response) => {
    const payload = parseSignedRequest(req.body?.signed_request);
    if (!payload) return res.status(400).json({ error: 'Invalid signed_request.' });
    try {
        let connections = 0;
        let documents = 0;
        for (const { workspaceId, platform } of await metaUserLinks(payload.user_id)) {
            const ref = db.collection('workspaces').doc(workspaceId).collection('connections').doc(platform);
            const snap = await ref.get();
            if (!snap.exists) continue;
            await revokeConnection(workspaceId, platform, snap.data()!);
            if (platform === 'instagram') documents += await deleteMetaPlatformData(workspaceId);
            await ref.delete();
            connections += 1;
        }
        await db.collection('meta_user_links').doc(payload.user_id).delete();
        const code = await recordDeletion('meta-callback', { connections, documents });
        res.json({ url: `${clientUrl()}/data-deletion/status?code=${code}`, confirmation_code: code });
    } catch (err: any) {
        console.error('[Privacy] Meta data deletion failed:', err.message);
        res.status(500).json({ error: 'Deletion could not be completed. It will be retried.' });
    }
});

router.post('/meta/deauthorize', limiter, async (req: Request, res: Response) => {
    const payload = parseSignedRequest(req.body?.signed_request);
    if (!payload) return res.status(400).json({ error: 'Invalid signed_request.' });
    try {
        for (const { workspaceId, platform } of await metaUserLinks(payload.user_id)) {
            const ref = db.collection('workspaces').doc(workspaceId).collection('connections').doc(platform);
            if (!(await ref.get()).exists) continue;
            await ref.update({
                status: 'revoked',
                revokedAt: FieldValue.serverTimestamp(),
                accessToken: FieldValue.delete(),
                refreshToken: FieldValue.delete(),
                pageAccessToken: FieldValue.delete(),
            });
        }
        res.json({ success: true });
    } catch (err: any) {
        console.error('[Privacy] Meta deauthorize failed:', err.message);
        res.status(500).json({ error: 'Could not record the removal.' });
    }
});

router.get('/deletion-status/:code', limiter, async (req: Request, res: Response) => {
    const code = String(req.params.code || '');
    if (!/^[\w-]{6,40}$/.test(code)) return res.status(400).json({ error: 'Invalid confirmation code.' });
    const snap = await db.collection('data_deletion_requests').doc(code).get();
    if (!snap.exists) return res.status(404).json({ error: 'No deletion request has this confirmation code.' });
    const d = snap.data()!;
    res.json({
        code,
        status: d.status,
        kind: d.kind,
        requestedAt: d.requestedAt?.toDate?.().toISOString() || null,
        completedAt: d.completedAt?.toDate?.().toISOString() || null,
        reason: d.reason || null,
    });
});

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

router.delete('/account', requireAuth, async (req: Request, res: Response) => {
    if (req.body?.confirm !== 'DELETE') return res.status(400).json({ error: 'Type DELETE to confirm.' });
    try {
        const result = await deleteAccount((req as any).user.uid);
        res.json({ success: true, confirmationCode: result.code, workspaces: result.workspaces, documents: result.documents, files: result.files });
    } catch (err: any) {
        console.error('[Privacy] Account deletion failed:', err.message);
        res.status(500).json({ error: 'Your account could not be fully deleted. Email privacy@kengansocial.com and we will finish it.' });
    }
});

export default router;
