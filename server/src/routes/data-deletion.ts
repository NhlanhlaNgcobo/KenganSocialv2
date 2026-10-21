import express from 'express';
import type { Request, Response } from 'express';
import admin from 'firebase-admin';
import { metaAppSecret } from '../config/meta';
import { parseSignedRequest } from '../services/meta/signed-request';
import { deleteUserAccount, getDeletionStatus, removeMetaUser } from '../services/data-deletion.service';

/**
 * Data deletion, as described at /data-deletion (client/src/content/legal.js).
 *  POST   /api/data-deletion/meta             Meta "Data Deletion Request" callback (signed_request)
 *  POST   /api/data-deletion/meta/deauthorize  Meta "Deauthorize" callback (signed_request)
 *  GET    /api/data-deletion/status/:code     public status of a request
 *  DELETE /api/data-deletion/account          signed-in user deletes their account { confirm: "DELETE" }
 */
const router = express.Router();

const statusPage = (code: string) => `${(process.env.CLIENT_URL || 'https://kengansocial.co.za').replace(/\/+$/, '')}/data-deletion/status?code=${encodeURIComponent(code)}`;

function metaUserFrom(req: Request) {
    return parseSignedRequest(req.body?.signed_request, metaAppSecret()).user_id;
}

router.post('/meta', async (req: Request, res: Response) => {
    let userId: string;
    try {
        userId = metaUserFrom(req);
    } catch (error: any) {
        console.warn('[Data deletion] Rejected Meta request:', error.message);
        return res.status(400).json({ error: 'INVALID_SIGNED_REQUEST' });
    }
    try {
        const code = await removeMetaUser(userId, 'meta_data_deletion');
        // The response format Meta requires: a status URL and a confirmation code.
        res.json({ url: statusPage(code), confirmation_code: code });
    } catch (error: any) {
        console.error('[Data deletion] Meta request failed:', error.message);
        res.status(500).json({ error: 'DELETION_FAILED' });
    }
});

router.post('/meta/deauthorize', async (req: Request, res: Response) => {
    let userId: string;
    try {
        userId = metaUserFrom(req);
    } catch (error: any) {
        console.warn('[Data deletion] Rejected Meta deauthorize:', error.message);
        return res.status(400).json({ error: 'INVALID_SIGNED_REQUEST' });
    }
    try {
        await removeMetaUser(userId, 'meta_deauthorize');
        res.sendStatus(200);
    } catch (error: any) {
        console.error('[Data deletion] Meta deauthorize failed:', error.message);
        res.sendStatus(500);
    }
});

router.get('/status/:code', async (req: Request, res: Response) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    if (!/^KS-[0-9A-F]{8}$/.test(code)) return res.status(404).json({ error: 'NOT_FOUND' });
    const status = await getDeletionStatus(code);
    if (!status) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json(status);
});

router.delete('/account', async (req: Request, res: Response) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'MISSING_TOKEN' });
    if (req.body?.confirm !== 'DELETE') return res.status(400).json({ error: 'CONFIRMATION_REQUIRED', message: 'Type DELETE to confirm.' });

    let uid: string;
    try {
        // checkRevoked: a stolen, revoked session can't delete the account.
        uid = (await admin.auth().verifyIdToken(header.slice(7), true)).uid;
    } catch {
        return res.status(401).json({ error: 'INVALID_TOKEN' });
    }

    try {
        const code = await deleteUserAccount(uid);
        console.log(`[Data deletion] Account ${uid} deleted (${code})`);
        res.json({ success: true, confirmationCode: code, statusUrl: statusPage(code) });
    } catch (error: any) {
        console.error(`[Data deletion] Account ${uid} deletion failed:`, error.message);
        const billing = String(error.message).startsWith('PAYSTACK') || error.response?.config?.url?.includes('paystack');
        res.status(billing ? 409 : 500).json({
            error: billing ? 'BILLING_CANCEL_FAILED' : 'DELETION_FAILED',
            message: billing
                ? `Your paid plan could not be cancelled automatically, so nothing was deleted. Email billing@kengansocial.co.za to cancel it, then try again.`
                : 'Your account could not be fully deleted. Please try again, or email privacy@kengansocial.co.za.',
        });
    }
});

export default router;
