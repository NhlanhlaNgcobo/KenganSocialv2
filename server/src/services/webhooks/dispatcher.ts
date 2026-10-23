import cron from 'node-cron';
import { db } from '../../utils/firestore';
import { collection, type WebhookSource } from './event-store';

/**
 * Runs stored webhook events through the handler registered for their source and type.
 *
 * - An event is claimed in a transaction (status + lock), so two server instances never run it twice.
 * - A failed event is retried with back-off, then marked `failed` with its last error kept for review.
 * - A worker (startWebhookWorker) picks up retries and events left behind by a restart, and purges
 *   old events: payloads hold people's messages, so they are not kept longer than needed.
 */

export interface HandlerContext {
    eventId: string;
    accountId: string | null;
    attempt: number;
}
/** A handler returns the workspace the event belonged to (for the audit trail), if any. */
export type WebhookHandler = (payload: any, ctx: HandlerContext) => Promise<{ workspaceId?: string | null } | void>;

const handlers = new Map<string, WebhookHandler>();
const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000];
const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
const LOCK_MS = 2 * 60_000;
const RETENTION_DAYS = { done: 7, ignored: 7, failed: 30 } as const;

export function onWebhook(source: WebhookSource, type: string, handler: WebhookHandler) {
    handlers.set(`${source}:${type}`, handler);
}

/** Claims an event for processing; returns its data, or null if it is done, locked or not due. */
async function claim(id: string): Promise<(FirebaseFirestore.DocumentData & { attempts: number }) | null> {
    const ref = collection().doc(id);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const e = snap.data();
        const now = Date.now();
        if (!e || !['pending', 'retry', 'processing'].includes(e.status)) return null;
        if (e.status === 'processing' && e.lockedUntil > now) return null; // another worker has it
        if (e.nextAttemptAt > now) return null;
        tx.update(ref, { status: 'processing', attempts: (e.attempts || 0) + 1, lockedUntil: now + LOCK_MS });
        return { ...e, attempts: (e.attempts || 0) + 1 };
    });
}

export async function processEvent(id: string) {
    const e = await claim(id);
    if (!e) return;
    const ref = collection().doc(id);
    const handler = handlers.get(`${e.source}:${e.type}`);
    if (!handler) {
        await ref.update({ status: 'ignored', processedAt: Date.now(), lockedUntil: 0 });
        return;
    }
    try {
        const result = await handler(e.payload, { eventId: id, accountId: e.accountId, attempt: e.attempts });
        await ref.update({ status: 'done', processedAt: Date.now(), lockedUntil: 0, lastError: null, workspaceId: (result && result.workspaceId) || e.workspaceId || null });
    } catch (error: any) {
        const message = String(error?.message || error).slice(0, 500);
        const giveUp = e.attempts >= MAX_ATTEMPTS;
        await ref.update({
            status: giveUp ? 'failed' : 'retry',
            lastError: message,
            lockedUntil: 0,
            nextAttemptAt: giveUp ? 0 : Date.now() + BACKOFF_MS[e.attempts - 1],
            ...(giveUp ? { failedAt: Date.now() } : {}),
        });
        console[giveUp ? 'error' : 'warn'](`[Webhooks] ${e.source} ${e.type} ${id} ${giveUp ? 'FAILED after' : 'failed, retrying after'} attempt ${e.attempts}: ${message}`);
    }
}

/** Processes newly stored events right away, one after another, after the platform has been answered. */
export function processSoon(ids: string[]) {
    if (!ids.length) return;
    setImmediate(async () => {
        for (const id of ids) {
            await processEvent(id).catch((error) => console.error(`[Webhooks] Could not process ${id}:`, error.message));
        }
    });
}

/** Events due now: retries whose back-off has passed, and pending/processing ones a restart left behind. */
async function dueEvents(): Promise<string[]> {
    const now = Date.now();
    const ids = new Set<string>();
    for (const status of ['retry', 'pending', 'processing']) {
        const snap = await collection().where('status', '==', status).limit(200).get();
        for (const d of snap.docs) {
            const e = d.data();
            const due = status === 'processing' ? e.lockedUntil < now : e.nextAttemptAt <= now && (status === 'retry' || now - e.receivedAt > 60_000);
            if (due) ids.add(d.id);
        }
    }
    return [...ids];
}

async function deleteDocs(docs: FirebaseFirestore.QueryDocumentSnapshot[]) {
    const batch = db.batch();
    docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
}

export async function purgeOldEvents() {
    let removed = 0;
    for (const [status, days] of Object.entries(RETENTION_DAYS)) {
        const cutoff = Date.now() - days * 86400_000;
        for (;;) {
            let docs: FirebaseFirestore.QueryDocumentSnapshot[];
            try {
                docs = (await collection().where('status', '==', status).where('receivedAt', '<', cutoff).limit(400).get()).docs;
            } catch (error: any) {
                // Until the (status, receivedAt) index in firestore.indexes.json is deployed: one filtered pass.
                if (error.code !== 9) throw error;
                docs = (await collection().where('status', '==', status).limit(2000).get()).docs.filter((d) => d.data().receivedAt < cutoff).slice(0, 400);
                if (docs.length < 400) {
                    if (docs.length) await deleteDocs(docs);
                    removed += docs.length;
                    break;
                }
            }
            if (!docs.length) break;
            await deleteDocs(docs);
            removed += docs.length;
        }
    }
    if (removed) console.log(`[Webhooks] Purged ${removed} old events`);
    return removed;
}

let started = false;
export function startWebhookWorker() {
    if (started) return;
    started = true;
    cron.schedule('* * * * *', async () => {
        try {
            for (const id of await dueEvents()) await processEvent(id);
        } catch (error: any) {
            console.error('[Webhooks] Worker error:', error.message);
        }
    });
    cron.schedule('17 3 * * *', () => {
        purgeOldEvents().catch((error) => console.error('[Webhooks] Purge failed:', error.message));
    });
    console.log('[Webhooks] Worker scheduled (retries every minute, purge daily)');
}
