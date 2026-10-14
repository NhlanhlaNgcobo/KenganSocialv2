import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../utils/firestore';
import { withWorkspace } from '../middleware/withWorkspace';
import { checkLimit, planRateLimit } from '../middleware/planGate';
import { getUploadPath, storeUpload } from '../services/manual-edit.service.js';
import { CAPTION_STYLES, CLIP_LENGTHS, createClips, normalizeClipRequest, RATIOS } from '../services/clips/index.js';

/**
 * Clips: long video → ranked short clips (OpusClip-style).
 *  GET    /api/clips/options   lengths, ratios, caption styles
 *  POST   /api/clips           { sourceUploadId, count, length, ratio, captionStyle, hookTitle, prompt }
 *  GET    /api/clips           this workspace's recent projects
 *  GET    /api/clips/:id       one project with its clips
 *  DELETE /api/clips/:id
 * Clip files download through /api/video/manual-edit/download/:filename (owner only).
 */
const router = express.Router();
const projects = db.collection('clip_projects');

// withWorkspace lets users without a workspace through with workspaceId = null;
// clip projects are always scoped to a workspace, so those requests stop here.
router.use(withWorkspace, (req: Request, res: Response, next) => {
    if (!(req as any).workspaceId) return res.status(403).json({ error: 'Create or join a workspace first.' });
    next();
});

// Clip projects are CPU heavy: run them one at a time.
let running: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = running.then(task, task);
    running = next.then(() => undefined, () => undefined);
    return next;
}

router.get('/options', withWorkspace, (_req: Request, res: Response) => {
    res.json({
        lengths: Object.entries(CLIP_LENGTHS as Record<string, { label: string }>).map(([id, l]) => ({ id, label: l.label })),
        ratios: Object.keys(RATIOS),
        captionStyles: Object.entries(CAPTION_STYLES as Record<string, { label: string }>).map(([id, s]) => ({ id, label: s.label })),
    });
});

router.post('/', withWorkspace, planRateLimit(), checkLimit('clipAnalysis'), async (req: Request, res: Response) => {
    const request: any = normalizeClipRequest(req.body);
    const uid = (req as any).uid;
    const workspaceId = (req as any).workspaceId;
    const plan = (req as any).plan;

    const sourcePath = request.sourceUploadId ? getUploadPath(request.sourceUploadId, uid) : null;
    if (!sourcePath) return res.status(400).json({ error: 'Upload the video first. If you already did, upload it again.' });

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

    let lastWrite = 0;
    const clips: any[] = [];
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
    }
});

router.get('/', withWorkspace, async (req: Request, res: Response) => {
    try {
        const snap = await projects.where('workspaceId', '==', (req as any).workspaceId).limit(60).get();
        const list = snap.docs
            .map((d: any) => d.data())
            .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)))
            .slice(0, 30)
            .map((p: any) => ({
                id: p.id,
                sourceName: p.sourceName,
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
        if (found) res.json({ project: found.data });
    } catch (error: any) {
        res.status(500).json({ error: 'Could not load this project.' });
    }
});

router.delete('/:id', withWorkspace, async (req: Request, res: Response) => {
    try {
        const found = await loadOwned(req, res);
        if (!found) return;
        if (found.data.status === 'processing') return res.status(409).json({ error: 'This project is still processing.' });
        await found.doc.ref.delete();
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: 'Could not delete this project.' });
    }
});

export default router;
