import { Router, raw } from 'express';
import path from 'node:path';
import os from 'node:os';
import { ResumableUploads } from '../services/resumable-upload.js';
import { storeUpload } from '../services/manual-edit.service.js';

const uploads = new ResumableUploads(path.join(os.tmpdir(), 'kengan-resumable'), path.join(os.tmpdir(), 'kengan-renders'));
const router = Router(); // Parent already enforces authentication, workspace and writer role.
const route = handler => async (req, res) => {
    try { await handler(req, res); }
    catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Upload could not be saved. Retry shortly.' }); }
};
router.post('/', route(async (req, res) => {
    const session = await uploads.create(req.uid, req.workspaceId, req.body);
    res.status(201).json({ id: session.id, chunkBytes: session.chunkBytes });
}));
router.get('/:id', route(async (req, res) => res.json(await uploads.status(req.params.id, req.uid, req.workspaceId))));
router.put('/:id/:index', raw({ type: 'application/octet-stream', limit: '8mb' }), route(async (req, res) => {
    res.json(await uploads.put(req.params.id, req.uid, req.workspaceId, Number(req.params.index), req.body));
}));
router.post('/:id/complete', route(async (req, res) => {
    const result = await uploads.complete(req.params.id, req.uid, req.workspaceId);
    storeUpload(result.uploadId, result.path, req.uid);
    const { path: _path, ...body } = result;
    res.json(body);
}));
export default router;
