import '../../src/config/firebase.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { db } from '../../src/utils/firestore';
import { redis } from '../../src/utils/redis';

test('HTTP routes enforce tenant/role boundaries and idempotent render submission', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const records = new Map<string, any>([[id, { workspaceId: 'mine', userId: 'owner', name: 'Bottle', duration: 20, format: 'vertical', script: 'Meet the bottle.', status: 'draft', createdAt: 1, scenes: [] }]]);
    const refFor = (key: string): any => ({ id: key, get: async () => ({ exists: records.has(key), data: () => records.get(key) }), update: async (patch: any) => records.set(key, { ...records.get(key), ...patch }), delete: async () => records.delete(key) });
    const oldCollection = db.collection.bind(db);
    const oldTransaction = db.runTransaction.bind(db);
    (db as any).collection = (name: string) => name === 'workspaces' ? {
        doc: () => ({ get: async () => ({ data: () => ({ ownerId: 'owner' }), ref: { collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({ role: 'viewer' }) }) }) }) } }) }),
    } : {
        doc: refFor,
        where: (field: string, _op: string, value: string) => ({ limit: () => ({ get: async () => ({ size: 0, docs: field === 'workspaceId' ? [...records].filter(([,d])=>d.workspaceId===value).map(([key,d])=>({id:key,data:()=>d,ref:refFor(key)})) : [] }) }) }),
    };
    (db as any).runTransaction = async (fn: any) => fn({ get: (ref: any) => ref.get(), update: (ref: any, patch: any) => ref.update(patch) });
    process.env.ELEVENLABS_API_KEY = 'test-only';
    process.env.TREBLO_API_KEY = 'test-only';
    const { default: router } = await import('../../src/routes/marketing-video-ads');
    const { stopVideoAdWorker } = await import('../../src/services/video-ads/jobs');
    stopVideoAdWorker();
    const app = express();
    app.use(express.json());
    app.use((req: any,_res,next)=>{req.workspaceId=req.headers['x-test-workspace']||'mine';req.uid=req.headers['x-test-user']||'owner';req.plan='nano';next();});
    app.use('/ads',router);
    const server = app.listen(0,'127.0.0.1');
    await new Promise<void>(resolve=>server.once('listening',resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}/ads`;
    try {
        const alien = await fetch(`${base}/${id}`,{headers:{'x-test-workspace':'other'}});
        assert.equal(alien.status,404);
        const alienMedia = await fetch(`${base}/${id}/media/video`,{headers:{'x-test-workspace':'other'}});
        assert.equal(alienMedia.status,404);
        const viewer = await fetch(`${base}/${id}/render`,{method:'POST',headers:{'x-test-user':'viewer','Content-Type':'application/json'},body:'{}'});
        assert.equal(viewer.status,403);
        const invalid = await fetch(`${base}/${id}/render`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
        assert.equal(invalid.status,400);
        const body = JSON.stringify({script:'Meet the bottle.',voiceId:'testvoice12345',music:false,confirmed:true});
        const submit = () => fetch(`${base}/${id}/render`,{method:'POST',headers:{'Content-Type':'application/json'},body});
        assert.equal((await submit()).status,202);
        const billing = records.get(id).billing;
        assert.equal((await submit()).status,202);
        assert.deepEqual(records.get(id).billing,billing);
        assert.equal(records.get(id).status,'queued');
        const deletion=await fetch(`${base}/${id}`,{method:'DELETE'});
        assert.equal(deletion.status,409);
        const mine=await fetch(base);
        const data=await mine.json() as any;
        assert.equal(data.ads.length,1);
        assert.equal('billing' in data.ads[0],false);
        assert.equal('settings' in data.ads[0],false);
    } finally {
        stopVideoAdWorker();
        await new Promise<void>(resolve=>server.close(()=>resolve()));
        (db as any).collection=oldCollection;
        (db as any).runTransaction=oldTransaction;
        redis.disconnect();
    }
});
