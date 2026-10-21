/**
 * Platform access lifecycle: revoking a connection at the provider, Meta signed requests (data
 * deletion and deauthorize callbacks), and the Meta-user → connection index those callbacks need.
 */
import axios from 'axios';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/firestore';
import { decrypt } from '../utils/tokenEncryption';

const env = (key: string) => process.env[key] ?? '';
const GRAPH = `https://graph.facebook.com/${env('META_GRAPH_VERSION') || 'v19.0'}`;
export const META_PLATFORMS = ['facebook', 'instagram'] as const;

const safeDecrypt = (value: unknown) => {
    if (typeof value !== 'string' || !value) return '';
    try {
        return decrypt(value);
    } catch {
        return '';
    }
};

// Meta signed requests: parsed in utils/signedRequest.ts (no Firebase dependency, so it is testable).
export { parseSignedRequest } from '../utils/signedRequest';

// ─── Meta user index ─────────────────────────────────────────────────────────
// Meta callbacks identify the person by their app-scoped user id; this maps it to the
// workspace connections they created (meta_user_links/{metaUserId}.links = ["<ws>/<platform>"]).

export async function linkMetaUser(metaUserId: string, workspaceId: string, platform: string) {
    if (!metaUserId) return;
    await db.collection('meta_user_links').doc(metaUserId).set({ links: FieldValue.arrayUnion(`${workspaceId}/${platform}`), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function unlinkMetaUser(metaUserId: string | undefined, workspaceId: string, platform: string) {
    if (!metaUserId) return;
    await db.collection('meta_user_links').doc(metaUserId).set({ links: FieldValue.arrayRemove(`${workspaceId}/${platform}`), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function metaUserLinks(metaUserId: string): Promise<{ workspaceId: string; platform: string }[]> {
    const snap = await db.collection('meta_user_links').doc(metaUserId).get();
    const links: string[] = snap.exists ? snap.data()?.links || [] : [];
    return links.map((l) => {
        const [workspaceId, platform] = l.split('/');
        return { workspaceId, platform };
    });
}

/** The app-scoped Meta user id of a user access token (stored so Meta callbacks can find the connection). */
export async function fetchMetaUserId(userToken: string): Promise<string> {
    try {
        const { data } = await axios.get(`${GRAPH}/me`, { params: { fields: 'id', access_token: userToken }, timeout: 15000 });
        return String(data?.id || '');
    } catch {
        return '';
    }
}

// ─── Revocation ──────────────────────────────────────────────────────────────

export interface RevokeResult {
    platform: string;
    revoked: boolean;
    webhooksRemoved?: boolean;
    note?: string;
}

/**
 * Revokes a connection at the provider (best effort; failures are reported, not thrown):
 *  - YouTube: Google token revocation (refresh token, which ends the whole grant).
 *  - TikTok: /v2/oauth/revoke/.
 *  - Facebook/Instagram: removes the Page webhook subscription, and the app's permissions for the
 *    person unless another Meta connection in the same workspace still relies on that login.
 */
export async function revokeConnection(workspaceId: string, platform: string, data: Record<string, any>): Promise<RevokeResult> {
    const result: RevokeResult = { platform, revoked: false };
    try {
        if (platform === 'youtube') {
            const token = safeDecrypt(data.refreshToken) || safeDecrypt(data.accessToken);
            if (token) {
                await axios.post('https://oauth2.googleapis.com/revoke', new URLSearchParams({ token }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
                result.revoked = true;
            }
        } else if (platform === 'tiktok') {
            const token = safeDecrypt(data.accessToken);
            if (token && env('TIKTOK_CLIENT_KEY') && env('TIKTOK_CLIENT_SECRET')) {
                await axios.post('https://open.tiktokapis.com/v2/oauth/revoke/', new URLSearchParams({ client_key: env('TIKTOK_CLIENT_KEY'), client_secret: env('TIKTOK_CLIENT_SECRET'), token }), {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: 15000,
                });
                result.revoked = true;
            }
        } else if (platform === 'facebook' || platform === 'instagram') {
            // Page webhooks (DMs, comments) stop first.
            const pageId = platform === 'facebook' ? data.pageId || data.accountId : data.pageId;
            const pageToken = platform === 'facebook' ? safeDecrypt(data.accessToken) : safeDecrypt(data.pageAccessToken);
            if (pageId && pageToken) {
                try {
                    await axios.delete(`${GRAPH}/${pageId}/subscribed_apps`, { params: { access_token: pageToken }, timeout: 15000 });
                    result.webhooksRemoved = true;
                } catch (err: any) {
                    result.note = `webhook: ${err.response?.data?.error?.message || err.message}`;
                }
            }
            // Facebook stores the user token as refreshToken; Instagram stores it as accessToken.
            const userToken = platform === 'facebook' ? safeDecrypt(data.refreshToken) : safeDecrypt(data.accessToken);
            const other = platform === 'facebook' ? 'instagram' : 'facebook';
            const otherSnap = await db.collection('workspaces').doc(workspaceId).collection('connections').doc(other).get();
            const shared = otherSnap.exists && data.metaUserId && otherSnap.data()?.metaUserId === data.metaUserId;
            if (userToken && !shared) {
                await axios.delete(`${GRAPH}/me/permissions`, { params: { access_token: userToken }, timeout: 15000 });
                result.revoked = true;
            } else if (shared) {
                result.note = `${result.note ? `${result.note}; ` : ''}kept the Meta login: your ${other} connection still uses it`;
            }
        }
    } catch (err: any) {
        result.note = `${result.note ? `${result.note}; ` : ''}${err.response?.data?.error?.message || err.response?.data?.error_description || err.message}`;
    }
    return result;
}

/**
 * Deletes data a Meta connection brought in for a workspace: the DM inbox queue and opt-outs, and
 * leads captured from Instagram/Facebook messages. Returns how many documents were removed.
 */
export async function deleteMetaPlatformData(workspaceId: string): Promise<number> {
    const ws = db.collection('workspaces').doc(workspaceId);
    let removed = 0;
    for (const name of ['dmQueue', 'dmOptOuts']) {
        const snap = await ws.collection(name).get();
        for (const doc of snap.docs) {
            await doc.ref.delete();
            removed += 1;
        }
    }
    const leads = await ws.collection('leads').get();
    for (const doc of leads.docs) {
        const source = String(doc.data().source || doc.data().platform || '').toLowerCase();
        if (source.includes('instagram') || source.includes('facebook') || source.includes('messenger')) {
            await doc.ref.delete();
            removed += 1;
        }
    }
    return removed;
}

/** Records a deletion request; returns its confirmation code (no personal data is stored with it). */
export async function recordDeletion(kind: 'meta-callback' | 'account' | 'disconnect', details: Record<string, unknown>) {
    const code = crypto.randomBytes(9).toString('base64url');
    await db.collection('data_deletion_requests').doc(code).set({ kind, status: 'completed', requestedAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp(), ...details });
    return code;
}
