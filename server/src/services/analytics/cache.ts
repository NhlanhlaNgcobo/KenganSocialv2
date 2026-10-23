import { createHash } from 'node:crypto';
import { fetchConnectionAnalytics } from './analyticsService';

// Cache only after authorization; connection fingerprint invalidates on reconnect/account changes.
const cache = new Map<string, { expires: number; value: ReturnType<typeof fetchConnectionAnalytics> }>();
export function cachedConnectionAnalytics(workspaceId: string, platform: string, connection: any, days: number) {
    const fingerprint = createHash('sha256').update(JSON.stringify(connection)).digest('hex');
    const key = `${workspaceId}:${platform}:${days}:${fingerprint}`;
    const existing = cache.get(key);
    if (existing && existing.expires > Date.now()) return existing.value;
    for (const [id, entry] of cache) if (entry.expires <= Date.now()) cache.delete(id);
    if (cache.size >= 500) cache.delete(cache.keys().next().value!);
    const value = fetchConnectionAnalytics(workspaceId, platform, connection, days)
        .then(result => { if (result.status !== 'ok') cache.delete(key); return result; })
        .catch(error => { cache.delete(key); throw error; });
    cache.set(key, { value, expires: Date.now() + 60000 });
    return value;
}
