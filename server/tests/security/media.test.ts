import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UploadRegistry } from '../../src/services/upload-registry.js';
import { requireOwnedUpload } from '../../src/middleware/ownedUpload.js';
import { readiness } from '../../src/services/readiness.js';

test('upload ownership survives restart and rejects foreign, missing and traversing IDs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kengan-registry-test-'));
    try {
        const file = path.join(root, 'source.mp4'); fs.writeFileSync(file, 'test media');
        const first = new UploadRegistry(path.join(root, 'registry'), root);
        first.store('upload-one', file, 'alice');
        const restarted = new UploadRegistry(path.join(root, 'registry'), root);
        assert.equal(restarted.get('upload-one', 'alice'), fs.realpathSync(file));
        assert.equal(restarted.get('upload-one', 'bob'), null);
        assert.equal(restarted.get('../upload-one', 'alice'), null);
        assert.throws(() => first.store('no-owner', file, null));
        fs.unlinkSync(file);
        assert.equal(restarted.get('upload-one', 'alice'), null);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('video input middleware rejects URL-only and missing uploads before invoking downstream code', () => {
    for (const body of [{ videoUrl: 'http://127.0.0.1/private' }, { videoUrl: 'file:///etc/passwd' }, { sourceUploadId: '../secret' }]) {
        let status = 0; let called = false;
        const res = { status(code: number) { status = code; return this; }, json() {} };
        requireOwnedUpload({ body, uid: 'alice' }, res, () => { called = true; });
        assert.equal(status, 400); assert.equal(called, false);
    }
});

test('readiness reports failures and bounds stalled dependencies', async () => {
    assert.equal((await readiness({ ok: async () => true })).ready, true);
    const result = await readiness({ ok: async () => true, broken: async () => { throw new Error('secret'); }, hung: () => new Promise(() => {}) }, 20);
    assert.equal(result.ready, false);
    assert.deepEqual(result.dependencies, { ok: 'ready', broken: 'unavailable', hung: 'unavailable' });
    assert.equal(JSON.stringify(result).includes('secret'), false);
});
