import express, { Request } from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs';
import admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../utils/firestore';
import { withWorkspace } from '../middleware/withWorkspace';
import { APPROVAL_PLANS, MAX_CLIENTS, PLAN_LIMITS } from '../utils/planLimits';
import { fail, requireEditor, requireWorkspace, route } from '../services/marketing/http';
import { deleteVersions, MAX_VIDEO_BYTES, storeVideo, VIDEO_TYPES } from '../services/agency/media.js';
import { assetSummary, clean, EXPIRY_DAYS, hashToken, newToken, PLATFORMS, publicComment, publicVersions, STATUSES } from '../services/agency/review.js';

/**
 * Clients & approvals (for agencies and anyone who needs sign-off before posting).
 *
 *  Clients
 *   GET    /api/agency/clients                 clients with asset counts per status
 *   POST   /api/agency/clients                 { name, contactName, contactEmail, contactPhone, color }
 *   PATCH  /api/agency/clients/:id
 *   DELETE /api/agency/clients/:id             only when it has no videos
 *  Library
 *   GET    /api/agency/library                 all videos (+ storage used / limit)
 *   POST   /api/agency/library/upload          multipart "file" + { clientId, title, assetId?, note } → new video or new version
 *   POST   /api/agency/library/from-render     { filename, title, clientId, caption } → save a clip/launch video
 *   GET    /api/agency/library/:id             video, versions, comments, reviews it is in
 *   PATCH  /api/agency/library/:id             { title, caption, platforms, dueDate, clientId, status }
 *   DELETE /api/agency/library/:id
 *   POST   /api/agency/library/:id/comments    { text, timecode, version }   team reply
 *   PATCH  /api/agency/library/:id/comments/:commentId   { resolved }
 *  Review links
 *   GET    /api/agency/reviews
 *   POST   /api/agency/reviews                 { assetIds, title, message, expiresInDays, allowDownload } → { review, url }
 *   DELETE /api/agency/reviews/:id             revoke
 *
 * Data (server-only, Firestore rules deny clients): workspaces/{ws}/clients, /library (+ /comments),
 * /reviews; review_links/{sha256(token)} → { workspaceId, reviewId } for the public review page.
 */

const router = express.Router();

/** Clients & approvals is part of Creator Pro, Agency and Enterprise. */
function requireApprovalsPlan(req: Request, res: express.Response, next: express.NextFunction) {
    if ((APPROVAL_PLANS as readonly string[]).includes((req as any).plan || 'starter')) return next();
    res.status(402).json({
        error: 'Clients & approvals is part of the Creator Pro, Agency and Enterprise plans. Upgrade to send videos to clients for approval.',
        code: 'UPGRADE_REQUIRED',
        upgradeUrl: '/dashboard/billing',
    });
}

router.use(withWorkspace, requireWorkspace, requireApprovalsPlan);

const RENDER_DIR = path.join(os.tmpdir(), 'kengan-renders');
const upload = multer({
    dest: os.tmpdir(),
    limits: { fileSize: MAX_VIDEO_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, VIDEO_TYPES.includes(file.mimetype)),
});

const ws = (req: Request) => db.collection('workspaces').doc((req as any).workspaceId);
const clientsCol = (req: Request) => ws(req).collection('clients');
const libraryCol = (req: Request) => ws(req).collection('library');
const reviewsCol = (req: Request) => ws(req).collection('reviews');
const now = () => admin.firestore.FieldValue.serverTimestamp();
const iso = (v: any) => (v?.toDate ? v.toDate().toISOString() : v || null);
const HEX = /^#[0-9a-f]{6}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function appUrl() {
    return (process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

async function memberName(req: Request) {
    const user = await db.collection('users').doc((req as any).uid).get();
    const d: any = user.data() || {};
    return clean(d.displayName || d.fullName || d.name || d.email || 'Team member', 60);
}

function storageLimitBytes(req: Request) {
    const gb = (PLAN_LIMITS as any)[(req as any).plan || 'starter']?.storageGB ?? 0.5;
    return gb * 1024 * 1024 * 1024;
}

async function storageUsed(req: Request) {
    const snap = await ws(req).get();
    return Number(snap.data()?.libraryBytes || 0);
}

async function loadAsset(req: Request) {
    const ref = libraryCol(req).doc(String(req.params.id));
    const snap = await ref.get();
    if (!snap.exists) throw fail(404, 'Video not found.');
    return { ref, data: snap.data() as any };
}

async function validClientId(req: Request, clientId: unknown) {
    if (clientId == null || clientId === '') return null;
    const id = String(clientId);
    const doc = await clientsCol(req).doc(id).get();
    if (!doc.exists) throw fail(400, 'That client does not exist.');
    return id;
}

// ---------------------------------------------------------------- Clients

router.get('/clients', route(async (req, res) => {
    const [clients, assets] = await Promise.all([clientsCol(req).limit(500).get(), libraryCol(req).select('clientId', 'status', 'clientActivity').limit(2000).get()]);
    const counts: Record<string, any> = {};
    for (const a of assets.docs) {
        const d: any = a.data();
        const key = d.clientId || '_none';
        counts[key] = counts[key] || { total: 0, draft: 0, in_review: 0, changes_requested: 0, approved: 0, newActivity: 0 };
        counts[key].total += 1;
        counts[key][d.status] = (counts[key][d.status] || 0) + 1;
        if (d.clientActivity) counts[key].newActivity += 1;
    }
    const plan = (req as any).plan || 'starter';
    res.json({
        clients: clients.docs
            .map((d) => ({ id: d.id, ...(d.data() as any), createdAt: iso(d.data().createdAt), counts: counts[d.id] || { total: 0 } }))
            .sort((a: any, b: any) => a.name.localeCompare(b.name)),
        unassigned: counts._none || { total: 0 },
        maxClients: (MAX_CLIENTS as any)[plan] ?? 1,
    });
}));

function clientFields(body: any, partial: boolean) {
    const out: Record<string, unknown> = {};
    if (!partial || body.name !== undefined) {
        const name = clean(body.name, 80);
        if (!name) throw fail(400, 'Give the client a name.');
        out.name = name;
    }
    if (body.contactName !== undefined) out.contactName = clean(body.contactName, 80);
    if (body.contactEmail !== undefined) {
        const email = clean(body.contactEmail, 120);
        if (email && !EMAIL.test(email)) throw fail(400, 'That email address does not look right.');
        out.contactEmail = email;
    }
    if (body.contactPhone !== undefined) out.contactPhone = clean(body.contactPhone, 30).replace(/[^\d+ ]/g, '');
    if (body.color !== undefined) out.color = HEX.test(body.color) ? body.color : '#8b5cf6';
    return out;
}

router.post('/clients', requireEditor, route(async (req, res) => {
    const plan = (req as any).plan || 'starter';
    const max = (MAX_CLIENTS as any)[plan] ?? 1;
    if (max !== -1) {
        const existing = await clientsCol(req).count().get();
        if (existing.data().count >= max) throw fail(402, `Your plan includes ${max} client${max === 1 ? '' : 's'}. Upgrade to add more.`);
    }
    const data = { color: '#8b5cf6', contactName: '', contactEmail: '', contactPhone: '', ...clientFields(req.body || {}, false), createdAt: now(), createdBy: (req as any).uid };
    const ref = await clientsCol(req).add(data);
    res.status(201).json({ client: { id: ref.id, ...data, createdAt: new Date().toISOString(), counts: { total: 0 } } });
}));

router.patch('/clients/:id', requireEditor, route(async (req, res) => {
    const ref = clientsCol(req).doc(String(req.params.id));
    if (!(await ref.get()).exists) throw fail(404, 'Client not found.');
    const fields = clientFields(req.body || {}, true);
    await ref.update(fields);
    res.json({ client: { id: ref.id, ...((await ref.get()).data() as any) } });
}));

router.delete('/clients/:id', requireEditor, route(async (req, res) => {
    const id = String(req.params.id);
    const used = await libraryCol(req).where('clientId', '==', id).limit(1).get();
    if (!used.empty) throw fail(409, 'Move or delete this client’s videos first.');
    await clientsCol(req).doc(id).delete();
    res.json({ success: true });
}));

// ---------------------------------------------------------------- Library

router.get('/library', route(async (req, res) => {
    const snap = await libraryCol(req).limit(1000).get();
    const assets = snap.docs.map((d) => assetSummary(d.id, d.data())).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    res.json({ assets, storage: { usedBytes: await storageUsed(req), limitBytes: storageLimitBytes(req) } });
}));

/** Adds a stored video as a new asset, or as the next version of an existing one. */
async function addVersion(req: Request, { filePath, mimeType, title, clientId, assetId, note, caption }: any) {
    const bytes = fs.statSync(filePath).size;
    const used = await storageUsed(req);
    if (used + bytes > storageLimitBytes(req)) {
        throw fail(402, `This video needs ${(bytes / 1e6).toFixed(0)} MB and your plan's storage is almost full (${(used / 1e9).toFixed(2)} of ${(storageLimitBytes(req) / 1e9).toFixed(1)} GB). Delete old videos or upgrade.`);
    }
    const uploaderName = await memberName(req);

    let ref;
    let existing: any = null;
    if (assetId) {
        ref = libraryCol(req).doc(String(assetId));
        const snap = await ref.get();
        if (!snap.exists) throw fail(404, 'Video not found.');
        existing = snap.data();
    } else {
        ref = libraryCol(req).doc(uuidv4());
    }

    const stored = await storeVideo({ filePath, mimeType, workspaceId: (req as any).workspaceId, assetId: ref.id });
    const n = existing ? Math.max(0, ...(existing.versions || []).map((v: any) => v.n)) + 1 : 1;
    const version = { n, ...stored, note: clean(note, 300), uploadedAt: new Date().toISOString(), uploadedBy: (req as any).uid, uploadedByName: uploaderName };
    const activity = { type: existing ? 'new_version' : 'uploaded', by: uploaderName, at: new Date().toISOString(), version: n };

    if (existing) {
        // A new version goes back into review if it was out with the client; approval is per version.
        const wasOut = ['in_review', 'changes_requested', 'approved'].includes(existing.status);
        await ref.update({
            versions: admin.firestore.FieldValue.arrayUnion(version),
            currentVersion: n,
            status: wasOut ? 'in_review' : existing.status,
            approval: null,
            activity: [...(existing.activity || []).slice(-49), activity],
            updatedAt: now(),
        });
    } else {
        await ref.set({
            title: clean(title, 120) || 'Untitled video',
            clientId,
            status: 'draft',
            caption: clean(caption, 2200),
            platforms: [],
            dueDate: null,
            versions: [version],
            currentVersion: 1,
            commentCount: 0,
            openComments: 0,
            clientActivity: false,
            approval: null,
            activity: [activity],
            createdBy: (req as any).uid,
            createdAt: now(),
            updatedAt: now(),
        });
    }
    await ws(req).set({ libraryBytes: admin.firestore.FieldValue.increment(stored.bytes) }, { merge: true });
    return assetSummary(ref.id, (await ref.get()).data());
}

router.post('/library/upload', requireEditor, upload.single('file'), route(async (req, res) => {
    const file = (req as any).file;
    if (!file) throw fail(400, 'Choose a video file (MP4, MOV or WebM, up to 2 GB).');
    try {
        const clientId = await validClientId(req, req.body?.clientId);
        const asset = await addVersion(req, {
            filePath: file.path,
            mimeType: file.mimetype,
            title: req.body?.title || file.originalname.replace(/\.[^.]+$/, ''),
            clientId,
            assetId: req.body?.assetId || null,
            note: req.body?.note,
            caption: req.body?.caption,
        });
        res.status(201).json({ asset });
    } finally {
        fs.rm(file.path, { force: true }, () => {});
    }
}));

/** Saves a finished clip or launch/tutorial video (rendered by this workspace) into the library. */
router.post('/library/from-render', requireEditor, route(async (req, res) => {
    const filename = path.basename(String(req.body?.filename || req.body?.downloadUrl || ''));
    if (!/^[\w.-]+\.mp4$/.test(filename)) throw fail(400, 'Unknown video.');
    const jobs = await db.collection('manual_edit_jobs').where('outputFilename', '==', filename).limit(5).get();
    const owned = jobs.docs.some((d) => d.data().workspaceId === (req as any).workspaceId);
    if (!owned) throw fail(404, 'That video was not made in this workspace.');
    const filePath = path.join(RENDER_DIR, filename);
    if (!fs.existsSync(filePath)) throw fail(410, 'That video file has expired on the server. Make it again, then save it.');
    const clientId = await validClientId(req, req.body?.clientId);
    const asset = await addVersion(req, { filePath, mimeType: 'video/mp4', title: req.body?.title, clientId, assetId: req.body?.assetId || null, caption: req.body?.caption });
    res.status(201).json({ asset });
}));

router.get('/library/:id', route(async (req, res) => {
    const { ref, data } = await loadAsset(req);
    const [comments, reviews] = await Promise.all([
        ref.collection('comments').orderBy('createdAt', 'asc').limit(500).get(),
        reviewsCol(req).where('assetIds', 'array-contains', ref.id).limit(50).get(),
    ]);
    if (data.clientActivity) ref.update({ clientActivity: false }).catch(() => {});
    res.json({
        asset: { ...assetSummary(ref.id, data), versions: publicVersions(data), activity: (data.activity || []).slice().reverse() },
        comments: comments.docs.map((c) => publicComment(c.id, c.data())),
        reviews: reviews.docs
            .map((r) => ({ id: r.id, title: r.data().title, url: `${appUrl()}/review/${r.data().token}`, revoked: !!r.data().revoked, expiresAt: iso(r.data().expiresAt), createdAt: iso(r.data().createdAt) }))
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    });
}));

router.patch('/library/:id', requireEditor, route(async (req, res) => {
    const { ref } = await loadAsset(req);
    const b = req.body || {};
    const update: Record<string, unknown> = { updatedAt: now() };
    if (b.title !== undefined) update.title = clean(b.title, 120) || 'Untitled video';
    if (b.caption !== undefined) update.caption = clean(b.caption, 2200);
    if (b.platforms !== undefined) update.platforms = (Array.isArray(b.platforms) ? b.platforms : []).filter((p: string) => PLATFORMS.includes(p));
    if (b.dueDate !== undefined) update.dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.dueDate)) ? b.dueDate : null;
    if (b.clientId !== undefined) update.clientId = await validClientId(req, b.clientId);
    // The team can move work between draft and in review; approval and change requests come from the client.
    if (b.status !== undefined) {
        if (!['draft', 'in_review'].includes(b.status)) throw fail(400, 'Only the client can approve or request changes.');
        update.status = b.status;
    }
    await ref.update(update);
    res.json({ asset: assetSummary(ref.id, (await ref.get()).data()) });
}));

router.delete('/library/:id', requireEditor, route(async (req, res) => {
    const { ref, data } = await loadAsset(req);
    const bytes = (data.versions || []).reduce((sum: number, v: any) => sum + (v.bytes || 0), 0);
    await deleteVersions(data.versions);
    const comments = await ref.collection('comments').limit(500).get();
    const batch = db.batch();
    comments.docs.forEach((c) => batch.delete(c.ref));
    batch.delete(ref);
    await batch.commit();
    await ws(req).set({ libraryBytes: admin.firestore.FieldValue.increment(-bytes) }, { merge: true });
    res.json({ success: true });
}));

router.post('/library/:id/comments', route(async (req, res) => {
    const { ref, data } = await loadAsset(req);
    const text = clean(req.body?.text, 2000);
    if (!text) throw fail(400, 'Write a comment first.');
    const timecode = Number.isFinite(Number(req.body?.timecode)) && req.body?.timecode !== null ? Math.max(0, Math.round(Number(req.body.timecode) * 10) / 10) : null;
    const comment = {
        text,
        timecode,
        version: Number(req.body?.version) || data.currentVersion,
        author: { kind: 'team', name: await memberName(req), uid: (req as any).uid },
        resolved: false,
        createdAt: now(),
    };
    const added = await ref.collection('comments').add(comment);
    await ref.update({ commentCount: admin.firestore.FieldValue.increment(1), updatedAt: now() });
    res.status(201).json({ comment: publicComment(added.id, { ...comment, createdAt: new Date().toISOString() }) });
}));

router.patch('/library/:id/comments/:commentId', route(async (req, res) => {
    const { ref } = await loadAsset(req);
    const cref = ref.collection('comments').doc(String(req.params.commentId));
    const snap = await cref.get();
    if (!snap.exists) throw fail(404, 'Comment not found.');
    const resolved = !!req.body?.resolved;
    if (!!snap.data()?.resolved !== resolved) {
        await cref.update({ resolved });
        if (snap.data()?.author?.kind === 'client') await ref.update({ openComments: admin.firestore.FieldValue.increment(resolved ? -1 : 1) });
    }
    res.json({ comment: publicComment(cref.id, { ...snap.data(), resolved }) });
}));

// ---------------------------------------------------------------- Review links

function reviewSummary(id: string, r: any, assets: Map<string, any>) {
    const items = (r.assetIds || []).map((aid: string) => assets.get(aid)).filter(Boolean);
    return {
        id,
        title: r.title,
        message: r.message || '',
        clientId: r.clientId || null,
        url: `${appUrl()}/review/${r.token}`,
        assetIds: r.assetIds || [],
        assets: items.map((a: any) => ({ id: a.id, title: a.title, status: a.status, posterUrl: a.posterUrl, currentVersion: a.currentVersion })),
        approved: items.filter((a: any) => a.status === 'approved').length,
        changes: items.filter((a: any) => a.status === 'changes_requested').length,
        total: items.length,
        allowDownload: !!r.allowDownload,
        views: r.views || 0,
        lastViewedAt: iso(r.lastViewedAt),
        reviewers: r.reviewers || [],
        expiresAt: iso(r.expiresAt),
        expired: !!r.expiresAt && Date.parse(iso(r.expiresAt)) < Date.now(),
        revoked: !!r.revoked,
        createdAt: iso(r.createdAt),
        createdByName: r.createdByName || '',
    };
}

router.get('/reviews', route(async (req, res) => {
    const [reviews, assets] = await Promise.all([reviewsCol(req).limit(300).get(), libraryCol(req).limit(1000).get()]);
    const byId = new Map(assets.docs.map((d) => [d.id, assetSummary(d.id, d.data())]));
    res.json({
        reviews: reviews.docs.map((d) => reviewSummary(d.id, d.data(), byId)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    });
}));

router.post('/reviews', requireEditor, route(async (req, res) => {
    const b = req.body || {};
    const ids = [...new Set((Array.isArray(b.assetIds) ? b.assetIds : []).map(String))].slice(0, 25);
    if (!ids.length) throw fail(400, 'Choose at least one video to send.');
    const snaps = await Promise.all(ids.map((id) => libraryCol(req).doc(String(id)).get()));
    if (snaps.some((s) => !s.exists)) throw fail(400, 'One of those videos no longer exists.');
    const clientIds = [...new Set(snaps.map((s) => (s.data() as any).clientId || null))];
    const days = EXPIRY_DAYS.includes(Number(b.expiresInDays)) ? Number(b.expiresInDays) : 14;
    const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    const token = newToken();
    const name = await memberName(req);
    const first = snaps[0].data() as any;
    const review = {
        title: clean(b.title, 120) || (ids.length === 1 ? first.title : `${ids.length} videos for review`),
        message: clean(b.message, 1000),
        clientId: clientIds.length === 1 ? clientIds[0] : null,
        assetIds: ids,
        token,
        allowDownload: !!b.allowDownload,
        expiresAt,
        revoked: false,
        views: 0,
        reviewers: [],
        createdBy: (req as any).uid,
        createdByName: name,
        createdAt: now(),
    };
    const ref = await reviewsCol(req).add(review);
    await db.collection('review_links').doc(hashToken(token)).set({ workspaceId: (req as any).workspaceId, reviewId: ref.id, expiresAt, revoked: false });
    // Everything sent is now waiting on the client (approved videos stay approved).
    const batch = db.batch();
    for (const s of snaps) {
        const d: any = s.data();
        const update: Record<string, unknown> = {
            activity: [...(d.activity || []).slice(-49), { type: 'sent', by: name, at: new Date().toISOString(), version: d.currentVersion }],
            updatedAt: now(),
        };
        if (d.status === 'draft') update.status = 'in_review';
        batch.update(s.ref, update);
    }
    await batch.commit();
    const assets = new Map(snaps.map((s) => [s.id, assetSummary(s.id, s.data())]));
    res.status(201).json({ review: reviewSummary(ref.id, { ...review, createdAt: new Date().toISOString() }, assets) });
}));

router.delete('/reviews/:id', requireEditor, route(async (req, res) => {
    const ref = reviewsCol(req).doc(String(req.params.id));
    const snap = await ref.get();
    if (!snap.exists) throw fail(404, 'Review link not found.');
    await ref.update({ revoked: true });
    await db.collection('review_links').doc(hashToken(snap.data()!.token)).set({ revoked: true }, { merge: true });
    res.json({ success: true });
}));

export default router;
