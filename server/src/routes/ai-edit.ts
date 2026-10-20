import express, { Request, Response } from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../utils/firestore';
import { withWorkspace } from '../middleware/withWorkspace';
import { consumeUsage, planRateLimit, refundUsage } from '../middleware/planGate';
import { MAX_SOURCE_MINUTES } from '../utils/planLimits';
import { fail, requireWorkspace, route } from '../services/marketing/http';
import { probe } from '../services/ffmpeg-runner.js';
import { getUploadPath } from '../services/manual-edit.service.js';
import { jobs, runEditJob, runStyleJob, STALE_AFTER_MS } from '../services/ai-edit/jobs.js';
import { PRESETS, sanitizeProfile } from '../services/ai-edit/profile.js';

/**
 * AI Edit: edit raw footage in the style of a reference video.
 *
 *  GET    /api/ai-edit/presets                 built-in styles
 *  GET    /api/ai-edit/styles                  this workspace's saved styles
 *  POST   /api/ai-edit/styles/analyze          { url } or multipart "video" → { jobId }   learn a style from a reference
 *  PATCH  /api/ai-edit/styles/:id              { ...profile }   rename or adjust a saved style
 *  DELETE /api/ai-edit/styles/:id
 *  POST   /api/ai-edit/edits                   { sourceUploadId, styleId | presetId, options } → { jobId }
 *  GET    /api/ai-edit/jobs/:id                progress; result (styleId or plan) when completed
 *
 * The footage is the editor's own upload (/api/video/manual-edit/upload). Reference videos are
 * measured and deleted; they are never stored or republished.
 */

const router = express.Router();
const PYTHON_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';
// Shared with the video service (same folder Clips uses for YouTube imports).
const IMPORT_DIR = path.join(os.tmpdir(), 'kengan-renders');
const AI_EDIT_PLANS = ['nano', 'creator', 'agency'];
const REFERENCE_MAX_BYTES = 600 * 1024 * 1024;
const VIDEO_MIME = /^video\//;

router.use(withWorkspace, requireWorkspace, (req: Request, res: Response, next) => {
    if (AI_EDIT_PLANS.includes((req as any).plan || 'starter')) return next();
    res.status(402).json({
        error: 'AI Edit is part of the paid plans. Upgrade to have your footage edited in your style.',
        code: 'UPGRADE_REQUIRED',
        upgradeUrl: '/dashboard/billing',
    });
});

const upload = multer({
    dest: IMPORT_DIR,
    limits: { fileSize: REFERENCE_MAX_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, VIDEO_MIME.test(file.mimetype)),
});

const stylesCol = (req: Request) => db.collection('workspaces').doc((req as any).workspaceId).collection('edit_styles');

function publicStyle(doc: FirebaseFirestore.DocumentSnapshot) {
    const d: any = doc.data() || {};
    return { ...d, id: doc.id };
}

router.get('/presets', (_req, res) => res.json({ presets: PRESETS }));

router.get(
    '/styles',
    route(async (req, res) => {
        const snap = await stylesCol(req).orderBy('createdAt', 'desc').limit(50).get();
        res.json({ styles: snap.docs.map(publicStyle) });
    })
);

router.post(
    '/styles/analyze',
    planRateLimit(),
    (req, res, next) => {
        fs.mkdirSync(IMPORT_DIR, { recursive: true });
        if (req.is('multipart/form-data')) {
            return upload.single('video')(req, res, (err: any) => {
                if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Reference videos can be up to 600 MB. Use a shorter example of the style.' : 'Could not read that upload.' });
                next();
            });
        }
        next();
    },
    route(async (req, res) => {
        const workspaceId = (req as any).workspaceId;
        const plan = (req as any).plan;
        const file = (req as any).file as Express.Multer.File | undefined;
        const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
        if (!file && !url) throw fail(400, 'Paste a video link or upload a video that shows the editing style.');
        if (!file && !/^https?:\/\//i.test(url)) throw fail(400, 'Paste a full video link (https://…).');

        const usage = await consumeUsage(workspaceId, plan, 'aiCalls', 5);
        if (!usage.ok) {
            if (file) fs.rm(file.path, { force: true }, () => {});
            return res.status(usage.status).json(usage.body);
        }

        const ref = jobs().doc(uuidv4());
        const stamp = new Date().toISOString();
        await ref.set({
            id: ref.id,
            type: 'style',
            workspaceId,
            userId: (req as any).uid,
            status: 'processing',
            stage: file ? 'Queued' : 'Downloading the reference',
            progress: 2,
            createdAt: stamp,
            updatedAt: stamp,
        });
        res.status(202).json({ jobId: ref.id });

        let videoPath = file?.path || '';
        const source: any = file ? { type: 'upload', title: path.parse(file.originalname || 'Reference').name.slice(0, 80) } : { type: 'link', url };
        if (!file) {
            try {
                const { data } = await axios.post(`${PYTHON_URL}/process/download-reference`, { url, outputDir: IMPORT_DIR }, { timeout: 20 * 60 * 1000 });
                videoPath = data.path;
                source.title = String(data.title || '').slice(0, 80);
                source.platform = data.platform || null;
            } catch (error: any) {
                const detail = error.response?.data?.detail?.message || (error.code === 'ECONNREFUSED' ? 'The video service is not running.' : error.message);
                const blocked = /login|log in|sign in|not a bot|cookies|private|429|403|blocked/i.test(detail);
                const message = blocked
                    ? 'That platform blocked the download from our server. Upload the video instead (any clip up to 10 minutes that shows the style).'
                    : `Could not get the reference video: ${detail}`;
                await refundUsage(workspaceId, plan, 'aiCalls', 5);
                await ref.update({ status: 'failed', stage: 'Failed', error: message, ...(blocked ? { errorCode: 'LINK_BLOCKED' } : {}), updatedAt: new Date().toISOString() }).catch(() => {});
                return;
            }
        }
        runStyleJob(ref, { videoPath, removeAfter: true, source, workspaceId, uid: (req as any).uid, plan });
    })
);

router.patch(
    '/styles/:id',
    route(async (req, res) => {
        const ref = stylesCol(req).doc(String(req.params.id));
        const doc = await ref.get();
        if (!doc.exists) throw fail(404, 'That style no longer exists.');
        const merged = sanitizeProfile({ ...doc.data(), ...req.body, source: doc.data()?.source });
        await ref.set({ ...merged, updatedAt: new Date().toISOString() }, { merge: true });
        res.json({ style: publicStyle(await ref.get()) });
    })
);

router.delete(
    '/styles/:id',
    route(async (req, res) => {
        await stylesCol(req).doc(String(req.params.id)).delete();
        res.json({ ok: true });
    })
);

const RATIO_OPTIONS = ['auto', '9:16', '16:9', '1:1'];

function normalizeOptions(raw: any = {}) {
    const target = Number(raw.targetSeconds);
    return {
        ratio: RATIO_OPTIONS.includes(raw.ratio) ? raw.ratio : 'auto',
        mode: raw.mode === 'highlights' ? 'highlights' : 'full',
        targetSeconds: [30, 60, 90].includes(target) ? target : 60,
        focus: typeof raw.focus === 'string' ? raw.focus.trim().slice(0, 200) : '',
        captions: raw.captions !== false,
        hook: raw.hook !== false,
        zooms: raw.zooms !== false,
        callouts: raw.callouts !== false,
        colorMatch: raw.colorMatch !== false,
        removeSilence: raw.removeSilence !== false,
        removeFillers: raw.removeFillers !== false,
    };
}

router.post(
    '/edits',
    planRateLimit(),
    route(async (req, res) => {
        const uid = (req as any).uid;
        const workspaceId = (req as any).workspaceId;
        const plan = (req as any).plan;
        const videoPath = typeof req.body?.sourceUploadId === 'string' ? getUploadPath(req.body.sourceUploadId, uid) : null;
        if (!videoPath) throw fail(400, 'Upload the footage first. If you already did, upload it again.');

        let profile: any = null;
        if (typeof req.body?.styleId === 'string' && req.body.styleId) {
            const doc = await stylesCol(req).doc(req.body.styleId).get();
            if (!doc.exists) throw fail(404, 'That style no longer exists. Pick another one.');
            profile = sanitizeProfile(doc.data());
        } else {
            const preset = PRESETS.find((p) => p.id === req.body?.presetId) || PRESETS[0];
            profile = { ...sanitizeProfile(preset), color: { ...preset.color, stats: null } };
        }
        const options = normalizeOptions(req.body?.options);

        // Same limits as Clips: video length per plan, transcription hours, one render credit.
        let seconds = 0;
        try {
            seconds = (await probe(videoPath)).duration || 0;
        } catch {
            throw fail(400, 'This file could not be read as a video. Try exporting it again as MP4.');
        }
        const maxMinutes = (MAX_SOURCE_MINUTES as any)[plan] ?? 0;
        if (seconds / 60 > maxMinutes) {
            return res.status(402).json({
                error: 'VIDEO_TOO_LONG',
                message: `This video is ${Math.round(seconds / 60)} minutes long. Your plan edits footage up to ${maxMinutes} minutes. Trim it or upgrade.`,
                upgradeUrl: '/dashboard/billing',
            });
        }
        const renders = await consumeUsage(workspaceId, plan, 'renders', 1);
        if (!renders.ok) return res.status(renders.status).json(renders.body);
        const hours = await consumeUsage(workspaceId, plan, 'transcribeHrs', Math.max(1, Math.ceil(seconds / 3600)));
        if (!hours.ok) {
            await refundUsage(workspaceId, plan, 'renders', 1);
            return res.status(hours.status).json(hours.body);
        }

        const ref = jobs().doc(uuidv4());
        const stamp = new Date().toISOString();
        await ref.set({
            id: ref.id,
            type: 'edit',
            workspaceId,
            userId: uid,
            status: 'processing',
            stage: 'Queued',
            progress: 1,
            styleName: profile.name,
            options,
            createdAt: stamp,
            updatedAt: stamp,
        });
        res.status(202).json({ jobId: ref.id });
        runEditJob(ref, { videoPath, profile, options, workspaceId, plan });
    })
);

router.get(
    '/jobs/:id',
    route(async (req, res) => {
        const doc = await jobs().doc(String(req.params.id)).get();
        const job: any = doc.data();
        if (!doc.exists || job.workspaceId !== (req as any).workspaceId) throw fail(404, 'Job not found.');
        if (job.status === 'processing' && Date.now() - Date.parse(job.updatedAt) > STALE_AFTER_MS) {
            job.status = 'failed';
            job.error = 'Processing stopped before it finished (the server restarted). Start it again.';
            await doc.ref.update({ status: job.status, error: job.error }).catch(() => {});
        }
        res.json({ job });
    })
);

export default router;
