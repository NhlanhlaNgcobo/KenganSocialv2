import IORedis from 'ioredis';

// Shared Redis client — used for usage counters, rate limiting, and caching
export const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: null, // Critical for BullMQ or long-running dev
    retryStrategy: (times: number) => {
        if (process.env.NODE_ENV === 'development' && times > 1) {
            console.warn(`[Redis] Skipping connection in development mode.`);
            return null; // Stop retrying quickly in dev
        }
        return Math.min(times * 500, 2000);
    }
});

redis.on('error', (err: Error) => {
    // Only warn — don't throw.
    if (process.env.NODE_ENV === 'development') {
        console.warn('[Redis] Offline (Development Mode)');
    } else {
        console.error('[Redis] Connection error:', err.message);
    }
});

redis.on('connect', () => console.log('✅ Redis connected'));
