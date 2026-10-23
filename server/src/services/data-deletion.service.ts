import axios from 'axios';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuth as firebaseAuth } from 'firebase-admin/auth';
import { db } from '../utils/firestore';
import { decrypt } from '../utils/tokenEncryption';
import { graphUrl } from '../config/meta';
import { deletePrefix } from './storage.service.js';
import { findConnections } from './connection-lookup';
import { purgePlatformAnalytics } from './analytics/analyticsService';

/**
 * Deleting data, as the Privacy Policy and Data Deletion page promise (client/src/content/legal.js):
 *  - disconnecting an account revokes our access where the platform allows it, deletes the token and
 *    the data fetched from that account;
 *  - Meta's data-deletion and deauthorize callbacks remove every connection of that Facebook user;
 *  - deleting an account removes the user's workspaces, their content and files, and the sign-in.
 * Each request is recorded in `deletionRequests/{code}` (no personal data, only a hash of the
 * platform user id) so people can check its status at /data-deletion/status.
 */

const workspaceRef = (workspaceId: string) => db.collection('workspaces').doc(workspaceId);

/** Collections under workspaces/{id} holding data fetched from a platform, tagged with `platform`. */
const PLATFORM_DATA_COLLECTIONS = ['dmQueue', 'inboxComments', 'dmThreads', 'dmOptOuts', 'adsActivity'];

/** Top-level collections whose documents carry the `workspaceId` they belong to. */
const WORKSPACE_KEYED_COLLECTIONS = ['scheduled_posts', 'render_jobs', 'manual_edit_jobs', 'video_analyses', 'notifications', 'ai_usage_logs', 'clip_projects', 'review_links'];

const META_PLATFORMS = new Set(['instagram', 'facebook', 'meta_ads']);

async function deleteQuery(query: FirebaseFirestore.Query): Promise<number> {
    let removed = 0;
    for (;;) {
        const snap = await query.limit(400).get();
        if (snap.empty) return removed;
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        removed += snap.size;
        if (snap.size < 400) return removed;
    }
}

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const newCode = () => `KS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

/** The user (not Page) token of a Meta connection: Instagram stores it as accessToken, Facebook as refreshToken. */
function metaUserToken(platform: string, conn: any): string | null {
    const enc = platform === 'facebook' ? conn.refreshToken : conn.accessToken;
    try {
        return enc ? decrypt(enc) : null;
    } catch {
        return null;
    }
}

/** Revokes our access with the platform. Best effort: returns false if the platform refused or has no revoke call. */
export async function revokePlatformAccess(platform: string, conn: any): Promise<boolean> {
    try {
        if (platform === 'youtube') {
            const token = decrypt(conn.refreshToken || conn.accessToken);
            await axios.post('https://oauth2.googleapis.com/revoke', new URLSearchParams({ token }), { timeout: 10000 });
            return true;
        }
        if (platform === 'tiktok') {
            await axios.post(
                'https://open.tiktokapis.com/v2/oauth/revoke/',
                new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY || '', client_secret: process.env.TIKTOK_CLIENT_SECRET || '', token: decrypt(conn.accessToken) }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
            );
            return true;
        }
        if (META_PLATFORMS.has(platform)) {
            const token = metaUserToken(platform, conn);
            if (!conn.metaUserId || !token) return false;
            await axios.delete(graphUrl(`${conn.metaUserId}/permissions`), { params: { access_token: token }, timeout: 10000 });
            return true;
        }
    } catch (error: any) {
        console.warn(`[Deletion] Revoking ${platform} access failed:`, error.response?.data?.error?.message || error.response?.data || error.message);
    }
    return false;
}

/**
 * Removes one connection: optionally revokes access with the platform, deletes the data fetched from
 * the account, then the connection (and its encrypted tokens).
 */
export async function deleteConnection(workspaceId: string, platform: string, { revoke }: { revoke: boolean }) {
    const ref = workspaceRef(workspaceId).collection('connections').doc(platform);
    const snap = await ref.get();
    if (!snap.exists) return { existed: false, revoked: false, itemsRemoved: 0 };
    const conn = snap.data()!;

    let revoked = false;
    if (revoke) {
        // Instagram, Facebook and Meta Ads can share one Facebook login; revoking it would also cut off the others.
        let shared = false;
        if (META_PLATFORMS.has(platform) && conn.metaUserId) {
            const siblings = await Promise.all([...META_PLATFORMS].filter((p) => p !== platform).map((p) => workspaceRef(workspaceId).collection('connections').doc(p).get()));
            shared = siblings.some((s) => s.exists && s.data()?.metaUserId === conn.metaUserId);
        }
        if (!shared) revoked = await revokePlatformAccess(platform, conn);
    }

    let itemsRemoved = 0;
    for (const name of PLATFORM_DATA_COLLECTIONS) {
        itemsRemoved += await deleteQuery(workspaceRef(workspaceId).collection(name).where('platform', '==', platform));
    }
    // Stored analytics snapshots keep a figure set per platform; remove this platform's.
    itemsRemoved += await purgePlatformAnalytics(workspaceId, platform);
    if (META_PLATFORMS.has(platform)) await workspaceRef(workspaceId).collection('metaPending').doc(platform).delete();
    await ref.delete();
    console.log(`[Deletion] ${platform} disconnected from workspace ${workspaceId} (revoked: ${revoked}, items removed: ${itemsRemoved})`);
    return { existed: true, revoked, itemsRemoved };
}

async function recordRequest(source: string, subject: string | null, details: Record<string, unknown>) {
    const code = newCode();
    const now = new Date().toISOString();
    await db.collection('deletionRequests').doc(code).set({
        code,
        source,
        status: 'completed',
        subjectHash: subject ? hash(subject) : null,
        requestedAt: now,
        completedAt: now,
        ...details,
    });
    return code;
}

/**
 * Meta data-deletion or deauthorize callback for one Facebook user (app-scoped id): removes every
 * Instagram and Facebook connection made with that login, in any workspace. Returns the confirmation code.
 */
/** TikTok told us (webhook authorization.removed) that a user removed our access: delete their connections. */
export async function removeTikTokUser(openId: string, reason: unknown) {
    const matches = await findConnections('accountId', openId, ['tiktok']);
    for (const m of matches) await deleteConnection(m.workspaceId, 'tiktok', { revoke: false });
    const code = await recordRequest('tiktok_authorization_removed', openId, { connectionsRemoved: matches.length, reason: reason ?? null });
    return { code, workspaceIds: matches.map((m) => m.workspaceId) };
}

export async function removeMetaUser(metaUserId: string, source: 'meta_data_deletion' | 'meta_deauthorize') {
    const matches = await findConnections('metaUserId', metaUserId, [...META_PLATFORMS]);
    let connectionsRemoved = 0;
    for (const m of matches) {
        const result = await deleteConnection(m.workspaceId, m.platform, { revoke: false });
        if (result.existed) connectionsRemoved++;
    }
    return recordRequest(source, metaUserId, { connectionsRemoved });
}

export async function getDeletionStatus(code: string) {
    const snap = await db.collection('deletionRequests').doc(code).get();
    if (!snap.exists) return null;
    const d = snap.data()!;
    return { code: d.code, status: d.status, requestedAt: d.requestedAt, completedAt: d.completedAt || null };
}

/** Stops a Paystack subscription so a deleted workspace is not charged again. Throws if it cannot. */
async function cancelPaystackSubscription(ws: any) {
    const code = ws.paystackSubscriptionCode;
    if (!code || ws.paymentStatus !== 'active') return;
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) throw new Error('PAYSTACK_NOT_CONFIGURED');
    const headers = { Authorization: `Bearer ${secret}` };
    const sub = await axios.get(`https://api.paystack.co/subscription/${encodeURIComponent(code)}`, { headers, timeout: 15000 });
    const token = sub.data?.data?.email_token;
    // Only active (or failing-payment) subscriptions renew; non-renewing, completed and cancelled ones are done.
    if (!['active', 'attention'].includes(sub.data?.data?.status)) return;
    if (!token) throw new Error('PAYSTACK_SUBSCRIPTION_TOKEN_MISSING');
    await axios.post('https://api.paystack.co/subscription/disable', { code, token }, { headers, timeout: 15000 });
}

/** Deletes a workspace: connections (revoked), platform data, jobs, schedules, files and the workspace itself. */
export async function deleteWorkspace(workspaceId: string) {
    const ref = workspaceRef(workspaceId);
    const ws = (await ref.get()).data() || {};
    await cancelPaystackSubscription(ws);

    const connections = await ref.collection('connections').get();
    for (const c of connections.docs) await deleteConnection(workspaceId, c.id, { revoke: true });

    for (const name of WORKSPACE_KEYED_COLLECTIONS) {
        await deleteQuery(db.collection(name).where('workspaceId', '==', workspaceId));
    }
    await db.recursiveDelete(db.collection('analytics').doc(workspaceId));
    await deletePrefix(`workspaces/${workspaceId}`);
    await deletePrefix(workspaceId); // files stored before uploads moved under workspaces/
    await db.recursiveDelete(ref);
    console.log(`[Deletion] Workspace ${workspaceId} deleted`);
}

/**
 * Deletes a user's account: every workspace they own (with its data), their membership of other
 * workspaces, their profile and their sign-in. Returns the confirmation code.
 */
export async function deleteUserAccount(uid: string) {
    const owned = await db.collection('workspaces').where('ownerId', '==', uid).get();
    // Cancel billing first for all of them, so a failure leaves everything intact.
    for (const ws of owned.docs) await cancelPaystackSubscription(ws.data());
    for (const ws of owned.docs) await deleteWorkspace(ws.id);

    const memberOf = await db.collection('workspaces').where('members', 'array-contains', uid).get();
    for (const ws of memberOf.docs) {
        await ws.ref.update({ members: FieldValue.arrayRemove(uid) });
        await ws.ref.collection('members').doc(uid).delete();
    }

    for (const name of ['manual_edit_jobs', 'render_jobs']) {
        await deleteQuery(db.collection(name).where('userId', '==', uid));
    }
    await db.recursiveDelete(db.collection('users').doc(uid));
    try {
        await firebaseAuth().deleteUser(uid);
    } catch (error: any) {
        if (error.code !== 'auth/user-not-found') throw error;
    }
    return recordRequest('account', uid, { workspacesDeleted: owned.size });
}
