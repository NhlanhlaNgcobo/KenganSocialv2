import { features, YOUTUBE_LINK_IMPORT_OFF } from '../utils/features';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import os from 'os';
import fs from 'fs';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../utils/firestore';
import { withWorkspace } from '../middleware/withWorkspace';
import { checkLimit, consumeUsage, planRateLimit, refundUsage } from '../middleware/planGate';
import { MAX_SOURCE_MINUTES } from '../utils/planLimits';
import { probe } from '../services/ffmpeg-runner.js';
import { getUploadPath, storeUpload } from '../services/manual-edit.service.js';
import { CAPTION_STYLES, CLIP_LENGTHS, createClips, LAYOUTS, normalizeClipRequest, PLATFORMS, RATIOS } from '../services/clips/index.js';

/**
 * Clips: long video → ranked short clips (OpusClip-style).
 *  GET    /api/clips/options   lengths, ratios, layouts, platforms, caption templates
 *  POST   /api/clips           { sourceUploadId, platform, count, length, ratio, layout, captionStyle, hookTitle, progressBar, prompt }
 *  POST   /api/clips/from-url  { url, rightsConfirmed: true, ...same settings }  YouTube link → clips
 *  GET    /api/clips           this workspace's recent projects
 *  GET    /api/clips/:id       one project with its clips
 *  DELETE /api/clips/:id
 * Clip files download through /api/video/manual-edit/download/:filename (workspace members only).
 *
 * Projects run in this process. A running project touches `updatedAt` at least every
 * HEARTBEAT_MS (also while it waits in the queue or downloads), so a project still marked
 * 'processing' with no update for STALE_AFTER_MS was lost (e.g. the server restarted) and is
 * reported as failed.
 */
const router = express.Router();
const projects = db.collection('clip_projects');

// withWorkspace lets users without a workspace through with workspaceId = null;
// clip projects are always scoped to a workspace, so those requests stop here.
router.use(withWorkspace, (req: Request, res: Response, next) => {
    if (!(req as any).workspaceId) return res.status(403).json({ error: 'Create or join a workspace first.' });
    next();
});

const HEARTBEAT_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 20 * 60 * 1000;
const STALE_ERROR = 'Processing stopped before it finished (the server restarted or the job was interrupted). Delete this project and try again.';

/** Keeps `updatedAt` fresh while a project is alive, so it isn't mistaken for a lost one. Returns a stop function. */
function startHeartbeat(ref: FirebaseFirestore.DocumentReference) {
    const timer = setInterval(() => {
        ref.update({ updatedAt: new Date().toISOString() }).catch(() => {});
    }, HEARTBEAT_MS);
    timer.unref?.();
    return () => clearInterval(timer);
}

function isStale(p: any): boolean {
    if (p?.status !== 'processing') return false;
    const last = Date.parse(p.updatedAt || p.createdAt || '');
    return Number.isFinite(last) && Date.now() - last > STALE_AFTER_MS;
}

/** Marks a lost 'processing' project as failed (best effort) and returns the corrected data. */
function settleStale(ref: FirebaseFirestore.DocumentReference, p: any) {
    if (!isStale(p)) return p;
    const update = { status: 'failed', stage: 'Failed', error: STALE_ERROR, errorCode: 'INTERRUPTED', updatedAt: new Date().toISOString() };
    ref.update(update).catch((error: any) => console.warn(`[Clips] Could not mark project ${p.id} as failed:`, error.message));
    return { ...p, ...update };
}

// Clip projects are CPU heavy: run them one at a time.
let running: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = running.then(task, task);
    running = next.then(() => undefined, () => undefined);
    return next;
}

/** Runs a clip project in the background queue and records progress, clips and the result on its doc. */
async function runProject(
    ref: FirebaseFirestore.DocumentReference,
    id: string,
    request: any,
    { sourcePath, uid, workspaceId, plan }: { sourcePath: string; uid: string; workspaceId: string; plan: string }
) {
    let lastWrite = 0;
    const clips: any[] = [];
    const stopHeartbeat = startHeartbeat(ref);
    try {
        const result: any = await enqueue(() =>
            createClips(
                request,
                { sourcePath, uid, workspaceId, plan, jobId: `clips_${id}`, db },
                {
                    onStage: (stage: string, progress: number, extra: Record<string, unknown> = {}) => {
                        const nowMs = Date.now();
                        const important = Object.keys(extra).length > 0 || !stage.startsWith('Rendering');
                        if (!important && nowMs - lastWrite < 1500) return;
                        lastWrite = nowMs;
                        ref.update({ stage, progress, ...extra, updatedAt: new Date().toISOString() }).catch(() => {});
                    },
                    onClip: async (clip: any) => {
                        if (clip.error) {
                            clips.push({ id: clip.id, rank: clip.rank, title: clip.title, start: clip.start, end: clip.end, error: clip.error });
                        } else {
                            const filename = path.basename(clip.outputPath);
                            const outputUploadId = uuidv4();
                            storeUpload(outputUploadId, clip.outputPath, uid);
                            // The download route authorises files through manual_edit_jobs.
                            await db.collection('manual_edit_jobs').doc(`${id}_${clip.id}`).set({
                                id: `${id}_${clip.id}`,
                                userId: uid,
                                workspaceId,
                                type: 'clip',
                                projectId: id,
                                status: 'completed',
                                outputPath: clip.outputPath,
                                outputFilename: filename,
                                createdAt: new Date().toISOString(),
                            });
                            const { outputPath, ...rest } = clip;
                            clips.push({ ...rest, outputUploadId, downloadUrl: `/api/video/manual-edit/download/${filename}` });
                        }
                        await ref.update({ clips, updatedAt: new Date().toISOString() });
                    },
                }
            )
        );
        await ref.update({
            status: 'completed',
            stage: 'Done',
            progress: 100,
            finder: result.finder,
            note: result.note || null,
            duration: result.duration,
            updatedAt: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error(`[Clips] Project ${id} failed:`, error.message);
        await ref.update({ status: 'failed', stage: 'Failed', error: error.message, updatedAt: new Date().toISOString() }).catch(() => {});
    } finally {
        stopHeartbeat();
    }
}

const YOUTUBE_URL = /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const PYTHON_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';
// Shared with the video service and the clip renderer (render-clip.js uses the same folder).
const IMPORT_DIR = path.join(os.tmpdir(), 'kengan-renders');

router.get('/options', withWorkspace, (_req: Request, res: Response) => {
    res.json({
        lengths: Object.entries(CLIP_LENGTHS as Record<string, { label: string }>).map(([id, l]) => ({ id, label: l.label })),
        ratios: Object.keys(RATIOS),
        layouts: Object.entries(LAYOUTS as Record<string, { label: string; description: string }>).map(([id, l]) => ({ id, ...l })),
        platforms: Object.entries(PLATFORMS as Record<string, { label: string; ratio: string; length: string; maxLength: string }>).map(([id, p]) => ({
            id,
            label: p.label,
            ratio: p.ratio,
            length: p.length,
            maxLength: p.maxLength,
        })),
        captionStyles: Object.entries(CAPTION_STYLES as Record<string, { label: string; description: string }>).map(([id, s]) => ({ id, label: s.label, description: s.description })),
    });
});

/**
 * Checks a source video against the plan: its length must be within MAX_SOURCE_MINUTES, and its
 * transcription (rounded up to whole hours) is taken from the monthly transcription allowance.
 * Returns null when allowed, or an error message.
 */
async function chargeSource(sourcePath: string, workspaceId: string, plan: string): Promise<{ status: number; body: any } | null> {
    let seconds = 0;
    try {
        seconds = (await probe(sourcePath)).duration || 0;
    } catch {
        return { status: 400, body: { error: 'This file could not be read as a video. Try exporting it again as MP4.' } };
    }
    const maxMinutes = (MAX_SOURCE_MINUTES as any)[plan] ?? 0;
    if (seconds / 60 > maxMinutes) {
        return {
            status: 402,
            body: {
                error: 'VIDEO_TOO_LONG',
                message: `This video is ${Math.round(seconds / 60)} minutes long. Your plan turns videos of up to ${maxMinutes} minutes into clips. Trim it or upgrade.`,
                upgradeUrl: '/settings/billing',
            },
        };
    }
    const usage = await consumeUsage(workspaceId, plan, 'transcribeHrs', Math.max(1, Math.ceil(seconds / 3600)));
    return usage.ok ? null : { status: usage.status, body: usage.body };
}

router.post('/', withWorkspace, planRateLimit(), checkLimit('clipAnalysis'), async (req: Request, res: Response) => {
    const request: any = normalizeClipRequest(req.body);
    const uid = (req as any).uid;
    const workspaceId = (req as any).workspaceId;
    const plan = (req as any).plan;

    const sourcePath = request.sourceUploadId ? getUploadPath(request.sourceUploadId, uid) : null;
    if (!sourcePath) {
        await refundUsage(workspaceId, plan, 'clipAnalysis');
        return res.status(400).json({ error: 'Upload the video first. If you already did, upload it again.' });
    }
    const refused = await chargeSource(sourcePath, workspaceId, plan);
    if (refused) {
        await refundUsage(workspaceId, plan, 'clipAnalysis');
        return res.status(refused.status).json(refused.body);
    }

    const id = uuidv4();
    const ref = projects.doc(id);
    const now = new Date().toISOString();
    const { sourceUploadId, ...settings } = request;
    try {
        await ref.set({
            id,
            workspaceId,
            userId: uid,
            status: 'processing',
            stage: 'Queued',
            progress: 0,
            request: settings,
            sourceName: request.sourceName,
            clips: [],
            createdAt: now,
            updatedAt: now,
        });
    } catch (error: any) {
        console.error('[Clips] Could not create project:', error.message);
        return res.status(500).json({ error: 'Could not start the clip project. Try again.' });
    }
    res.status(202).json({ id, status: 'processing' });

    runProject(ref, id, request, { sourcePath, uid, workspaceId, plan });
});

/**
 * YouTube link → clips. The video service downloads the video (yt-dlp) into the shared render folder,
 * then the normal pipeline runs. Only for videos the user owns or has the rights to repurpose.
 */
router.post('/from-url', withWorkspace, planRateLimit(), checkLimit('clipAnalysis'), async (req: Request, res: Response) => {
    if (!features.youtubeLinkImport()) return res.status(403).json({ error: YOUTUBE_LINK_IMPORT_OFF, code: 'YOUTUBE_LINK_IMPORT_OFF' });
    const url = String(req.body?.url || '').trim();
    const match = YOUTUBE_URL.exec(url);
    if (!match) return res.status(400).json({ error: 'Paste a YouTube video link (youtube.com/watch, youtu.be or /shorts).' });
    if (req.body?.rightsConfirmed !== true) {
        return res.status(400).json({ error: 'Confirm that you own this video or have permission to repurpose it.' });
    }

    const uid = (req as any).uid;
    const workspaceId = (req as any).workspaceId;
    const plan = (req as any).plan;
    const request: any = normalizeClipRequest({ ...req.body, sourceName: 'YouTube video' });
    const { sourceUploadId, ...settings } = request;

    const id = uuidv4();
    const ref = projects.doc(id);
    const now = new Date().toISOString();
    try {
        await ref.set({
            id,
            workspaceId,
            userId: uid,
            status: 'processing',
            stage: 'Downloading from YouTube',
            progress: 1,
            request: settings,
            sourceName: 'YouTube video',
            source: { type: 'youtube', url, videoId: match[1] },
            clips: [],
            createdAt: now,
            updatedAt: now,
        });
    } catch (error: any) {
        console.error('[Clips] Could not create project:', error.message);
        return res.status(500).json({ error: 'Could not start the clip project. Try again.' });
    }
    res.status(202).json({ id, status: 'processing' });

    let sourcePath: string;
    const stopHeartbeat = startHeartbeat(ref);
    try {
        fs.mkdirSync(IMPORT_DIR, { recursive: true });
        const { data } = await axios.post(`${PYTHON_URL}/process/download-url`, { url, outputDir: IMPORT_DIR }, { timeout: 45 * 60 * 1000 });
        sourcePath = data.path;
        const refused = await chargeSource(sourcePath, workspaceId, plan);
        if (refused) {
            await refundUsage(workspaceId, plan, 'clipAnalysis');
            fs.rm(sourcePath, { force: true }, () => {});
            await ref.update({ status: 'failed', stage: 'Failed', error: refused.body.message || refused.body.error, errorCode: refused.body.error, updatedAt: new Date().toISOString() }).catch(() => {});
            return;
        }
        const sourceName = String(data.title || 'YouTube video').slice(0, 150);
        request.sourceName = sourceName;
        storeUpload(uuidv4(), sourcePath, uid);
        await ref.update({
            sourceName,
            source: { type: 'youtube', url, videoId: data.videoId || match[1], channel: data.channel || null, channelId: data.channelId || null },
            stage: 'Queued',
            progress: 3,
            updatedAt: new Date().toISOString(),
        });
    } catch (error: any) {
        const detail = error.response?.data?.detail?.message || (error.code === 'ECONNREFUSED' ? 'The video service is not running.' : error.message);
        // YouTube often blocks automated downloads ("confirm you're not a bot"), especially from servers.
        const blocked = /not a bot|sign in to confirm|cookies|HTTP Error 429|Too Many Requests/i.test(detail);
        const message = blocked
            ? 'YouTube blocked the automatic download. Download the video from YouTube Studio (Content → ⋮ → Download) and upload the file instead.'
            : `Could not import the video: ${detail}`;
        console.error(`[Clips] YouTube import for ${id} failed:`, detail);
        await ref
            .update({ status: 'failed', stage: 'Failed', error: message, errorCode: blocked ? 'YOUTUBE_BLOCKED' : 'IMPORT_FAILED', updatedAt: new Date().toISOString() })
            .catch(() => {});
        return;
    } finally {
        stopHeartbeat();
    }
    runProject(ref, id, request, { sourcePath, uid, workspaceId, plan });
});

router.get('/', withWorkspace, async (req: Request, res: Response) => {
    try {
        const snap = await projects.where('workspaceId', '==', (req as any).workspaceId).limit(60).get();
        const list = snap.docs
            .map((d: any) => settleStale(d.ref, d.data()))
            .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)))
            .slice(0, 30)
            .map((p: any) => ({
                id: p.id,
                sourceName: p.sourceName,
                sourceType: p.source?.type || 'upload',
                status: p.status,
                stage: p.stage,
                progress: p.progress,
                createdAt: p.createdAt,
                clipCount: (p.clips || []).filter((c: any) => !c.error).length,
                poster: (p.clips || []).find((c: any) => c.poster)?.poster || null,
                topScore: Math.max(0, ...(p.clips || []).map((c: any) => c.score || 0)),
            }));
        res.json({ projects: list });
    } catch (error: any) {
        console.error('[Clips] List failed:', error.message);
        res.status(500).json({ error: 'Could not load your clip projects.' });
    }
});

async function loadOwned(req: Request, res: Response) {
    const id = String(req.params.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) {
        res.status(404).json({ error: 'Project not found' });
        return null;
    }
    const doc = await projects.doc(id).get();
    const data: any = doc.exists ? doc.data() : null;
    // Tenant isolation: another workspace's project looks the same as a missing one.
    if (!data || data.workspaceId !== (req as any).workspaceId) {
        res.status(404).json({ error: 'Project not found' });
        return null;
    }
    return { doc, data };
}

router.get('/:id', withWorkspace, async (req: Request, res: Response) => {
    try {
        const found = await loadOwned(req, res);
        if (found) res.json({ project: settleStale(found.doc.ref, found.data) });
    } catch (error: any) {
        res.status(500).json({ error: 'Could not load this project.' });
    }
});

router.delete('/:id', withWorkspace, async (req: Request, res: Response) => {
    try {
        const found = await loadOwned(req, res);
        if (!found) return;
        // A lost (stale) project can be deleted; a live one can't, because it is still writing to its doc.
        if (found.data.status === 'processing' && !isStale(found.data)) return res.status(409).json({ error: 'This project is still processing.' });
        await found.doc.ref.delete();
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: 'Could not delete this project.' });
    }
});

export default router;
