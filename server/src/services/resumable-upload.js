import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export const CHUNK_BYTES = 8 * 1024 * 1024;
const DAY = 86400000;
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const reject = (status, message) => Object.assign(new Error(message), { status });

/** Disk-backed upload sessions for the single shared-volume deployment. */
export class ResumableUploads {
    constructor(root, outputRoot) { this.root = root; this.outputRoot = outputRoot; }
    directory(id) {
        if (!/^[a-f0-9-]{36}$/.test(id)) throw reject(404, 'Upload session not found');
        return path.join(this.root, id);
    }
    async create(owner, workspaceId, input) {
        if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > 2 * 1024 ** 3) throw reject(400, 'Choose a file between 1 byte and 2 GB');
        if (!/^(video|audio|image)\//.test(input.type || '')) throw reject(400, 'Choose a video, audio or image file');
        await fs.mkdir(this.root, { recursive: true });
        let active = 0;
        for (const id of await fs.readdir(this.root)) {
            if (!/^[a-f0-9-]{36}$/.test(id)) continue;
            const folder = this.directory(id);
            const meta = await fs.readFile(path.join(folder, 'session.json'), 'utf8').then(JSON.parse).catch(() => null);
            if (meta && meta.expires < Date.now()) await fs.rm(folder, { recursive: true, force: true });
            else if (meta?.owner === owner && !meta.completed) active++;
        }
        if (active >= 3) throw reject(429, 'Finish existing uploads before starting another');
        const id = randomUUID();
        const meta = { id, owner, workspaceId, size: input.size, type: input.type, name: String(input.name || 'media').slice(0, 180), expires: Date.now() + DAY };
        await fs.mkdir(this.directory(id));
        await fs.writeFile(path.join(this.directory(id), 'session.json'), JSON.stringify(meta), { flag: 'wx' });
        return { ...meta, chunkBytes: CHUNK_BYTES };
    }
    async read(id, owner, workspaceId) {
        const meta = await fs.readFile(path.join(this.directory(id), 'session.json'), 'utf8').then(JSON.parse).catch(() => null);
        if (!meta || meta.owner !== owner || meta.workspaceId !== workspaceId || meta.expires < Date.now()) throw reject(404, 'Upload session not found or expired');
        return meta;
    }
    async status(id, owner, workspaceId) {
        const meta = await this.read(id, owner, workspaceId);
        const chunks = {};
        for (const name of await fs.readdir(this.directory(id))) {
            if (!/^\d+\.chunk$/.test(name)) continue;
            chunks[name.split('.')[0]] = hash(await fs.readFile(path.join(this.directory(id), name)));
        }
        return { id, size: meta.size, chunkBytes: CHUNK_BYTES, chunks };
    }
    async put(id, owner, workspaceId, index, buffer) {
        const meta = await this.read(id, owner, workspaceId);
        const count = Math.ceil(meta.size / CHUNK_BYTES);
        if (!Number.isInteger(index) || index < 0 || index >= count || !Buffer.isBuffer(buffer) || buffer.length !== Math.min(CHUNK_BYTES, meta.size - index * CHUNK_BYTES)) throw reject(400, 'Invalid upload chunk');
        const folder = this.directory(id);
        const target = path.join(folder, `${index}.chunk`);
        const temporary = path.join(folder, `${randomUUID()}.part`);
        await fs.writeFile(temporary, buffer, { flag: 'wx' });
        try {
            await fs.link(temporary, target); // Atomic create; a retry cannot replace different bytes.
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            if (hash(await fs.readFile(target)) !== hash(buffer)) throw reject(409, 'This chunk does not match the existing upload');
        } finally { await fs.unlink(temporary).catch(() => {}); }
        return { index, hash: hash(buffer) };
    }
    async complete(id, owner, workspaceId) {
        const meta = await this.read(id, owner, workspaceId);
        await fs.mkdir(this.outputRoot, { recursive: true });
        const extension = /^\.(mp4|mov|webm|m4v|mp3|wav|m4a|png|jpg|jpeg|webp)$/i.test(path.extname(meta.name)) ? path.extname(meta.name).toLowerCase() : '.bin';
        const output = path.join(this.outputRoot, `source_${id}${extension}`);
        const temp = `${output}.${randomUUID()}.part`;
        const handle = await fs.open(temp, 'wx');
        try {
            for (let i = 0; i < Math.ceil(meta.size / CHUNK_BYTES); i++) {
                const chunk = await fs.readFile(path.join(this.directory(id), `${i}.chunk`)).catch(() => { throw reject(409, 'Upload is incomplete'); });
                if (chunk.length !== Math.min(CHUNK_BYTES, meta.size - i * CHUNK_BYTES)) throw reject(409, 'Upload chunk is incomplete');
                await handle.writeFile(chunk);
            }
            await handle.sync();
            await handle.close();
            await fs.rename(temp, output);
            // Keep chunks for retrying the final response; expired sessions are swept later.
            const next = path.join(this.directory(id), `${randomUUID()}.json`);
            await fs.writeFile(next, JSON.stringify({ ...meta, completed: true }));
            await fs.rename(next, path.join(this.directory(id), 'session.json'));
            return { path: output, uploadId: id, size: meta.size, filename: meta.name };
        } catch (error) {
            await handle.close().catch(() => {});
            await fs.unlink(temp).catch(() => {});
            throw error;
        }
    }
}
