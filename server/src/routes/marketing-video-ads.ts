import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from '../utils/firestore';
import { planRateLimit, requirePlan, consumeUsage, refundUsage } from '../middleware/planGate';
import { route, requireEditor, fail } from '../services/marketing/http';
import { normalizeSource, normalizeRender, assertWorkspaceAd, DURATIONS, FORMATS, MOODS } from '../services/video-ads/validation.js';
import { prepareDraft } from '../services/video-ads/drafts.js';
import { jobDirectory, saveJson } from '../services/video-ads/media.js';
import { listVoices, providerStatus } from '../services/video-ads/providers.js';
import { ads, startVideoAdWorker, tickVideoAds } from '../services/video-ads/jobs';
import { billingContext } from '../services/video-ads/billing';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 4, fileSize: 8 * 1024 * 1024, fields: 8, fieldSize: 4000 }, fileFilter: (_req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(fail(400, 'Upload JPG, PNG, or WebP images.'));
    cb(null, true);
} }).array('images', 4);
const receive = (req: any, res: any, next: any) => upload(req, res, error => error ? res.status(400).json({ error: 'Upload up to four JPG, PNG, or WebP images, at most 8 MB each.' }) : next());

async function owned(req: any) {
    jobDirectory(req.params.id);
    const ref = ads().doc(req.params.id);
    const doc = await ref.get();
    assertWorkspaceAd(doc.data(), req.workspaceId);
    return { ref, data: doc.data()! };
}
function publicAd(id: string, data: any) {
    const { name, description, offerings, script, duration, format, status, stage, progress, error, createdAt, result, scenes } = data;
    return { id, name, description, offerings, script, duration, format, status, stage, progress, error: error || null, createdAt, result: result || null, scenes };
}
router.use(planRateLimit());
router.get('/options', route(async (_req, res) => {
    const configured = providerStatus();
    let voices: any[] = [], voiceError = '';
    if (configured.voice) {
        try { voices = await listVoices(); } catch (error: any) { voiceError = error.publicMessage || 'Could not load voices.'; }
    }
    res.json({ durations: DURATIONS, formats: FORMATS, moods: MOODS, configured, voices, voiceError });
}));
router.get('/', route(async (req: any, res) => {
    const docs = await ads().where('workspaceId', '==', req.workspaceId).limit(100).get();
    res.json({ ads: docs.docs.map(d => publicAd(d.id, d.data())).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30) });
}));
router.post('/', requireEditor, requirePlan('nano'), receive, route(async (req: any, res) => {
    const files = req.files || [];
    const input = normalizeSource(req.body, files.length);
    const usage = await consumeUsage(req.workspaceId, req.plan, 'aiCalls');
    if (!usage.ok) { res.status(usage.status).json(usage.body); return; }
    const kit = (await db.collection('workspaces').doc(req.workspaceId).collection('brandKit').doc('current').get()).data() || {};
    let draft;
    try { draft = await prepareDraft(input, files, kit); }
    catch (error) { await refundUsage(req.workspaceId, req.plan, 'aiCalls'); throw error; }
    const id = randomUUID();
    const dir = jobDirectory(id);
    await saveJson(dir, 'draft.json', draft);
    const data = {
        workspaceId: req.workspaceId, userId: req.uid, name: draft.name, description: draft.description, offerings: draft.offerings,
        script: draft.script, duration: input.duration, format: input.format, status: 'draft', stage: 'Review your script', progress: 0,
        scenes: draft.plan.scenes.map((s: any) => ({ headline: s.headline, duration: s.duration, type: s.type })), createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 30 * 86400000,
    };
    try { await ads().doc(id).set(data); }
    catch (error) { await fs.rm(dir, { recursive: true, force: true }); throw error; }
    res.status(201).json(publicAd(id, data));
}));
router.get('/:id', route(async (req, res) => { const { data } = await owned(req); res.json(publicAd(String(req.params.id), data)); }));
router.post('/:id/render', requireEditor, route(async (req: any, res) => {
    const { ref, data } = await owned(req);
    const settings = normalizeRender(req.body, data);
    const configured = providerStatus();
    if (!configured.voice || (settings.music && !configured.music)) throw fail(503, 'The selected audio providers are not configured.');
    const result = await db.runTransaction(async tx => {
        const current = (await tx.get(ref)).data()!;
        if (['queued', 'processing', 'completed'].includes(current.status)) return current;
        if (current.status !== 'draft') throw fail(409, 'Create a new draft to try this ad again.');
        const update = { status: 'queued', stage: 'Queued', progress: 0, settings, script: settings.script, billing: billingContext(req.workspaceId, req.params.id, req.plan), updatedAt: Date.now() };
        tx.update(ref, update);
        return { ...current, ...update };
    });
    startVideoAdWorker();
    void tickVideoAds();
    res.status(202).json(publicAd(ref.id, result));
}));
router.get('/:id/media/:kind', route(async (req, res) => {
    const { data } = await owned(req);
    if (data.status !== 'completed') throw fail(409, 'This ad is not ready yet.');
    if (!['video', 'poster'].includes(String(req.params.kind))) throw fail(404, 'Media not found.');
    const file = path.join(jobDirectory(req.params.id), req.params.kind === 'video' ? 'ad.mp4' : 'poster.jpg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(file);
}));
router.delete('/:id', requireEditor, route(async (req, res) => {
    const { ref } = await owned(req);
    await db.runTransaction(async tx => {
        const data = (await tx.get(ref)).data()!;
        if (['queued', 'processing', 'recovering'].includes(data.status) || data.refundPending) throw fail(409, 'Wait for this job and any refund to finish before deleting it.');
        tx.update(ref, { status: 'deleting' });
    });
    await fs.rm(jobDirectory(req.params.id), { recursive: true, force: true });
    await ref.delete();
    res.json({ deleted: true });
}));
startVideoAdWorker();
export default router;
