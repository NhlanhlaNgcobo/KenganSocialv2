/**
 * Export of a person's data in KenganSocial (POPIA right of access). Deletion lives in
 * services/data-deletion.service.ts.
 *
 * Where data lives:
 *  - users/{uid} (+ consents), workspaces they own (ownerId) with all subcollections, membership in
 *    other workspaces (members array, members/{uid}).
 *  - Top-level documents keyed by workspaceId: scheduled_posts, render_jobs, ai_usage_logs,
 *    clip_projects, notifications, review_links; analytics/{workspaceId}/snapshots.
 *  - Top-level documents keyed by userId: manual_edit_jobs, video_analyses, render_jobs.
 *  - Files under "<workspaceId>/" and "workspaces/<workspaceId>/" in storage.
 */
import { Timestamp, DocumentReference } from 'firebase-admin/firestore';
import { db } from '../utils/firestore';

const BY_WORKSPACE = ['scheduled_posts', 'render_jobs', 'ai_usage_logs', 'clip_projects', 'notifications', 'review_links'];
const BY_USER = ['manual_edit_jobs', 'video_analyses', 'render_jobs'];
const SECRET_FIELDS = new Set(['accessToken', 'refreshToken', 'pageAccessToken', 'userToken', 'token', 'tokenHash']);
const MAX_EXPORT_DOCS = 20000;

function plain(value: any): any {
    if (value === null || value === undefined) return value ?? null;
    if (value instanceof Timestamp) return value.toDate().toISOString();
    if (value instanceof DocumentReference) return value.path;
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
        if (col.id === 'metaPending') continue; // short-lived sign-in candidates holding tokens
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
