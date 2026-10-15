import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { db } from '../utils/firestore';
import admin from 'firebase-admin';
import { postQueue, schedulePostJob } from '../queues/postQueue';

const router = express.Router();

import { withWorkspace } from '../middleware/withWorkspace';
import { checkLimit, planRateLimit } from '../middleware/planGate';

async function safeRemoveQueuedJob(postId: string) {
    try {
        const job = await postQueue.getJob(postId);
        if (job) {
            await job.remove();
        }
    } catch (error) {
        console.warn(`[Schedule] Queue removal skipped for ${postId}:`, (error as Error).message);
    }
}

function toIso(value: any): string | null {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    if (typeof value._seconds === 'number') return new Date(value._seconds * 1000).toISOString();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseDate(value: unknown): Date | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

async function safeSchedulePost(data: any, delay: number) {
    try {
        await schedulePostJob(data, delay);
        return { queued: true };
    } catch (error) {
        console.warn(`[Schedule] Queue unavailable for ${data.postId}:`, (error as Error).message);
        return {
            queued: false,
            warning: 'QUEUE_UNAVAILABLE',
        };
    }
}

// POST /api/schedule/create
router.post('/create', withWorkspace, planRateLimit(), checkLimit('posts'), async (req: Request, res: Response) => {
    try {
        const workspaceId = (req as any).workspaceId;
        const { platforms, mediaUrl, caption, scheduledAt, platformOptions } = req.body;
        // Drafts are saved on the calendar but never queued for publishing.
        const isDraft = req.body.status === 'draft';

        const when = parseDate(scheduledAt);
        if (!when) {
            return res.status(400).json({ error: 'INVALID_SCHEDULED_AT', message: 'Pick a valid publish date and time.' });
        }
        if (!Array.isArray(platforms) || platforms.length === 0 || !platforms.every((p) => typeof p === 'string')) {
            return res.status(400).json({ error: 'PLATFORMS_REQUIRED', message: 'Pick at least one platform.' });
        }

        const postId = `post_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const delay = Math.max(0, when.getTime() - Date.now());

        const data = {
            postId,
            workspaceId,
            status: isDraft ? 'draft' : 'pending',
            platforms,
            mediaUrl: typeof mediaUrl === 'string' ? mediaUrl : '',
            caption: typeof caption === 'string' ? caption : '',
            platformOptions: platformOptions || {},
            scheduledAt: when,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await db.collection('scheduled_posts').doc(postId).set(data);
        const queueResult = isDraft ? { queued: false } : await safeSchedulePost(data, delay);

        res.json({
            success: true,
            postId,
            message: isDraft ? 'Draft saved' : 'Post successfully scheduled',
            ...queueResult,
        });
    } catch (error: any) {
        console.error('[Schedule] Create failed:', error);
        res.status(500).json({ error: 'SCHEDULE_CREATE_FAILED', message: error.message });
    }
});

// PATCH /api/schedule/:id  — Re-schedule or update config
router.patch('/:id', withWorkspace, async (req: Request, res: Response) => {
    try {
        const workspaceId = (req as any).workspaceId;
        const id = req.params.id as string;
        const { scheduledAt, caption, platforms, platformOptions, mediaUrl, status } = req.body;

        const docRef = db.collection('scheduled_posts').doc(id);
        const postSnap = await docRef.get();

        if (!postSnap.exists || postSnap.data()?.workspaceId !== workspaceId) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const existing = postSnap.data() || {};
        const updates: any = {};
        if (typeof caption === 'string') updates.caption = caption;
        if (Array.isArray(platforms) && platforms.length > 0) updates.platforms = platforms;
        if (platformOptions) updates.platformOptions = platformOptions;
        if (typeof mediaUrl === 'string' && mediaUrl) updates.mediaUrl = mediaUrl;
        // Only draft <-> scheduled transitions are allowed from the client.
        if (status === 'draft' || status === 'pending') updates.status = status;

        if (scheduledAt !== undefined) {
            const when = parseDate(scheduledAt);
            if (!when) {
                return res.status(400).json({ error: 'INVALID_SCHEDULED_AT', message: 'Pick a valid publish date and time.' });
            }
            updates.scheduledAt = when;
        }

        await docRef.update(updates);

        const next: any = { ...existing, ...updates };
        let queueResult: Record<string, unknown> = {};
        if (next.status === 'draft') {
            // Drafts never sit in the publish queue.
            await safeRemoveQueuedJob(id);
        } else if (next.status === 'pending' && Object.keys(updates).length > 0) {
            // The queued job carries a snapshot of the post, so re-queue on any change.
            const when = parseDate(toIso(next.scheduledAt) || '') || new Date();
            await safeRemoveQueuedJob(id);
            queueResult = await safeSchedulePost({ ...next, postId: id as string }, Math.max(0, when.getTime() - Date.now()));
        }

        res.json({ success: true, postId: id, message: 'Post updated', ...queueResult });
    } catch (error: any) {
        console.error('[Schedule] Update failed:', error);
        res.status(500).json({ error: 'SCHEDULE_UPDATE_FAILED', message: error.message });
    }
});

// DELETE /api/schedule/:id — Cancel job
router.delete('/:id', withWorkspace, async (req: Request, res: Response) => {
    try {
        const workspaceId = (req as any).workspaceId;
        const id = req.params.id as string;

        const docRef = db.collection('scheduled_posts').doc(id);
        const postSnap = await docRef.get();

        if (!postSnap.exists || postSnap.data()?.workspaceId !== workspaceId) {
            return res.status(404).json({ error: 'Post not found' });
        }

        await docRef.update({ status: 'cancelled' });

        await safeRemoveQueuedJob(id as string);

        res.json({ success: true, postId: id, message: 'Post cancelled successfully' });
    } catch (error: any) {
        console.error('[Schedule] Delete failed:', error);
        res.status(500).json({ error: 'SCHEDULE_DELETE_FAILED', message: error.message });
    }
});

// GET /api/schedule/calendar?start=ISO&end=ISO
router.get('/calendar', withWorkspace, async (req: Request, res: Response) => {
    try {
        const workspaceId = (req as any).workspaceId;
        const start = req.query.start as string;
        const end = req.query.end as string;

        if (!start || !end) return res.status(400).json({ error: 'start and end dates required' });

        const startDate = new Date(start as string);
        const endDate = new Date(end as string);

        const snapshot = await db.collection('scheduled_posts')
            .where('scheduledAt', '>=', startDate)
            .where('scheduledAt', '<=', endDate)
            .orderBy('scheduledAt', 'asc')
            .get();

        const posts = snapshot.docs
            .map(doc => {
                const data = doc.data();
                // Firestore Timestamps serialise as {_seconds,...}; send ISO strings the client can parse.
                return { id: doc.id, ...data, scheduledAt: toIso(data.scheduledAt), createdAt: toIso(data.createdAt) };
            })
            .filter((post: any) => post.workspaceId === workspaceId && post.status !== 'cancelled');
        res.json({ success: true, posts });
    } catch (error: any) {
        console.error('[Schedule] Calendar failed:', error);
        res.status(500).json({ error: 'SCHEDULE_CALENDAR_FAILED', message: error.message });
    }
});

// POST /api/schedule/publish-now/:id  — Immediate execution
router.post('/publish-now/:id', withWorkspace, async (req: Request, res: Response) => {
    try {
        const workspaceId = (req as any).workspaceId;
        const id = req.params.id as string;

        const docRef = db.collection('scheduled_posts').doc(id);
        const postSnap = await docRef.get();

        if (!postSnap.exists || postSnap.data()?.workspaceId !== workspaceId) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const now = new Date();
        await docRef.update({ scheduledAt: now, status: 'pending' });

        await safeRemoveQueuedJob(id as string);
        const queueResult = await safeSchedulePost({ ...postSnap.data(), scheduledAt: now, status: 'pending', postId: id } as any, 0);

        res.json({
            success: true,
            postId: id,
            message: 'Publishing forced immediately',
            ...queueResult,
        });
    } catch (error: any) {
        console.error('[Schedule] Publish-now failed:', error);
        res.status(500).json({ error: 'SCHEDULE_PUBLISH_NOW_FAILED', message: error.message });
    }
});

// POST /api/schedule/draft
router.post('/draft', withWorkspace, async (req: Request, res: Response) => {
    try {
        const workspaceId = (req as any).workspaceId;
        const { platforms, mediaUrl, caption, platformOptions } = req.body;

        const postId = `post_${Date.now()}_draft_${Math.random().toString(36).substr(2, 5)}`;

        const data = {
            postId,
            workspaceId,
            status: 'draft',
            platforms: platforms || [],
            mediaUrl: mediaUrl || '',
            caption: caption || '',
            platformOptions: platformOptions || {},
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await db.collection('scheduled_posts').doc(postId).set(data);

        res.json({ success: true, postId, message: 'Draft saved securely' });
    } catch (error: any) {
        console.error('[Schedule] Draft failed:', error);
        res.status(500).json({ error: 'SCHEDULE_DRAFT_FAILED', message: error.message });
    }
});

export default router;
