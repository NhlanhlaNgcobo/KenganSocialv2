import { getFirestore } from '../../config/firebase.js';

/** Reuse recently observed provider data; never treat generated ideas as trend evidence. */
export async function recentTrendContext(workspaceId) {
    if (!workspaceId) return [];
    try {
        const db = getFirestore();
        const ws = (await db.collection('workspaces').doc(workspaceId).get()).data();
        if (!ws?.niche) return [];
        const key = String(ws.niche).toLowerCase().replace(/[^a-z0-9]/g, '_');
        const cached = (await db.collection('trending_cache').doc(key).get()).data();
        const time = cached?.timestamp?.toMillis?.();
        if (!time || Date.now() - time > 2 * 60 * 60 * 1000 || time > Date.now()) return [];
        return (cached.evidence || []).filter(r => ['youtube', 'tiktok', 'perplexity'].includes(r.source) && typeof r.text === 'string')
            .map(r => ({ source: r.source, text: r.text.slice(0, 4000), observedAt: new Date(time).toISOString() }));
    } catch { return []; }
}
