/**
 * Extra numbers for the pilot admin dashboard: each member's usage this month/today, queue
 * depths, recent export outcomes and a rough monthly cost. Read-only.
 */
import { db } from '../utils/firestore';
import { readyUsageRedis } from '../utils/usageRedis';
import { getMonth } from '../utils/dateUtils';
import { pilotCap, utcDay } from '../config/pilot';
import { usageLimit } from '../middleware/planGate';

const FEATURES = ['exports', 'aiCalls', 'transcribeMinutes', 'posts', 'connections'] as const;

export async function pilotOverviewExtras(members: { uid: string; email: string }[]) {
    const redis = await readyUsageRedis().catch(() => null);
    const month = getMonth();
    const { day } = utcDay();
    const usage = [];
    for (const m of members) {
        const ws = await db.collection('workspaces').where('ownerId', '==', m.uid).limit(3).get();
        for (const w of ws.docs) {
            const plan = w.data().plan || 'starter';
            const row: Record<string, unknown> = { uid: m.uid, email: m.email, workspaceId: w.id, plan };
            for (const f of FEATURES) {
                const used = redis ? Number(await redis.get(`usage:${w.id}:${f}:${month}`)) || 0 : null;
                row[f] = { used, limit: usageLimit(w.id, plan, f) };
            }
            row.aiToday = { used: redis ? Number(await redis.get(`usage:${w.id}:aiCalls:day:${day}`)) || 0 : null, limit: pilotCap(w.id, 'aiCallsDaily') ?? null };
            usage.push(row);
        }
    }

    // Queues (BullMQ). Imported lazily: the post queue module starts a worker on import.
    const queues: Record<string, unknown> = {};
    try {
        const { postQueue } = await import('../queues/postQueue');
        queues.scheduledPosts = await postQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
    } catch (e: any) {
        queues.scheduledPosts = { error: e?.message || String(e) };
    }

    // Editor exports in the last 24 hours, by status.
    const since = new Date(Date.now() - 86400000).toISOString();
    const exportsByStatus: Record<string, number> = {};
    try {
        const snap = await db.collection('manual_edit_jobs').where('createdAt', '>=', since).limit(500).get();
        for (const d of snap.docs) {
            const s = String(d.data().status || 'unknown');
            exportsByStatus[s] = (exportsByStatus[s] || 0) + 1;
        }
    } catch (e: any) {
        exportsByStatus.error = 1;
    }

    return {
        usage,
        queues,
        exportsLast24h: exportsByStatus,
        // Self-hosted AI and transcription cost nothing per call; storage is the only metered cost
        // (R2 at $0.015/GB-month, docs/cost-model.md). The VPS is a fixed monthly cost.
        costs: { aiPerCallUSD: 0, transcriptionPerMinuteUSD: 0, storageUSDPerGBMonth: 0.015, note: 'VPS is fixed-cost; see docs/cost-model.md' },
    };
}
