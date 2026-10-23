import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import '../../src/config/firebase.js';
import { getAuth as firebaseAuth } from 'firebase-admin/auth';
import { db } from '../../src/utils/firestore';
import { withWorkspace } from '../../src/middleware/withWorkspace';
import { requireWorkspaceRole } from '../../src/middleware/workspaceAccess';

test('tenant middleware denies null scopes, stale membership, viewers and foreign workspaces', async () => {
    const auth = firebaseAuth();
    const verify = auth.verifyIdToken;
    const collection = db.collection;
    (auth as any).verifyIdToken = async (uid: string) => ({ uid });
    const workspace = { ownerId: 'owner', plan: 'starter' };
    (db as any).collection = () => ({
        doc: (id: string) => ({
            id, get: async () => ({ id, exists: id === 'mine', data: () => workspace }),
            collection: () => ({ doc: (uid: string) => ({ get: async () => ({ exists: ['viewer', 'editor', 'admin'].includes(uid), data: () => ({ role: uid }) }) }) }),
        }),
        where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
    });
    const app = express();
    app.use(withWorkspace);
    app.get('/read', (_req, res) => res.json({ ok: true }));
    app.post('/publish', (_req, res) => res.json({ ok: true }));
    app.post('/budget', requireWorkspaceRole('owner', 'admin'), (_req, res) => res.json({ ok: true }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const send = (uid: string, route: string, method = 'POST', ws?: string) => fetch(base + route, { method, headers: { Authorization: `Bearer ${uid}`, ...(ws ? { 'x-workspace-id': ws } : {}) } });
    try {
        assert.equal((await send('owner', '/publish')).status, 403);
        assert.equal((await send('owner', '/publish', 'POST', 'foreign')).status, 403);
        assert.equal((await send('revoked', '/publish', 'POST', 'mine')).status, 403);
        assert.equal((await send('viewer', '/read', 'GET', 'mine')).status, 200);
        assert.equal((await send('viewer', '/publish', 'POST', 'mine')).status, 403);
        assert.equal((await send('editor', '/publish', 'POST', 'mine')).status, 200);
        assert.equal((await send('editor', '/budget', 'POST', 'mine')).status, 403);
        assert.equal((await send('admin', '/budget', 'POST', 'mine')).status, 200);
        assert.equal((await send('owner', '/budget', 'POST', 'mine')).status, 200);
    } finally {
        server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
        auth.verifyIdToken = verify; db.collection = collection;
    }
});
