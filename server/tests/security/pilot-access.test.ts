import test from 'node:test';
import assert from 'node:assert/strict';
import { createPilotAccess } from '../../src/middleware/pilotAccess.js';

const emails = new Set(['invited@example.com']);
async function request(token: any, header = 'Bearer token', allow = emails) {
    const response: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } };
    let passed = false;
    await createPilotAccess(allow, async (_token: string, revoked: boolean) => {
        assert.equal(revoked, true);
        if (token instanceof Error) throw token;
        return token;
    })({ headers: { authorization: header } }, response, () => { passed = true; });
    return { passed, status: response.statusCode };
}
test('pilot requires a signed, verified and invited identity', async () => {
    assert.deepEqual(await request({ email: 'Invited@Example.com', email_verified: true }), { passed: true, status: 200 });
    assert.equal((await request({ email: 'other@example.com', email_verified: true })).status, 403);
    assert.equal((await request({ email: 'invited@example.com', email_verified: false })).status, 403);
    assert.equal((await request({ email: 'invited@example.com', email_verified: true }, '')).status, 401);
    assert.equal((await request(new Error('revoked'))).status, 401);
    assert.equal((await request({}, '', null)).passed, true);
});

test('the invite list holds 1 to 10 unique addresses', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { loadPilotEmails } = await import('../../src/middleware/pilotAccess.js');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), 'pilot-access.json');
    const load = (emails: string[]) => { fs.writeFileSync(file, JSON.stringify({ emails })); return loadPilotEmails(file); };
    const list = (n: number) => Array.from({ length: n }, (_, i) => `tester${i}@example.com`);
    assert.equal(load(list(1))?.size, 1);
    assert.equal(load(list(6))?.size, 6);
    assert.equal(load(list(10))?.size, 10);
    assert.throws(() => load([]));
    assert.throws(() => load(list(11)));
    assert.throws(() => load(['a@example.com', 'A@example.com']), /unique/);
    assert.equal(loadPilotEmails(path.join(path.dirname(file), 'missing.json')), null, 'no file: the gate is off');
});
