import 'dotenv/config';
import '../config/firebase.js';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { AI_EDIT_QUEUE } from '../services/jobs/ai-edit-queue';
import { jobs, runEditJob, runStyleJob } from '../services/ai-edit/jobs.js';

// Run independently of the API. For now it requires the same shared media volume.
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
const worker = new Worker(AI_EDIT_QUEUE, async job => {
    const ref = jobs().doc(job.data.id);
    const previous = (await ref.get()).data();
    if (!previous || previous.status === 'completed' || previous.status === 'cancelled') return;
    await ref.update({ status: 'processing', stage: 'Starting', updatedAt: new Date().toISOString(), attempt: job.attemptsMade + 1 });
    if (job.name === 'style') await runStyleJob(ref, job.data.context);
    else await runEditJob(ref, job.data.context);
}, { connection, concurrency: 1, lockDuration: 120000 });

worker.on('failed', async (job, error) => {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts || 1);
    await jobs().doc(job.data.id).update({ status: final ? 'failed' : 'processing',
        stage: final ? 'Failed' : 'Retrying', error: final ? 'Processing failed. Please retry or contact support.' : null,
        updatedAt: new Date().toISOString() }).catch(() => {});
    console.error('[AI worker] Job failed', job.id, error.message);
});
const beat = () => connection.set('workers:ai-edit:heartbeat', String(Date.now()), 'EX', 60).catch(() => {});
void beat();
const heartbeat = setInterval(beat, 20000);
heartbeat.unref();

worker.on('error', error => console.error('[AI worker]', error.message));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(heartbeat);
    await worker.close(); // Stop taking new jobs and finish the current one.
    await connection.quit();
    process.exit(0);
});
