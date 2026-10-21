import { db } from '../utils/firestore';

/**
 * Finds the workspaces whose connection matches a platform account, for routing webhooks and
 * deletion requests. Uses a collection-group query (indexes in firestore.indexes.json); until those
 * indexes are deployed, it falls back to reading each workspace's connection directly.
 */
export async function findConnections(field: 'accountId' | 'metaUserId', value: string, platforms: string[]) {
    let docs: FirebaseFirestore.DocumentSnapshot[];
    try {
        docs = (await db.collectionGroup('connections').where(field, '==', value).get()).docs;
    } catch (error: any) {
        if (error.code !== 9) throw error; // 9 = FAILED_PRECONDITION: index missing
        console.warn(`[Connections] connections.${field} collection-group index missing; deploy firestore.indexes.json. Scanning workspaces instead.`);
        docs = [];
        for (const ws of (await db.collection('workspaces').select().get()).docs) {
            for (const platform of platforms) {
                const c = await ws.ref.collection('connections').doc(platform).get();
                if (c.exists && c.data()?.[field] === value) docs.push(c);
            }
        }
    }
    return docs
        .filter((d) => platforms.includes(d.id) || platforms.includes(d.data()?.platform))
        .map((d) => ({ workspaceId: d.ref.parent.parent!.id, platform: d.id, data: d.data()! }));
}
