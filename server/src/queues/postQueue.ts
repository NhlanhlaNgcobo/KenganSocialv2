import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { db } from '../utils/firestore';
import admin from 'firebase-admin';

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

    // Process platforms concurrently
    const results = await Promise.allSettled(
        // Platforms download the file themselves, so they get the public address (e.g. the tunnel).
        platforms.map(p => publishMultiplexer(p, workspaceId, { mediaUrl: publicMediaUrl(mediaUrl), caption, ...platformOptions[p] }))
    );

    const published: { platform: string, postId: string }[] = [];
    const failed: { platform: string, error: string }[] = [];

    results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            published.push({ platform: platforms[i], postId: r.value });
        } else {
            failed.push({ platform: platforms[i], error: r.reason.message || String(r.reason) });
        }
    });

    // Update Firestore with final result
    await db.collection('scheduled_posts').doc(postId).update({
        status: failed.length === 0 ? 'published' : (published.length > 0 ? 'partial' : 'failed'),
        publishedAt: admin.firestore.FieldValue.serverTimestamp(),
        platformPostIds: Object.fromEntries(published.map(p => [p.platform, p.postId])),
        errors: failed
    });

    // If total failure, throw error to trigger BullMQ retries
    if (published.length === 0 && platforms.length > 0) {
        throw new Error(`Critical failure on all platforms: ${failed.map(f => f.platform).join(', ')}`);
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
                accessToken,
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
            title: 'Bulk Post Scheduling Failure',
            message: `One of your posts failed to publish after 3 attempts. Errors: ${err.message}`,
            type: 'error',
            postId: job.data.postId,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
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
        }
    });
    return job.id!;
}
