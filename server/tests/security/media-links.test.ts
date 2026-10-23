import test from 'node:test';
import assert from 'node:assert/strict';
import { storedMediaUrl, parseMediaUrl, signMediaUrl, validMediaSignature, signMediaResponse, validMediaKey } from '../../src/services/media-links.js';

test('private media rejects expired, forged and cross-workspace links', () => {
    const previous = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = 'test-only-media-key-not-for-deployment';
    try {
        const stored = storedMediaUrl('local', 'workspaces/mine/original.mp4');
        const signed = new URL(signMediaUrl(stored, 60));
        const ref = parseMediaUrl(stored)!;
        const expires = signed.searchParams.get('expires');
        const sig = signed.searchParams.get('signature');
        assert.equal(validMediaSignature(ref.id, expires, sig), true);
        assert.equal(validMediaSignature(ref.id, expires, sig, Date.now() + 61000), false);
        assert.equal(validMediaSignature(ref.id + 'a', expires, sig), false);
        assert.equal(validMediaSignature(ref.id, expires, '0'.repeat(64)), false);
        assert.equal(validMediaKey('../secret'), false);
        let result: any;
        const response = { json: (body: any) => { result = body; } };
        signMediaResponse({ workspaceId: 'other' }, response, () => {});
        response.json({ media: stored });
        assert.equal(result.media, null);
        const allowed = { json: (body: any) => { result = body; } };
        signMediaResponse({ workspaceId: 'mine' }, allowed, () => {});
        allowed.json({ nested: [stored] });
        assert.match(result.nested[0], /signature=/);
    } finally {
        if (previous === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
        else process.env.TOKEN_ENCRYPTION_KEY = previous;
    }
});
