import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run, FFMPEG } from '../../src/services/ffmpeg-runner.js';
import { cloudTranscribe, useCloudTranscription } from '../../src/services/clips/cloud-transcribe.js';
import { whisperTranscribe } from '../../src/services/speech/whisper-api.js';

test('chunk transcription preserves order, offsets, progress and provider fallback', async (t) => {
    const env = { ...process.env };
    const originalFetch = globalThis.fetch;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clips-test-'));
    t.after(async () => { globalThis.fetch = originalFetch; process.env = env; await fs.rm(dir, { recursive: true, force: true }); });
    process.env.OPENROUTER_API_KEY = 'test-placeholder';
    process.env.OPENAI_API_KEY = 'test-placeholder';
    delete process.env.CLIP_TRANSCRIBE;
    delete process.env.CLOUD_TRANSCRIBE_MIN_MINUTES;
    assert.equal(useCloudTranscription(599), false);
    assert.equal(useCloudTranscription(600), true);
    const file = path.join(dir, 'audio.mp3');
    await run(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=610', '-ar', '16000', '-b:a', '16k', file]);
    let active = 0, maxActive = 0;
    const attempts = [];
    globalThis.fetch = async (url, { body }) => {
        const index = Number(body.get('file').name.match(/piece-(\d+)/)[1]);
        attempts.push([index, String(url)]);
        active++; maxActive = Math.max(maxActive, active);
        await new Promise(r => setTimeout(r, (3 - index) * 20));
        active--;
        if (index === 1 && String(url).includes('openrouter')) return new Response('Unavailable', { status: 503 });
        return Response.json({ text: 'hello', language: 'en', words: [{ word: 'hello', start: 1, end: 2 }], segments: [{ text: 'hello', start: 1, end: 2 }] });
    };
    const progress = [];
    const result = await cloudTranscribe(file, 610, { onProgress: f => progress.push(f) });
    assert.deepEqual(result.words.map(w => w.start), [1000, 301000, 601000]);
    assert.deepEqual(progress, [1 / 3, 2 / 3, 1]);
    assert.ok(maxActive <= 3);
    assert.equal(result.transcriptionProvider, 'whisper-api:openrouter,openai');
    assert.equal(attempts.filter(([i, url]) => i === 1 && url.includes('openrouter')).length, 2);

    // One rejected worker must not let cleanup race the other active requests.
    globalThis.fetch = async (_url, { body }) => {
        const index = Number(body.get('file').name.match(/piece-(\d+)/)[1]);
        active++;
        await new Promise(r => setTimeout(r, index === 0 ? 5 : 100));
        active--;
        return new Response('Unavailable', { status: 503 });
    };
    await assert.rejects(cloudTranscribe(file, 610), /503/);
    assert.equal(active, 0);
});

test('shared lyric/clip transcriber rejects malformed timing and preserves valid word segments', async (t) => {
    const old = globalThis.fetch;
    const key = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'test-placeholder';
    t.after(() => { globalThis.fetch = old; if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key; });
    globalThis.fetch = async () => Response.json({ text: 'hello', words: [{ word: 'hello', start: 'bad', end: 1 }] });
    await assert.rejects(whisperTranscribe(Buffer.from('audio')), /usable word timestamps/);
    globalThis.fetch = async () => Response.json({ text: 'hello', words: [{ word: 'hello', start: 0.2, end: 0.7 }], segments: [{ text: 'hello', start: 0, end: 1 }] });
    const result = await whisperTranscribe(Buffer.from('audio'));
    assert.deepEqual(result.segments[0].words, [{ text: 'hello', start: 0.2, end: 0.7 }]);
});
