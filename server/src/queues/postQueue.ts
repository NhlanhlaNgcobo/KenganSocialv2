import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { db } from '../utils/firestore';
import { FieldValue } from 'firebase-admin/firestore';

// Import publishers
import { publishToYouTube } from '../services/publishers/youtube';
import { publishToInstagram } from '../services/publishers/instagram';
import { publishToTikTok } from '../services/publishers/tiktok';
import { publishToFacebook } from '../services/publishers/facebook';

// Reusing token decryption from existing logic if available, or fetch direct
import { decrypt } from '../utils/tokenEncryption';

import { redis } from '../utils/redis';
import { publicMediaUrl } from '../services/storage.service.js';
import { getValidAccessToken } from '../routes/connections';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
// Reusing shared client

// Setup Queue
export const postQueue = new Queue('scheduled-posts', { connection: redis as any });

export interface PublishPayload {
    postId: string;
    workspaceId: string;
    platforms: string[];
    mediaUrl: string;
    caption: string;
    platformOptions: Record<string, any>;
}

// Setup Worker
export const worker = new Worker('scheduled-posts', processJob, {
    connection: redis as any,
    concurrency: 5
});

async function processJob(job: Job<PublishPayload>) {
    const { postId, workspaceId, platforms, mediaUrl, caption, platformOptions } = job.data;

    // Check if post still valid
    const postSnap = await db.collection('scheduled_posts').doc(postId).get();
    if (!postSnap.exists || postSnap.data()?.status === 'cancelled') {
        return; // Job is stale, abort silently
    }

    // Platforms that already went out (an earlier attempt, or a run cut short by a restart) are
    // skipped, and each success is recorded the moment it happens: a retry never posts twice.
    const postRef = db.collection('scheduled_posts').doc(postId);
    const already: Record<string, string> = postSnap.data()?.platformPostIds || {};
    const pending = platforms.filter(p => !already[p]);

    const results = await Promise.allSettled(
        // Platforms download the file themselves, so each gets a link signed now (valid 48 h), however
        // long ago the post was scheduled. A bad link fails that platform with a reason, not the job.
        pending.map(async p => {
            const platformPostId = await publishMultiplexer(p, workspaceId, { mediaUrl: publicMediaUrl(mediaUrl, workspaceId), caption, ...platformOptions[p] });
            await postRef.update({ [`platformPostIds.${p}`]: platformPostId });
            return platformPostId;
        })
    );

    const platformPostIds: Record<string, string> = { ...already };
    const failed: { platform: string, error: string }[] = [];
    results.forEach((r, i) => {
        if (r.status === 'fulfilled') platformPostIds[pending[i]] = r.value;
        else failed.push({ platform: pending[i], error: r.reason?.message || String(r.reason) });
    });
    const publishedCount = platforms.filter(p => platformPostIds[p]).length;

    await postRef.update({
        status: failed.length === 0 ? 'published' : (publishedCount > 0 ? 'partial' : 'failed'),
        publishedAt: FieldValue.serverTimestamp(),
        platformPostIds,
        errors: failed
    });

    // Retry (BullMQ backoff) only the platforms that failed; the ones that worked are skipped.
    if (failed.length > 0) {
        throw new Error(`Publishing failed on: ${failed.map(f => `${f.platform} (${f.error})`).join(', ')}`);
    }
}

// Multiplex platform routing to specific adapters
async function publishMultiplexer(platform: string, workspaceId: string, options: any): Promise<string> {
    // Fetch token for this platform dynamically
    // Refreshes the token first when it is about to expire (TikTok access tokens last 24 hours,
    // YouTube's an hour), so a post scheduled long after connecting still goes out.
    let accessToken: string;
    let connRaw: any;
    try {
        const valid = await getValidAccessToken(workspaceId, platform as any);
        accessToken = valid.accessToken;
        connRaw = valid.connection;
    } catch (error: any) {
        if (error.message === 'NOT_CONNECTED') throw new Error(`${platform} is not connected. Connect it on the Connections page.`);
        throw new Error(`${platform} sign-in has expired and could not be renewed (${error.message}). Reconnect it on the Connections page.`);
    }

    if (!accessToken) throw new Error(`${platform} access token missing or expired`);
    if (connRaw.status && connRaw.status !== 'active') throw new Error(`${platform} needs reconnecting (${connRaw.status}).`);

    switch (platform) {
        case 'youtube':
            return publishToYouTube({
                accessToken,
                videoUrl: options.mediaUrl,
                title: options.title || options.caption.substring(0, 100),
                description: options.caption,
                // Chosen on the post; a scheduled post is never made public unless the person picked it.
                privacyStatus: ['public', 'unlisted', 'private'].includes(options.privacyStatus) ? options.privacyStatus : 'private',
                madeForKids: options.madeForKids === true,
            });
        case 'instagram':
            return publishToInstagram({
                // The user token couldn't be renewed but the Page token still works (token cron sets
                // userTokenExpired): publish with the Page token rather than fail until a reconnect.
                accessToken: connRaw.userTokenExpired && connRaw.pageAccessToken ? decrypt(connRaw.pageAccessToken) : accessToken,
                igUserId: connRaw.igUserId || connRaw.accountId, // Depends on connection logic
                videoUrl: options.mediaUrl,
                caption: options.caption,
            });
        case 'tiktok':
            return publishToTikTok({
                accessToken,
                openId: connRaw.accountId,
                videoUrl: options.mediaUrl,
                title: options.title ?? options.caption ?? '',
                // Everything below was chosen by the person on the TikTok post screen (no defaults).
                privacyLevel: options.privacyLevel,
                disableComment: options.allowComment !== true,
                disableDuet: options.allowDuet !== true,
                disableStitch: options.allowStitch !== true,
                brandContentToggle: options.brandedContent === true,
                brandOrganicToggle: options.yourBrand === true,
                isAigc: options.isAigc === true,
            });
        case 'facebook':
            return publishToFacebook({
                accessToken,
                pageId: connRaw.accountId,
                mediaUrl: options.mediaUrl,
                caption: options.caption,
                title: options.title,
            });
        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }
}

// Optional hooks for alerting
worker.on('failed', async (job, err) => {
    // Only alert on terminal failure (3 retries exhausted)
    if (job?.attemptsMade === job?.opts.attempts) {
        console.error(`[BullMQ] Final failure for post ${job.data.postId}:`, err);
        // Inform workspace admin via Firestore or simple notification system
        await db.collection('notifications').add({
            workspaceId: job.data.workspaceId,
            title: 'A scheduled post did not publish everywhere',
            message: `${err.message}. Fix the connection and publish it again from the calendar.`,
            type: 'error',
            postId: job.data.postId,
            createdAt: FieldValue.serverTimestamp()
        });
    }
});

// Helper for enqueueing with specific configs
export async function schedulePostJob(data: PublishPayload, delayMs: number): Promise<string> {
    const job = await postQueue.add('post', data, {
        delay: delayMs,
        jobId: data.postId, // ensuring single id for mutability
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 300000 // 5m -> 15m -> 45m
        },
        // Firestore keeps the post's history; Redis only needs recent jobs.
        removeOnComplete: { age: 7 * 86400, count: 5000 },
        removeOnFail: { age: 30 * 86400, count: 5000 }
    });
    return job.id!;
}

/**
 * Pending posts missing from the queue (saved while Redis was unreachable, or Redis data lost)
 * are queued again. The job id is the post id, so a post already queued is never added twice.
 */
export async function recoverPendingPosts(): Promise<number> {
    const snap = await db.collection('scheduled_posts').where('status', '==', 'pending').limit(2000).get();
    let requeued = 0;
    for (const doc of snap.docs) {
        if (await postQueue.getJob(doc.id)) continue;
        const data = doc.data();
        const when = data.scheduledAt?.toDate ? data.scheduledAt.toDate() : new Date(data.scheduledAt);
        await schedulePostJob({
            postId: doc.id,
            workspaceId: data.workspaceId,
            platforms: data.platforms || [],
            mediaUrl: data.mediaUrl || '',
            caption: data.caption || '',
            platformOptions: data.platformOptions || {},
        }, Math.max(0, (when?.getTime?.() || Date.now()) - Date.now()));
        requeued += 1;
    }
    return requeued;
}

let recoveryTimer: NodeJS.Timeout | null = null;
export function startPostRecovery(intervalMs = 10 * 60 * 1000) {
    const run = () => recoverPendingPosts()
        .then(n => { if (n) console.log(`[Schedule] Re-queued ${n} pending post(s) that were missing from the queue`); })
        .catch(error => console.warn('[Schedule] Pending-post recovery skipped:', error.message));
    void run();
    recoveryTimer = setInterval(run, intervalMs);
    recoveryTimer.unref();
}

/** Stops taking scheduled posts and waits for the ones being published right now. */
export async function stopPostQueue() {
    if (recoveryTimer) clearInterval(recoveryTimer);
    await worker.close();
    await postQueue.close();
}
