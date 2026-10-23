import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { LOCAL_UPLOAD_DIR, storageReadUrl } from '../services/storage.service.js';
import { parseMediaUrl, validMediaSignature } from '../services/media-links.js';

const router = Router();
router.get('/:id', async (req, res) => {
    if (!validMediaSignature(req.params.id, req.query.expires, req.query.signature)) return res.status(403).json({ error: 'Media link expired or invalid. Refresh the page.' });
    const origin = (process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');
    const ref = parseMediaUrl(`${origin}/api/private-media/${req.params.id}`);
    if (!ref) return res.status(400).end();
    res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    try {
        if (ref.driver === 'local') {
            const root = await fs.realpath(LOCAL_UPLOAD_DIR);
            const file = await fs.realpath(path.resolve(root, ref.key));
            if (!file.startsWith(root + path.sep)) return res.status(403).end();
            // Untrusted SVG/HTML must never execute on the API origin.
            if (!/\.(mp4|mov|webm|mp3|wav|m4a|png|jpg|jpeg|gif|webp)$/i.test(file)) res.attachment(path.basename(file));
            return res.sendFile(file);
        }
        res.redirect(await storageReadUrl(ref));
    } catch { res.status(404).json({ error: 'Media unavailable.' }); }
});
export default router;
