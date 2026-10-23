import express, { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/firestore';
import { fail, route } from '../services/marketing/http';
import { appendActivity, auditTrail, clean, decisionConflict, hashToken, isToken, publicApproval, publicComment, publicVersions, reviewNotification, visibleToClient } from '../services/agency/review.js';

/**
 * Public client review page API (no account; access is the link's token).
 *  GET  /api/review/:token                                   the review: agency, message, videos, comments
 *  POST /api/review/:token/assets/:assetId/comments          { name, email?, text, timecode?, version }
 *  POST /api/review/:token/assets/:assetId/decision          { name, email?, decision: approved|changes_requested, note?, version }
 *
 * A link stops working when it expires or the agency revokes it. Clients only ever see the videos
 * in their review, and never the agency's internal data (internal notes, reviewer emails, audit).
 * Each comment and decision stores a hashed IP and user agent (server-side only) for the audit
 * trail, and drops an in-app notification for the agency in the top-level `notifications`.
 *
 * Rate limits use express-rate-limit's in-memory store: per instance, which is right for a single
 * container. Running several instances needs a shared store (Redis) for the limits to hold.
 */

const router = express.Router();

const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Wait a minute and try again.' } });
const writeLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many comments in a short time. Wait a few minutes.' } });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const iso = (v: any) => (v?.toDate ? v.toDate().toISOString() : v || null);

async function openReview(req: Request) {
    const token = String(req.params.token || '');
    if (!isToken(token)) throw fail(404, 'This review link is not valid.');
    const link = await db.collection('review_links').doc(hashToken(token)).get();
    const l: any = link.data();
    if (!link.exists || !l?.workspaceId) throw fail(404, 'This review link is not valid.');
    if (l.revoked) throw fail(410, 'This review link has been switched off by the agency. Ask them for a new one.');
    if (l.expiresAt && Date.parse(l.expiresAt) < Date.now()) throw fail(410, 'This review link has expired. Ask the agency for a new one.');
    (req as any).mediaWorkspaceId = l.workspaceId;
    const ws = db.collection('workspaces').doc(l.workspaceId);
    const reviewRef = ws.collection('reviews').doc(l.reviewId);
    const review = await reviewRef.get();
    if (!review.exists || review.data()?.revoked) throw fail(410, 'This review link has been switched off by the agency.');
    return { ws, reviewRef, review: review.data() as any };
}

async function reviewAsset(req: Request) {
    const ctx = await openReview(req);
    const assetId = String(req.params.assetId || '');
    if (!(ctx.review.assetIds || []).includes(assetId)) throw fail(404, 'That video is not part of this review.');
    const ref = ctx.ws.collection('library').doc(assetId);
    const snap = await ref.get();
    if (!snap.exists) throw fail(404, 'That video has been removed by the agency.');
    return { ...ctx, ref, asset: snap.data() as any };
}

function reviewer(body: any) {
    const name = clean(body?.name, 60);
    if (!name) throw fail(400, 'Add your name so the team knows who left this.');
    const email = clean(body?.email, 120);
    return { name, email: EMAIL.test(email) ? email : null };
}

const audit = (req: Request) => auditTrail(req.ip, req.get('user-agent'));
const notificationsCol = () => db.collection('notifications');

/** Remembers who has reviewed (names only), for the agency's list. */
async function noteReviewer(reviewRef: FirebaseFirestore.DocumentReference, name: string) {
    await reviewRef.update({ reviewers: FieldValue.arrayUnion(name) }).catch(() => {});
}

router.get('/:token', readLimiter, route(async (req, res) => {
    const { ws, reviewRef, review } = await openReview(req);
    const [wsSnap, kitSnap, clientSnap] = await Promise.all([ws.get(), ws.collection('brandKit').doc('current').get(), review.clientId ? ws.collection('clients').doc(review.clientId).get() : null]);
    const client: any = clientSnap?.data() || null;

    // Read the videos in parallel; one the agency deleted is skipped.
    const assets = (
        await Promise.all(
            (review.assetIds || []).map(async (id: string) => {
                const ref = ws.collection('library').doc(id);
                const [snap, comments] = await Promise.all([ref.get(), ref.collection('comments').orderBy('createdAt', 'asc').limit(300).get()]);
                if (!snap.exists) return null;
                const a: any = snap.data();
                return {
                    id,
                    title: a.title,
                    caption: a.caption || '',
                    platforms: a.platforms || [],
                    dueDate: a.dueDate || null,
                    status: a.status,
                    currentVersion: a.currentVersion,
                    approval: publicApproval(a.approval),
                    versions: publicVersions(a),
                    comments: comments.docs.filter((c) => visibleToClient(c.data())).map((c) => publicComment(c.id, c.data(), { forClient: true })),
                };
            })
        )
    ).filter(Boolean);

    // Count views at most once per 10 minutes so refreshes don't inflate it.
    const last = review.lastViewedAt?.toDate ? review.lastViewedAt.toDate().getTime() : 0;
    if (Date.now() - last > 10 * 60 * 1000) reviewRef.update({ views: FieldValue.increment(1), lastViewedAt: FieldValue.serverTimestamp() }).catch(() => {});

    const kit: any = kitSnap.data() || {};
    res.set('Cache-Control', 'no-store');
    res.json({
        agency: { name: kit.name || wsSnap.data()?.name || 'Your agency', logo: kit.logo?.primary || null, color: kit.colors?.primary || null },
        review: {
            title: review.title,
            message: review.message || '',
            clientName: client?.name || null,
            allowDownload: !!review.allowDownload,
            expiresAt: iso(review.expiresAt),
            sentBy: review.createdByName || '',
        },
        assets,
    });
}));

router.post('/:token/assets/:assetId/comments', writeLimiter, route(async (req, res) => {
    const { ref, reviewRef } = await reviewAsset(req);
    const who = reviewer(req.body);
    const text = clean(req.body?.text, 2000);
    if (!text) throw fail(400, 'Write your comment first.');
    const workspaceId = (req as any).mediaWorkspaceId;
    const commentRef = ref.collection('comments').doc();
    // One transaction: the comment, the counters, the activity log and the agency's notification.
    const comment = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw fail(404, 'That video has been removed by the agency.');
        const asset: any = snap.data();
        const versions = (asset.versions || []).map((v: any) => v.n);
        const version = versions.includes(Number(req.body?.version)) ? Number(req.body.version) : asset.currentVersion;
        const duration = (asset.versions || []).find((v: any) => v.n === version)?.duration || 0;
        const raw = req.body?.timecode;
        const timecode = raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw)) ? null : Math.min(Math.max(0, Number(raw)), duration || Number(raw));
        const data = { text, timecode: timecode === null ? null : Math.round(timecode * 10) / 10, version, author: { kind: 'client', name: who.name, email: who.email }, resolved: false, internal: false, audit: audit(req), createdAt: FieldValue.serverTimestamp() };
        tx.create(commentRef, data);
        tx.update(ref, {
            commentCount: FieldValue.increment(1),
            openComments: FieldValue.increment(1),
            clientActivity: true,
            activity: appendActivity(asset.activity, { type: 'comment', by: who.name, at: new Date().toISOString(), version }),
            updatedAt: FieldValue.serverTimestamp(),
        });
        tx.create(notificationsCol().doc(), {
            ...reviewNotification({ workspaceId, kind: 'comment', assetId: ref.id, assetTitle: asset.title, clientId: asset.clientId, by: who.name, version, text }),
            createdAt: FieldValue.serverTimestamp(),
        });
        return data;
    });
    await noteReviewer(reviewRef, who.name);
    res.status(201).json({ comment: publicComment(commentRef.id, { ...comment, createdAt: new Date().toISOString() }, { forClient: true }) });
}));

router.post('/:token/assets/:assetId/decision', writeLimiter, route(async (req, res) => {
    const { ref, reviewRef } = await reviewAsset(req);
    const who = reviewer(req.body);
    const decision = req.body?.decision;
    if (!['approved', 'changes_requested'].includes(decision)) throw fail(400, 'Choose Approve or Request changes.');
    const note = clean(req.body?.note, 2000);
    if (decision === 'changes_requested' && !note) throw fail(400, 'Tell the team what to change.');
    const workspaceId = (req as any).mediaWorkspaceId;
    const trail = audit(req);
    // Checked and written in one transaction, so a new upload or a second click cannot slip in between.
    const approval = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw fail(404, 'That video has been removed by the agency.');
        const asset: any = snap.data();
        const conflict = decisionConflict(asset, decision, req.body?.version);
        if (conflict) throw fail(conflict.status, conflict.message);
        const at = new Date().toISOString();
        const version = asset.currentVersion;
        const record = { status: decision, version, by: who.name, email: who.email, at, note, audit: trail };
        // A change request is also a comment, so it appears in the conversation.
        if (note) {
            tx.create(ref.collection('comments').doc(), { text: note, timecode: null, version, author: { kind: 'client', name: who.name, email: who.email }, resolved: false, internal: false, decision, audit: trail, createdAt: FieldValue.serverTimestamp() });
        }
        tx.update(ref, {
            status: decision,
            approval: record,
            clientActivity: true,
            activity: appendActivity(asset.activity, { type: decision, by: who.name, at, version }),
            ...(note ? { commentCount: FieldValue.increment(1), openComments: FieldValue.increment(decision === 'changes_requested' ? 1 : 0) } : {}),
            updatedAt: FieldValue.serverTimestamp(),
        });
        tx.create(notificationsCol().doc(), {
            ...reviewNotification({ workspaceId, kind: decision, assetId: ref.id, assetTitle: asset.title, clientId: asset.clientId, by: who.name, version, text: note }),
            createdAt: FieldValue.serverTimestamp(),
        });
        return record;
    });
    await noteReviewer(reviewRef, who.name);
    res.json({ approval: publicApproval(approval), status: decision });
}));

export default router;
