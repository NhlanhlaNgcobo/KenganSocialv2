import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { db } from '../utils/firestore';
import admin from 'firebase-admin';

// Import publishers
import { publishToYouTube } from '../services/publishers/youtube';
import { publishToInstagram } from '../services/publishers/instagram';
import { publishToTikTok } from '../services/publishers/tiktok';
import { publishToLinkedIn } from '../services/publishers/linkedin';
import { publishToPinterest } from '../services/publishers/pinterest';
import { publishToThreads } from '../services/publishers/threads';

// Reusing token decryption from existing logic if available, or fetch direct
import { decrypt } from '../utils/tokenEncryption';

import { redis } from '../utils/redis';

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
        platforms.map(p => publishMultiplexer(p, workspaceId, { mediaUrl, caption, ...platformOptions[p] }))
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
    const connSnap = await db.collection('workspaces').doc(workspaceId).collection('connections').doc(platform).get();
    if (!connSnap.exists) throw new Error(`${platform} connection missing`);

    const connRaw = connSnap.data()!;
    const accessToken = decrypt ? decrypt(connRaw.accessToken) : connRaw.accessToken; // Assumes token encryption is available

    if (!accessToken) throw new Error(`${platform} access token missing or expired`);

    switch (platform) {
        case 'youtube':
            return publishToYouTube({
                accessToken,
                videoUrl: options.mediaUrl,
                title: options.title || options.caption.substring(0, 100),
                description: options.caption,
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
            });
        case 'linkedin':
            return publishToLinkedIn({
                accessToken,
                authorId: connRaw.accountId,
                videoUrl: options.mediaUrl,
                text: options.caption,
            });
        case 'pinterest':
            return publishToPinterest({
                accessToken,
                boardId: options.boardId, // User must supply this in platformOptions
                videoUrl: options.mediaUrl,
                title: options.title || options.caption.substring(0, 100),
                description: options.caption,
            });
        case 'threads':
            return publishToThreads({
                accessToken,
                threadsUserId: connRaw.accountId,
                videoUrl: options.mediaUrl,
                text: options.caption,
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
