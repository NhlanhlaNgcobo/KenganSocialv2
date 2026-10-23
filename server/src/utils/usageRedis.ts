import IORedis from 'ioredis';
// API accounting must fail promptly. BullMQ retains its separate retrying client.
export const usageRedis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1,
    connectTimeout: 3000, commandTimeout: 5000,
});
usageRedis.on('error', () => {});
export async function readyUsageRedis() {
    if (usageRedis.status === 'wait') await usageRedis.connect();
    if (usageRedis.status !== 'ready') throw new Error('Usage store unavailable');
    return usageRedis;
}
