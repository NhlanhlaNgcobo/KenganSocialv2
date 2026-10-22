import { randomUUID } from 'node:crypto';
import { db } from '../../utils/firestore';
import { jobDirectory } from './media.js';
import { renderAd } from './pipeline.js';
import { reserve, refund } from './billing';
import fs from 'node:fs/promises';

export const ads = () => db.collection('marketing_video_ads');
const owner = randomUUID();
let ticking = false;
let timer: ReturnType<typeof setInterval> | undefined;
let lastSweep = 0;

async function failJob(ref: FirebaseFirestore.DocumentReference, job: any, error: any) {
    const failed = await db.runTransaction(async tx => {
        const current = (await tx.get(ref)).data();
        if (!current || !['processing', 'recovering'].includes(current.status)) return false;
        tx.update(ref, { status: 'failed', stage: 'Failed', error: error.publicMessage || 'The ad could not be completed. Please create a new draft and try again.', updatedAt: Date.now(), refundPending: true });
        return true;
    });
    if (!failed) return;
    try { await refund(job.billing); await ref.update({ refundPending: false }); } catch { /* Durable refund marker is retried by the worker. */ }
}

export async function tickVideoAds() {
    if (ticking) return;
    ticking = true;
    try {
        if (Date.now() - lastSweep > 3600000) {
            const expired = await ads().where('expiresAt', '<=', Date.now()).limit(20).get();
            for (const doc of expired.docs) {
                const canDelete = await db.runTransaction(async tx => {
                    const value = (await tx.get(doc.ref)).data();
                    if (!value || !['draft', 'failed', 'completed', 'deleting'].includes(value.status) || value.refundPending) return false;
                    tx.update(doc.ref, { status: 'deleting' });
                    return true;
                });
                if (canDelete) {
                    await fs.rm(jobDirectory(doc.id), { recursive: true, force: true });
                    await doc.ref.delete();
                }
            }
            lastSweep = expired.size === 20 ? 0 : Date.now();
        }
        const refunds = await ads().where('refundPending', '==', true).limit(10).get();
        for (const doc of refunds.docs) {
            try { await refund(doc.data().billing); await doc.ref.update({ refundPending: false }); } catch { break; }
        }
        // Lost workers fail explicitly. Never silently repeat a paid generation after a crash.
        const active = await ads().where('status', 'in', ['processing', 'recovering']).limit(100).get();
        for (const doc of active.docs) {
            const stale = await db.runTransaction(async tx => {
                const current = (await tx.get(doc.ref)).data();
                if (!current || !['processing', 'recovering'].includes(current.status) || current.leaseUntil > Date.now()) return null;
                tx.update(doc.ref, { status: 'recovering' });
                return current;
            });
            if (stale) await failJob(doc.ref, stale, { publicMessage: 'The render worker stopped. Your render allowance will be returned. Create a new draft to try again.' });
        }
        const queued = await ads().where('status', '==', 'queued').limit(10).get();
        for (const doc of queued.docs) {
            const job = await db.runTransaction(async tx => {
                const current = (await tx.get(doc.ref)).data();
                if (current?.status !== 'queued') return null;
                tx.update(doc.ref, { status: 'processing', worker: owner, leaseUntil: Date.now() + 120000, updatedAt: Date.now() });
                return current;
            });
            if (!job) continue;
            const heartbeat = setInterval(() => { void doc.ref.update({ leaseUntil: Date.now() + 120000 }).catch(() => {}); }, 20000);
            let lastUpdate = 0;
            try {
                await reserve(job.billing);
                const result = await renderAd(jobDirectory(doc.id), job.settings, async (stage: string, progress: number) => {
                    if (Date.now() - lastUpdate < 1500 && progress < 96) return;
                    lastUpdate = Date.now();
                    await doc.ref.update({ stage, progress, updatedAt: Date.now() }).catch(() => {});
                });
                await db.runTransaction(async tx => {
                    const current = (await tx.get(doc.ref)).data();
                    if (current?.status === 'processing' && current.worker === owner) tx.update(doc.ref, { status: 'completed', stage: 'Ready', progress: 100, result, updatedAt: Date.now() });
                });
            } catch (error) { await failJob(doc.ref, job, error); }
            finally { clearInterval(heartbeat); }
            break;
        }
    } catch { console.warn('[VideoAds] Worker unavailable; queued jobs will be checked again.'); }
    finally { ticking = false; }
}

export function startVideoAdWorker() {
    if (timer) return;
    timer = setInterval(() => { void tickVideoAds(); }, 30000);
    timer.unref();
}

export function stopVideoAdWorker() {
    if (timer) clearInterval(timer);
    timer = undefined;
}
