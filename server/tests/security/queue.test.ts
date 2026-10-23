import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { Worker, QueueEvents } from 'bullmq';
import { createAiEditQueue } from '../../src/services/jobs/ai-edit-queue';

test('AI queue survives producer restart and retries a failed attempt without duplicating submissions', { timeout: 15000 }, async () => {
    const name = `test-ai-${randomUUID()}`;
    const connection = new IORedis('redis://127.0.0.1:6379', { maxRetriesPerRequest: null });
    const first = createAiEditQueue(connection, name);
    const job = await first.add('edit', { id: 'unique', context: { source: 'fixture' } }, { jobId: 'unique', backoff: { type: 'fixed', delay: 50 } });
    await first.close();
    const second = createAiEditQueue(connection, name);
    const events = new QueueEvents(name, { connection });
    await events.waitUntilReady();
    let attempts = 0;
    const worker = new Worker(name, async () => { attempts++; if (attempts === 1) throw new Error('temporary'); return 'done'; }, { connection, concurrency: 1 });
    try {
        await second.add('edit', { id: 'unique' }, { jobId: 'unique' });
        const restored = await second.getJob(job.id!);
        assert.equal(await restored!.waitUntilFinished(events, 10000), 'done');
        assert.equal(attempts, 2);
        assert.equal(await second.getCompletedCount(), 1);
    } finally {
        await worker.close(); await events.close(); await second.obliterate({ force: true }); await second.close(); await connection.quit();
    }
});
