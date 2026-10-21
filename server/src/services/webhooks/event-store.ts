import crypto from 'crypto';
import { db } from '../../utils/firestore';

/**
 * Durable store for incoming platform webhooks (collection `webhookEvents`).
 *
 * Every delivery is split into single events, and each is stored under an id derived from the
 * platform's own event key, so a redelivered event is recognised and skipped (idempotency).
 * Events are written before the platform is answered, so none are lost if the server stops,
 * then processed by the dispatcher (dispatcher.ts) with retries.
 *
 * Status: pending → processing → done | ignored (no handler) | retry → … | failed (after MAX_ATTEMPTS).
 * Stored payloads contain message text, so they are purged after RETENTION_DAYS (see purgeOldEvents).
 */

export type WebhookSource = 'meta' | 'tiktok';

export interface WebhookUnit {
    source: WebhookSource;
    /** Event type the handlers register for, e.g. "instagram.message", "page.feed", "authorization.removed". */
    type: string;
    /** The platform's unique key for this event (message id, comment id + verb, …). */
    key: string;
    /** Platform account the event belongs to (Instagram account id, Page id, TikTok open_id). */
    accountId: string | null;
    payload: Record<string, unknown>;
}

export const collection = () => db.collection('webhookEvents');
export const eventId = (source: string, key: string) => crypto.createHash('sha256').update(`${source}:${key}`).digest('hex').slice(0, 40);

/** Stores events; returns the ids of new ones (duplicates are skipped). */
export async function storeEvents(units: WebhookUnit[]): Promise<{ ids: string[]; duplicates: number }> {
    const ids: string[] = [];
    let duplicates = 0;
    const now = Date.now();
    await Promise.all(
        units.map(async (u) => {
            const id = eventId(u.source, u.key);
            try {
                await collection().doc(id).create({
                    source: u.source,
                    type: u.type,
                    key: u.key,
                    accountId: u.accountId,
                    payload: u.payload,
                    status: 'pending',
                    attempts: 0,
                    receivedAt: now,
                    nextAttemptAt: now,
                    lockedUntil: 0,
                    workspaceId: null,
                    lastError: null,
                });
                ids.push(id);
            } catch (error: any) {
                if (error.code === 6) duplicates++; // ALREADY_EXISTS: the platform redelivered it
                else throw error;
            }
        })
    );
    return { ids, duplicates };
}
