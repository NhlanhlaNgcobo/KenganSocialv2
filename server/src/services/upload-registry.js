import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ID = /^[a-zA-Z0-9_-]{1,128}$/;
export class UploadRegistry {
    constructor(root, mediaRoot) {
        this.root = path.resolve(root);
        this.mediaRoot = fs.realpathSync(mediaRoot);
        fs.mkdirSync(this.root, { recursive: true });
    }
    mediaPath(filePath) {
        const real = fs.realpathSync(filePath);
        const rel = path.relative(this.mediaRoot, real);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !fs.statSync(real).isFile()) throw new Error('Invalid media path');
        return real;
    }
    store(id, filePath, ownerId) {
        if (!ID.test(id) || typeof ownerId !== 'string' || !ownerId) throw new Error('Upload owner and valid ID required');
        const entry = { filePath: this.mediaPath(filePath), ownerId };
        const target = path.join(this.root, `${id}.json`);
        const temp = path.join(this.root, `${id}.${randomUUID()}.tmp`);
        fs.writeFileSync(temp, JSON.stringify(entry), { mode: 0o600 });
        fs.renameSync(temp, target);
    }
    get(id, ownerId = null) {
        if (typeof id !== 'string' || !ID.test(id)) return null;
        try {
            const entry = JSON.parse(fs.readFileSync(path.join(this.root, `${id}.json`), 'utf8'));
            if (!entry.ownerId || (ownerId !== null && entry.ownerId !== ownerId)) return null;
            return this.mediaPath(entry.filePath);
        } catch { return null; }
    }
}
