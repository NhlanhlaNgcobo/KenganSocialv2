import express, { Request } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { FieldValue } from 'firebase-admin/firestore';
import { requirePlan } from '../middleware/planGate';
import { deleteFile, uploadFile } from '../services/storage.service.js';
import { fail, requireEditor, route, workspaceRef } from '../services/marketing/http';

/**
 * Competitors and the ad swipe file (mounted at /api/marketing/competitors).
 *  GET    /                 { competitors (with ad-library links), swipes }
 *  POST   /                 { name, website?, instagram?, tiktok?, facebook? } → saved competitor
 *  DELETE /:id
 *  POST   /swipes           multipart "files" (up to 10 ad screenshots) + { competitor?, note? }
 *  DELETE /swipes/:id
 *
 * Commercial ads outside the EU can't be pulled through Meta's or TikTok's APIs, so competitors
 * get one-click links into the official ad libraries, and ads worth learning from are saved here
 * as screenshots. "Recreate" (Image Ad Studio) reads a swipe's structure on first use.
 * Swipes are kept apart from the brand's own reference images so they never shape its style profile.
 * Paid plans only. Saving costs no AI credits.
 */

const router = express.Router();
router.use(requirePlan('nano'));

const MAX_COMPETITORS = 20;
const MAX_SWIPES = 60;
const competitors = (req: Request) => workspaceRef(req).collection('competitors');
const swipes = (req: Request) => workspaceRef(req).collection('adSwipes');
const swipePath = (req: Request) => `workspaces/${(req as any).workspaceId}/ads/swipes`;
const iso = (v: any) => v?.toDate?.()?.toISOString?.() || v || null;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 10 },
    fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const handle = (v: unknown) => text(v, 60).replace(/^@/, '').replace(/[^\w.]/g, '');

function domainOf(url: string) {
    try {
        return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

/** Official places to see a competitor's live ads and posts. */
function linksFor(c: any) {
    const q = encodeURIComponent(c.name);
    const links = [{ label: 'Meta Ad Library', url: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=${q}&search_type=keyword_unordered&media_type=all` }];
    if (c.website) links.push({ label: 'Google Ads Transparency', url: `https://adstransparency.google.com/?region=anywhere&domain=${encodeURIComponent(c.website)}` });
    links.push({ label: 'TikTok Top Ads', url: 'https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en' });
    if (c.instagram) links.push({ label: 'Instagram', url: `https://www.instagram.com/${c.instagram}/` });
    if (c.tiktok) links.push({ label: 'TikTok', url: `https://www.tiktok.com/@${c.tiktok}` });
    if (c.facebook) links.push({ label: 'Facebook', url: `https://www.facebook.com/${c.facebook}` });
    if (c.website) links.push({ label: 'Website', url: `https://${c.website}` });
    return links;
}

router.get('/', route(async (req, res) => {
    const [c, s] = await Promise.all([competitors(req).orderBy('createdAt', 'desc').get(), swipes(req).orderBy('createdAt', 'desc').limit(MAX_SWIPES).get()]);
    res.json({
        competitors: c.docs.map((d) => ({ id: d.id, ...d.data(), links: linksFor(d.data()), createdAt: iso(d.data().createdAt) })),
        swipes: s.docs.map((d) => {
            const x = d.data();
            return { id: d.id, previewUrl: x.previewUrl, imageUrl: x.imageUrl, competitor: x.competitor || '', note: x.note || '', analysed: !!x.structure, structure: x.structure || null, createdAt: iso(x.createdAt) };
        }),
    });
}));

router.post('/', requireEditor, route(async (req, res) => {
    const name = text(req.body?.name, 80);
    if (name.length < 2) throw fail(400, 'Add the competitor’s name.');
    if ((await competitors(req).count().get()).data().count >= MAX_COMPETITORS) throw fail(400, `You can track up to ${MAX_COMPETITORS} competitors.`);
    const doc = {
        name,
        website: domainOf(text(req.body?.website, 200)),
        instagram: handle(req.body?.instagram),
        tiktok: handle(req.body?.tiktok),
        facebook: handle(req.body?.facebook),
        createdBy: (req as any).uid,
        createdAt: FieldValue.serverTimestamp(),
    };
    const ref = await competitors(req).add(doc);
    res.status(201).json({ competitor: { id: ref.id, ...doc, links: linksFor(doc), createdAt: new Date().toISOString() } });
}));

router.delete('/:id', requireEditor, route(async (req, res) => {
    const ref = competitors(req).doc(String(req.params.id));
    if (!(await ref.get()).exists) throw fail(404, 'Competitor not found.');
    await ref.delete();
    res.json({ success: true });
}));

router.post('/swipes', requireEditor, upload.array('files', 10), route(async (req, res) => {
    const files = ((req as any).files || []) as Express.Multer.File[];
    if (!files.length) throw fail(400, 'Add at least one ad screenshot (JPG, PNG or WebP).');
    const existing = (await swipes(req).count().get()).data().count;
    if (existing + files.length > MAX_SWIPES) throw fail(400, `Your swipe file holds up to ${MAX_SWIPES} ads. Delete some first.`);
    const competitor = text(req.body?.competitor, 80);
    const note = text(req.body?.note, 200);
    const saved = [];
    for (const file of files) {
        const full = await sharp(file.buffer, { limitInputPixels: 40000000 }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
        const preview = await sharp(full).resize(480, 480, { fit: 'inside' }).webp({ quality: 78 }).toBuffer();
        const [imageUrl, previewUrl] = await Promise.all([uploadFile(full, swipePath(req), 'image/webp'), uploadFile(preview, swipePath(req), 'image/webp')]);
        const doc = { imageUrl, previewUrl, competitor, note, structure: null, createdBy: (req as any).uid, createdAt: FieldValue.serverTimestamp() };
        const ref = await swipes(req).add(doc);
        saved.push({ id: ref.id, imageUrl, previewUrl, competitor, note, analysed: false, structure: null, createdAt: new Date().toISOString() });
    }
    res.status(201).json({ swipes: saved });
}));

router.delete('/swipes/:id', requireEditor, route(async (req, res) => {
    const ref = swipes(req).doc(String(req.params.id));
    const snap = await ref.get();
    if (!snap.exists) throw fail(404, 'Saved ad not found.');
    await ref.delete();
    for (const url of [snap.data()?.imageUrl, snap.data()?.previewUrl]) if (url) deleteFile(url).catch(() => {});
    res.json({ success: true });
}));

export default router;
