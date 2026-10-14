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

        const postId = `post_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const scheduleTime = new Date(scheduledAt).getTime();
        const delay = Math.max(0, scheduleTime - Date.now());

        const data = {
            postId,
            workspaceId,
            status: 'pending',
            platforms,
            mediaUrl,
            caption,
            platformOptions: platformOptions || {},
            scheduledAt: new Date(scheduledAt),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await db.collection('scheduled_posts').doc(postId).set(data);
        const queueResult = await safeSchedulePost(data, delay);

        res.json({
            success: true,
            postId,
            message: 'Post successfully scheduled',
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
        const { scheduledAt, caption, platforms, platformOptions, mediaUrl } = req.body;

        const docRef = db.collection('scheduled_posts').doc(id);
        const postSnap = await docRef.get();

        if (!postSnap.exists || postSnap.data()?.workspaceId !== workspaceId) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const updates: any = {};
        if (caption) updates.caption = caption;
        if (platforms) updates.platforms = platforms;
        if (platformOptions) updates.platformOptions = platformOptions;
        if (mediaUrl) updates.mediaUrl = mediaUrl;

        let delay = null;
        if (scheduledAt) {
            const scheduleTime = new Date(scheduledAt).getTime();
            delay = Math.max(0, scheduleTime - Date.now());
            updates.scheduledAt = new Date(scheduledAt);
        }

        await docRef.update(updates);

        if (delay !== null) {
            await safeRemoveQueuedJob(id);
            await safeSchedulePost({ ...postSnap.data(), ...updates, postId: id as string } as any, delay);
        }

        res.json({ success: true, postId: id, message: 'Post updated' });
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
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter((post: any) => post.workspaceId === workspaceId);
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

        await docRef.update({ scheduledAt: new Date(), status: 'pending' });

        await safeRemoveQueuedJob(id as string);
        const queueResult = await safeSchedulePost({ ...postSnap.data(), postId: id } as any, 0);

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
