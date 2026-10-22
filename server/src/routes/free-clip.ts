import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { db } from '../utils/firestore';
import { probe } from '../services/ffmpeg-runner.js';
import { createClips, normalizeClipRequest } from '../services/clips/index.js';
import { LEGAL_VERSIONS } from '../config/legal';

/**
 * Free starter clip: a visitor (no account) drops a long video on the landing page and gets one
 * captioned vertical clip, once per person.
 *
 *  POST /api/free-clip              multipart: video, email, consent=true, marketing=true|false
 *  GET  /api/free-clip/:id?token=   status { status, stage, progress, clip }
 *  GET  /api/free-clip/:id/video?token=   the finished MP4
 *
 * One per person: the normalised email (lower case; Gmail dots and +tags removed) is stored only
 * as an HMAC (free_clips/{hash}), unless the visitor asks for product news. Also limited per IP
 * per day and in total per day (FREE_CLIP_DAILY_CAP, default 100), and the jobs run one at a time
 * with a short queue. A failed job releases the email so the person can try again.
 */
const router = express.Router();

const MAX_BYTES = 500 * 1024 * 1024;
const MAX_SECONDS = 30 * 60;
const PER_IP_PER_DAY = 2;
const MAX_QUEUE = 4;
const KEEP_HOURS = 72;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

const claims = db.collection('free_clips');
const jobs = db.collection('free_clip_jobs');
const counters = db.collection('free_clip_counters');

const upload = multer({
    dest: os.tmpdir(),
    limits: { fileSize: MAX_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
        const ok = /^video\//.test(file.mimetype || '');
        cb(ok ? null : new Error('Upload a video file (MP4 or MOV).'), ok);
    },
});

const startLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 6,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts from this network. Try again in a few minutes.' },
});

function secret() {
    return process.env.FREE_CLIP_SECRET || process.env.TOKEN_ENCRYPTION_KEY || 'kengan-free-clip';
}
const hmac = (value: string) => crypto.createHmac('sha256', secret()).update(value).digest('hex');

/** Same inbox, same person: lower case, and for Gmail no dots and no +tag. */
export function normalizeEmail(raw: string): string {
    const email = String(raw || '').trim().toLowerCase();
    const at = email.lastIndexOf('@');
    if (at < 1) return email;
    let local = email.slice(0, at);
    let domain = email.slice(at + 1);
    if (domain === 'googlemail.com') domain = 'gmail.com';
    local = local.split('+')[0];
    if (domain === 'gmail.com') local = local.replace(/\./g, '');
    return `${local}@${domain}`;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Adds one to a daily counter if it is under `max`; false when the limit is reached. */
async function takeSlot(id: string, max: number): Promise<boolean> {
    const ref = counters.doc(id);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const count = snap.exists ? Number(snap.data()?.count || 0) : 0;
        if (count >= max) return false;
        tx.set(ref, { count: count + 1, day: today(), updatedAt: new Date().toISOString() }, { merge: true });
        return true;
    });
}

async function giveSlotBack(id: string) {
    const ref = counters.doc(id);
    await db
        .runTransaction(async (tx) => {
            const count = Number((await tx.get(ref)).data()?.count || 0);
            if (count > 0) tx.update(ref, { count: count - 1 });
        })
        .catch(() => {});
}

// Free jobs run one at a time, separately from paying customers' queue.
let running: Promise<unknown> = Promise.resolve();
let waiting = 0;
function enqueue<T>(task: () => Promise<T>): Promise<T> {
    waiting += 1;
    const next = running.then(task, task).finally(() => {
        waiting -= 1;
    });
    running = next.then(() => undefined, () => undefined);
    return next;
}

function cleanup(file?: string) {
    if (file) fs.rm(file, { force: true }, () => {});
}

function fail(res: Response, status: number, error: string, code?: string) {
    return res.status(status).json({ error, ...(code ? { code } : {}) });
}

/** Multer errors (too large, wrong type) as readable messages. */
function receive(req: Request, res: Response, next: NextFunction) {
    upload.single('video')(req, res, (error: any) => {
        if (!error) return next();
        if (error.code === 'LIMIT_FILE_SIZE') return fail(res, 413, 'That video is over 500 MB. Trim it or export a smaller file and try again.');
        return fail(res, 400, error.message || 'The upload did not work. Try again.');
    });
}

router.post('/', startLimiter, receive, async (req: Request, res: Response) => {
    const file = (req as any).file;
    const email = String(req.body?.email || '').trim();
    try {
        if (!file) return fail(res, 400, 'Choose a video to upload.');
        if (!EMAIL.test(email)) {
            cleanup(file.path);
            return fail(res, 400, 'Enter a valid email address.');
        }
        if (req.body?.consent !== 'true') {
            cleanup(file.path);
            return fail(res, 400, 'Accept the Terms of Service and Privacy Policy to continue.');
        }

        let info: any;
        try {
            info = await probe(file.path);
        } catch {
            cleanup(file.path);
            return fail(res, 400, 'That file could not be read as a video.');
        }
        if (!info?.hasVideo) {
            cleanup(file.path);
            return fail(res, 400, 'That file has no video in it.');
        }
        if (!info.duration || info.duration < 20) {
            cleanup(file.path);
            return fail(res, 400, 'Use a video of at least 20 seconds: the free clip is cut from a longer recording.');
        }
        if (info.duration > MAX_SECONDS) {
            cleanup(file.path);
            return fail(res, 400, 'The free clip works with videos up to 30 minutes. Create a free account for longer videos.');
        }
        if (waiting >= MAX_QUEUE) {
            cleanup(file.path);
            return fail(res, 503, 'Lots of people are making clips right now. Try again in a few minutes.', 'BUSY');
        }

        const emailHash = hmac(normalizeEmail(email));
        const ipHash = hmac(`ip:${req.ip || 'unknown'}`).slice(0, 32);
        const id = crypto.randomUUID();
        const token = crypto.randomBytes(24).toString('hex');
        const now = new Date().toISOString();
        const marketing = req.body?.marketing === 'true';

        // One per person: create() fails if this email has had its free clip.
        try {
            await claims.doc(emailHash).create({
                jobId: id,
                createdAt: now,
                ipHash,
                consent: { termsVersion: LEGAL_VERSIONS.terms, privacyVersion: LEGAL_VERSIONS.privacy, at: now },
                // Kept only with the person's permission to send product news.
                ...(marketing ? { email: email.toLowerCase(), marketing: true } : { marketing: false }),
            });
        } catch {
            cleanup(file.path);
            return fail(res, 409, 'This email has already had its free clip. Create a free account to make more: new accounts get full access for 7 days.', 'ALREADY_USED');
        }

        const ipSlot = `ip_${ipHash}_${today()}`;
        const daySlot = `day_${today()}`;
        if (!(await takeSlot(ipSlot, PER_IP_PER_DAY))) {
            await claims.doc(emailHash).delete().catch(() => {});
            cleanup(file.path);
            return fail(res, 429, 'Free clips are limited to two per network per day. Create a free account to keep going.', 'IP_LIMIT');
        }
        const cap = Number(process.env.FREE_CLIP_DAILY_CAP) || 100;
        if (!(await takeSlot(daySlot, cap))) {
            await claims.doc(emailHash).delete().catch(() => {});
            await giveSlotBack(ipSlot);
            cleanup(file.path);
            return fail(res, 503, 'Today’s free clips have all been made. Try again tomorrow, or create a free account.', 'DAILY_CAP');
        }

        const ref = jobs.doc(id);
        await ref.set({
            id,
            tokenHash: hmac(token),
            emailHash,
            status: 'queued',
            stage: 'Waiting for a free slot',
            progress: 0,
            sourceName: String(file.originalname || 'video').slice(0, 120),
            duration: info.duration,
            createdAt: now,
            expiresAt: new Date(Date.now() + KEEP_HOURS * 3600 * 1000).toISOString(),
        });
        res.status(202).json({ id, token });

        const request = normalizeClipRequest({ platform: 'tiktok', count: 1, length: 'short', captionStyle: 'bold', hookTitle: true, progressBar: true, layout: 'auto' });
        let lastWrite = 0;
        let clip: any = null;
        try {
            await enqueue(() =>
                createClips(
                    request,
                    { sourcePath: file.path, uid: `free_${id}`, workspaceId: null, plan: 'nano', jobId: `free_${id}`, db },
                    {
                        onStage: (stage: string, progress: number) => {
                            const t = Date.now();
                            if (t - lastWrite < 1500 && progress < 100) return;
                            lastWrite = t;
                            ref.update({ status: 'processing', stage, progress, updatedAt: new Date().toISOString() }).catch(() => {});
                        },
                        onClip: async (c: any) => {
                            if (!c.error && !clip) clip = c;
                        },
                    }
                )
            );
            if (!clip) throw new Error('No clip could be made from this video.');
            await ref.update({
                status: 'completed',
                stage: 'Done',
                progress: 100,
                outputPath: clip.outputPath,
                clip: { title: clip.title || null, hook: clip.hook || null, caption: clip.caption || null, score: clip.score || null, duration: clip.duration || null, poster: clip.poster || null },
                updatedAt: new Date().toISOString(),
            });
        } catch (error: any) {
            console.error(`[FreeClip] ${id} failed:`, error.message);
            // Nothing was made: let this email try again.
            await claims.doc(emailHash).delete().catch(() => {});
            await giveSlotBack(daySlot);
            await ref.update({ status: 'failed', stage: 'Failed', error: 'We could not make a clip from this video. Try a different video with people talking.', updatedAt: new Date().toISOString() }).catch(() => {});
        } finally {
            cleanup(file.path);
        }
    } catch (error: any) {
        console.error('[FreeClip] start failed:', error.message);
        cleanup(file?.path);
        if (!res.headersSent) fail(res, 500, 'Something went wrong. Try again in a moment.');
    }
});

async function authorised(req: Request, res: Response) {
    const snap = await jobs.doc(String(req.params.id)).get();
    const job = snap.data();
    const token = String(req.query.token || '');
    if (!job || !token || hmac(token) !== job.tokenHash) {
        fail(res, 404, 'This free clip was not found.');
        return null;
    }
    if (Date.parse(job.expiresAt) < Date.now()) {
        fail(res, 410, 'This free clip has expired. Create a free account to make more.');
        return null;
    }
    return job;
}

router.get('/:id', async (req: Request, res: Response) => {
    const job = await authorised(req, res);
    if (!job) return;
    res.json({
        status: job.status,
        stage: job.stage,
        progress: job.progress || 0,
        error: job.error || null,
        clip: job.status === 'completed' ? job.clip : null,
        expiresAt: job.expiresAt,
    });
});

router.get('/:id/video', async (req: Request, res: Response) => {
    const job = await authorised(req, res);
    if (!job) return;
    if (job.status !== 'completed' || !job.outputPath || !fs.existsSync(job.outputPath)) return fail(res, 404, 'The clip is not ready yet.');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="kengansocial-free-clip.mp4"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path.resolve(job.outputPath));
});

export default router;
