/**
 * A person's data in KenganSocial: export (POPIA right of access) and deletion (POPIA s24, Meta
 * Platform Terms 3.d, YouTube API Services III.D, TikTok Developer Terms VI).
 *
 * Where data lives:
 *  - users/{uid} (+ consents), workspaces they own (ownerId) with all subcollections, membership in
 *    other workspaces (members array, members/{uid}).
 *  - Top-level documents keyed by workspaceId: scheduled_posts, render_jobs, ai_usage_logs,
 *    clip_projects, notifications, review_links; analytics/{workspaceId}/snapshots.
 *  - Top-level documents keyed by userId: manual_edit_jobs, video_analyses, render_jobs.
 *  - Files under "<workspaceId>/" and "workspaces/<workspaceId>/" in storage.
 */
import admin from 'firebase-admin';
import { db } from '../utils/firestore';
import { deletePrefix } from './storage.service.js';
import { recordDeletion, revokeConnection, unlinkMetaUser } from './platform-access';

const BY_WORKSPACE = ['scheduled_posts', 'render_jobs', 'ai_usage_logs', 'clip_projects', 'notifications', 'review_links'];
const BY_USER = ['manual_edit_jobs', 'video_analyses', 'render_jobs'];
const SECRET_FIELDS = new Set(['accessToken', 'refreshToken', 'pageAccessToken', 'token', 'tokenHash']);
const MAX_EXPORT_DOCS = 20000;

function plain(value: any): any {
    if (value === null || value === undefined) return value ?? null;
    if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString();
    if (value instanceof admin.firestore.DocumentReference) return value.path;
    if (Array.isArray(value)) return value.map(plain);
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !SECRET_FIELDS.has(k)).map(([k, v]) => [k, plain(v)]));
    return value;
}

/** A document and all its subcollections as JSON (tokens left out). */
async function exportDoc(ref: FirebaseFirestore.DocumentReference, budget: { left: number }): Promise<any> {
    const snap = await ref.get();
    budget.left -= 1;
    const out: any = { id: ref.id, data: snap.exists ? plain(snap.data()) : null };
    const subs = await ref.listCollections();
    for (const col of subs) {
        if (budget.left <= 0) break;
        const docs = await col.listDocuments();
        out[col.id] = [];
        for (const d of docs) {
            if (budget.left <= 0) break;
            out[col.id].push(await exportDoc(d, budget));
        }
    }
    return out;
}

async function ownedWorkspaces(uid: string) {
    const snap = await db.collection('workspaces').where('ownerId', '==', uid).get();
    return snap.docs;
}

/** Everything stored about the person, as one JSON object. */
export async function exportAccountData(uid: string) {
    const budget = { left: MAX_EXPORT_DOCS };
    const user = await exportDoc(db.collection('users').doc(uid), budget);
    const workspaces = [];
    for (const ws of await ownedWorkspaces(uid)) {
        const entry: any = await exportDoc(ws.ref, budget);
        for (const name of BY_WORKSPACE) {
            const docs = await db.collection(name).where('workspaceId', '==', ws.id).limit(2000).get();
            entry[name] = docs.docs.map((d) => ({ id: d.id, data: plain(d.data()) }));
        }
        entry.analytics = await exportDoc(db.collection('analytics').doc(ws.id), budget);
        workspaces.push(entry);
    }
    const jobs: Record<string, any[]> = {};
    for (const name of BY_USER) {
        const docs = await db.collection(name).where('userId', '==', uid).limit(2000).get();
        jobs[name] = docs.docs.map((d) => ({ id: d.id, data: plain(d.data()) }));
    }
    const member = await db.collection('workspaces').where('members', 'array-contains', uid).get();
    return {
        exportedAt: new Date().toISOString(),
        note: 'Access tokens for connected social accounts are never included. Media files are listed by URL inside the records.',
        truncated: budget.left <= 0,
        user,
        workspacesOwned: workspaces,
        workspacesMemberOf: member.docs.filter((d) => d.data().ownerId !== uid).map((d) => ({ id: d.id, name: d.data().name || null })),
        jobs,
    };
}

async function deleteWhere(collection: string, field: string, value: string) {
    let removed = 0;
    for (;;) {
        const snap = await db.collection(collection).where(field, '==', value).limit(300).get();
        if (snap.empty) return removed;
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        removed += snap.size;
    }
}

/** Revokes the workspace's social connections and deletes the workspace with all its data and files. */
export async function deleteWorkspaceData(workspaceId: string) {
    const ws = db.collection('workspaces').doc(workspaceId);
    const revoked = [];
    const conns = await ws.collection('connections').get();
    for (const c of conns.docs) {
        revoked.push(await revokeConnection(workspaceId, c.id, c.data()));
        await unlinkMetaUser(c.data().metaUserId, workspaceId, c.id);
    }
    let documents = 0;
    for (const name of BY_WORKSPACE) documents += await deleteWhere(name, 'workspaceId', workspaceId);
    await db.recursiveDelete(db.collection('analytics').doc(workspaceId));
    await db.recursiveDelete(ws);
    let files = 0;
    for (const prefix of [`${workspaceId}/`, `workspaces/${workspaceId}/`]) {
        try {
            files += await deletePrefix(prefix);
        } catch (err: any) {
            console.warn(`[Account] File delete for ${prefix} failed:`, err.message);
        }
    }
    return { revoked, documents, files };
}

/**
 * Deletes the person's account: owned workspaces (connections revoked first), membership in
 * other workspaces, their jobs, their user record and their sign-in. Returns a confirmation code.
 */
export async function deleteAccount(uid: string) {
    const summary: any = { workspaces: 0, documents: 0, files: 0, revoked: [] as unknown[] };
    for (const ws of await ownedWorkspaces(uid)) {
        const r = await deleteWorkspaceData(ws.id);
        summary.workspaces += 1;
        summary.documents += r.documents;
        summary.files += r.files;
        summary.revoked.push(...r.revoked);
    }
    const member = await db.collection('workspaces').where('members', 'array-contains', uid).get();
    for (const ws of member.docs) {
        await ws.ref.update({ members: admin.firestore.FieldValue.arrayRemove(uid) });
        await ws.ref.collection('members').doc(uid).delete().catch(() => {});
    }
    for (const name of BY_USER) summary.documents += await deleteWhere(name, 'userId', uid);
    await db.recursiveDelete(db.collection('users').doc(uid));
    try {
        await admin.auth().deleteUser(uid);
    } catch (err: any) {
        if (err.code !== 'auth/user-not-found') throw err;
    }
    const code = await recordDeletion('account', {
        workspaces: summary.workspaces,
        documents: summary.documents,
        files: summary.files,
        connectionsRevoked: summary.revoked.filter((r: any) => r.revoked).length,
    });
    return { code, ...summary };
}
