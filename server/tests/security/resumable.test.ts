import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ResumableUploads, CHUNK_BYTES } from '../../src/services/resumable-upload.js';

test('resumable uploads: owner-scoped, retry-safe, resumable and byte-identical', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kengan-resumable-test-'));
    try {
        const uploads = new ResumableUploads(path.join(root, 'sessions'), path.join(root, 'out'));
        const size = CHUNK_BYTES + 1000;
        const data = randomBytes(size);
        const parts = [data.subarray(0, CHUNK_BYTES), data.subarray(CHUNK_BYTES)];
        const session = await uploads.create('alice', 'ws1', { size, type: 'video/mp4', name: 'clip.mp4' });

        await uploads.put(session.id, 'alice', 'ws1', 1, parts[1]);
        await uploads.put(session.id, 'alice', 'ws1', 1, parts[1]); // retry of the same bytes
        const changed = Buffer.from(parts[1]); changed[0] ^= 1;
        await assert.rejects(uploads.put(session.id, 'alice', 'ws1', 1, changed), { status: 409 });
        await assert.rejects(uploads.put(session.id, 'alice', 'ws1', 0, parts[0].subarray(1)), { status: 400 });
        await assert.rejects(uploads.status(session.id, 'bob', 'ws1'), { status: 404 });
        await assert.rejects(uploads.status(session.id, 'alice', 'ws2'), { status: 404 });
        await assert.rejects(uploads.status('../escape', 'alice', 'ws1'), { status: 404 });

        assert.deepEqual((await uploads.status(session.id, 'alice', 'ws1')).received, [1]);
        await assert.rejects(uploads.complete(session.id, 'alice', 'ws1'), { status: 409 });
        await uploads.put(session.id, 'alice', 'ws1', 0, parts[0]);

        const done = await uploads.complete(session.id, 'alice', 'ws1');
        assert.ok(fs.readFileSync(done.path).equals(data));
        assert.equal((await uploads.complete(session.id, 'alice', 'ws1')).path, done.path); // retried complete
        await assert.rejects(uploads.create('alice', 'ws1', { size, type: 'text/html', name: 'x.html' }), { status: 400 });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
