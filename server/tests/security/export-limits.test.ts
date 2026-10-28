import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test('exports: one at a time with EXPORT_CONCURRENCY=1, queued ones can be cancelled', async () => {
    process.env.EXPORT_CONCURRENCY = '1';
    const { runExport, cancelExport, exportQueueState, queuePosition } = await import('../../src/services/export-queue.js');
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const job = (id: string, ms: number) =>
        runExport(id, { timeoutMs: 5000, onStart: () => order.push(`start ${id}`) }, async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((r) => setTimeout(r, ms));
            active -= 1;
            return id;
        });
    const a = job('a', 80);
    const b = job('b', 10);
    const c = job('c', 10);
    assert.equal(exportQueueState().running, 1);
    assert.equal(queuePosition('b'), 1);
    assert.equal(queuePosition('c'), 2);
    assert.equal(cancelExport('c'), 'queued');
    const results = await Promise.allSettled([a, b, c]);
    assert.equal(maxActive, 1);
    assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled', 'rejected']);
    assert.equal((results[2] as PromiseRejectedResult).reason.code, 'CANCELLED');
    assert.deepEqual(order, ['start a', 'start b'], 'a cancelled job never starts');
    assert.equal(exportQueueState().running, 0);
    assert.equal(cancelExport('unknown'), null);
});

test('exports: running processes are killed on cancel and on timeout', async () => {
    const { withProcessLimits, run } = await import('../../src/services/ffmpeg-runner.js');
    const sleeper = [process.execPath, ['-e', 'setTimeout(() => {}, 20000)']] as const;

    const controller = new AbortController();
    const started = Date.now();
    const cancelled = withProcessLimits({ signal: controller.signal, deadline: Date.now() + 60000 }, () => run(sleeper[0], [...sleeper[1]]));
    setTimeout(() => controller.abort(), 150);
    await assert.rejects(cancelled, (e: any) => e.code === 'CANCELLED');
    assert.ok(Date.now() - started < 5000, 'killed promptly');

    const t0 = Date.now();
    await assert.rejects(withProcessLimits({ signal: new AbortController().signal, deadline: Date.now() + 200 }, () => run(sleeper[0], [...sleeper[1]])), (e: any) => e.code === 'TIMEOUT');
    assert.ok(Date.now() - t0 < 5000);

    // Outside limits, run() behaves as before.
    assert.equal(String(await run(process.execPath, ['-e', 'process.stdout.write("ok")'])), 'ok');
    const { exportTimeoutMs } = await import('../../src/services/export-queue.js');
    delete process.env.EXPORT_TIMEOUT_S;
    assert.equal(exportTimeoutMs(60), (4 * 60 + 120) * 1000);
    assert.equal(exportTimeoutMs(10 * 3600), 3 * 3600 * 1000, 'capped at 3 hours');
    process.env.EXPORT_TIMEOUT_S = '30';
    assert.equal(exportTimeoutMs(60), 30000);
    delete process.env.EXPORT_TIMEOUT_S;
});

test('exports: fitShortSide keeps aspect and even sizes', async () => {
    const { fitShortSide } = await import('../../src/services/timeline-render.service.js');
    assert.deepEqual(fitShortSide(1080, 1920, 720), { width: 720, height: 1280 });
    assert.deepEqual(fitShortSide(1920, 1080, 720), { width: 1280, height: 720 });
    assert.deepEqual(fitShortSide(1080, 1080, 720), { width: 720, height: 720 });
    assert.equal(fitShortSide(720, 1280, 720), null);
    assert.equal(fitShortSide(1080, 1920, undefined as any), null);
});

test('exports: a real timeline renders at 720p with audio when capped', { timeout: 240000 }, async () => {
    const { FFMPEG, run, probe } = await import('../../src/services/ffmpeg-runner.js');
    const { storeUpload } = await import('../../src/services/manual-edit.service.js');
    const { renderTimeline } = await import('../../src/services/timeline-render.service.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-test-'));
    const src = path.join(dir, 'src.mp4');
    // 4 s 1080x1920 test pattern with a tone.
    await run(FFMPEG, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]);
    const uid = `test-${randomUUID()}`;
    const uploadId = randomUUID();
    storeUpload(uploadId, src, uid);
    const config = {
        version: 2,
        exportFormat: 'tiktok',
        fps: 30,
        duration: 4,
        main: [{ source: uploadId, kind: 'video', sourceStart: 0, sourceEnd: 4, timelineStart: 0 }],
        text: [{ content: 'Hello', start: 0, end: 4, x: 0, y: 0, fontSize: 64, color: '#ffffff' }],
    };
    const out = await renderTimeline(config, uid, () => {}, { maxShortSide: 720 });
    try {
        const info = await probe(out);
        assert.equal(info.width, 720);
        assert.equal(info.height, 1280);
        assert.equal(info.hasAudio, true);
        assert.ok(Math.abs(info.duration - 4) < 0.25, `duration ${info.duration}`);
    } finally {
        fs.rmSync(out, { force: true });
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
