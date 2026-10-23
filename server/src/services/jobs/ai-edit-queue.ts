import { Queue } from 'bullmq';
import { usageRedis, readyUsageRedis } from '../../utils/usageRedis';

export const AI_EDIT_QUEUE = 'ai-edit-v1';
export function createAiEditQueue(connection: any, name = AI_EDIT_QUEUE) {
    return new Queue(name, { connection, defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 7 * 86400, count: 1000 } } });
}
let queue: Queue | undefined;
export async function enqueueAiEdit(id: string, type: 'style' | 'edit', context: any) {
    // Producer commands fail promptly; never acknowledge a job until Redis has persisted it.
    await readyUsageRedis();
    queue ||= createAiEditQueue(usageRedis);
    await queue.add(type, { id, context }, { jobId: id, attempts: 2,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 7 * 86400, count: 1000 } });
}
