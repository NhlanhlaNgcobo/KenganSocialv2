import { getUploadPath } from '../services/manual-edit.service.js';

/** Resolve caller-owned media before reserving usage or creating jobs. */
export function requireOwnedUpload(req, res, next) {
    const id = req.body?.sourceUploadId;
    const input = typeof id === 'string' ? getUploadPath(id, req.uid) : null;
    if (!input) return res.status(400).json({ error: 'OWNED_UPLOAD_REQUIRED', message: 'Upload the video before processing it.' });
    req.sourcePath = input;
    next();
}
