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
