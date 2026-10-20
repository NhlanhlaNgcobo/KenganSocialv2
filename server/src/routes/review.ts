import express, { Request } from 'express';
import rateLimit from 'express-rate-limit';
import admin from 'firebase-admin';
import { db } from '../utils/firestore';
import { fail, route } from '../services/marketing/http';
import { clean, hashToken, isToken, publicComment, publicVersions } from '../services/agency/review.js';

/**
 * Public client review page API (no account; access is the link's token).
 *  GET  /api/review/:token                                   the review: agency, message, videos, comments
 *  POST /api/review/:token/assets/:assetId/comments          { name, email?, text, timecode?, version }
 *  POST /api/review/:token/assets/:assetId/decision          { name, email?, decision: approved|changes_requested, note? }
 *
 * A link stops working when it expires or the agency revokes it. Clients only ever see the videos
 * in their review, and never the agency's internal data.
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

/** Remembers who has reviewed (names only), for the agency's list. */
async function noteReviewer(reviewRef: FirebaseFirestore.DocumentReference, name: string) {
    await reviewRef.update({ reviewers: admin.firestore.FieldValue.arrayUnion(name) }).catch(() => {});
}

router.get('/:token', readLimiter, route(async (req, res) => {
    const { ws, reviewRef, review } = await openReview(req);
    const [wsSnap, kitSnap] = await Promise.all([ws.get(), ws.collection('brandKit').doc('current').get()]);
    const client = review.clientId ? (await ws.collection('clients').doc(review.clientId).get()).data() : null;

    const assets = [];
    for (const id of review.assetIds || []) {
        const ref = ws.collection('library').doc(id);
        const snap = await ref.get();
        if (!snap.exists) continue;
        const a: any = snap.data();
        const comments = await ref.collection('comments').orderBy('createdAt', 'asc').limit(300).get();
        assets.push({
            id,
            title: a.title,
            caption: a.caption || '',
            platforms: a.platforms || [],
            dueDate: a.dueDate || null,
            status: a.status,
            currentVersion: a.currentVersion,
            approval: a.approval || null,
            versions: publicVersions(a),
            comments: comments.docs.map((c) => publicComment(c.id, c.data(), { forClient: true })),
        });
    }

    // Count views at most once per 10 minutes so refreshes don't inflate it.
    const last = review.lastViewedAt?.toDate ? review.lastViewedAt.toDate().getTime() : 0;
    if (Date.now() - last > 10 * 60 * 1000) reviewRef.update({ views: admin.firestore.FieldValue.increment(1), lastViewedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});

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
    const { ref, asset, reviewRef } = await reviewAsset(req);
    const who = reviewer(req.body);
    const text = clean(req.body?.text, 2000);
    if (!text) throw fail(400, 'Write your comment first.');
    const versions = (asset.versions || []).map((v: any) => v.n);
    const version = versions.includes(Number(req.body?.version)) ? Number(req.body.version) : asset.currentVersion;
    const duration = (asset.versions || []).find((v: any) => v.n === version)?.duration || 0;
    const raw = req.body?.timecode;
    const timecode = raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw)) ? null : Math.min(Math.max(0, Number(raw)), duration || Number(raw));
    const comment = { text, timecode: timecode === null ? null : Math.round(timecode * 10) / 10, version, author: { kind: 'client', name: who.name, email: who.email }, resolved: false, createdAt: admin.firestore.FieldValue.serverTimestamp() };
    const added = await ref.collection('comments').add(comment);
    await ref.update({
        commentCount: admin.firestore.FieldValue.increment(1),
        openComments: admin.firestore.FieldValue.increment(1),
        clientActivity: true,
        activity: [...(asset.activity || []).slice(-49), { type: 'comment', by: who.name, at: new Date().toISOString(), version }],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await noteReviewer(reviewRef, who.name);
    res.status(201).json({ comment: publicComment(added.id, { ...comment, createdAt: new Date().toISOString() }, { forClient: true }) });
}));

router.post('/:token/assets/:assetId/decision', writeLimiter, route(async (req, res) => {
    const { ref, asset, reviewRef } = await reviewAsset(req);
    const who = reviewer(req.body);
    const decision = req.body?.decision;
    if (!['approved', 'changes_requested'].includes(decision)) throw fail(400, 'Choose Approve or Request changes.');
    const note = clean(req.body?.note, 2000);
    if (decision === 'changes_requested' && !note) throw fail(400, 'Tell the team what to change.');
    const at = new Date().toISOString();
    const approval = { status: decision, version: asset.currentVersion, by: who.name, email: who.email, at, note };
    await ref.update({
        status: decision,
        approval,
        clientActivity: true,
        activity: [...(asset.activity || []).slice(-49), { type: decision, by: who.name, at, version: asset.currentVersion }],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // A change request is also a comment, so it appears in the conversation.
    if (note) {
        await ref.collection('comments').add({ text: note, timecode: null, version: asset.currentVersion, author: { kind: 'client', name: who.name, email: who.email }, resolved: false, decision, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        await ref.update({ commentCount: admin.firestore.FieldValue.increment(1), openComments: admin.firestore.FieldValue.increment(decision === 'changes_requested' ? 1 : 0) });
    }
    await noteReviewer(reviewRef, who.name);
    res.json({ approval, status: decision });
}));

export default router;
