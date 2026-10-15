import type { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import sharp from 'sharp';
import { db } from '../../utils/firestore';

/** Shared helpers for the Marketing routes. */

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Express 4 does not catch async errors; keep every failure a JSON response. */
export const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch((error: any) => {
        console.error(`[Marketing] ${req.method} ${req.originalUrl} failed:`, error.message);
        if (res.headersSent) return next(error);
        res.status(error.status || 500).json({ error: error.status ? error.message : 'Something went wrong. Try again.' });
    });

export const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

export function requireWorkspace(req: Request, res: Response, next: NextFunction) {
    if (!(req as any).workspaceId) return res.status(403).json({ error: 'Create or join a workspace first.' });
    next();
}

/** Changes need owner, admin or editor; viewers can only look. */
export async function requireEditor(req: Request, res: Response, next: NextFunction) {
    try {
        const ws = await db.collection('workspaces').doc((req as any).workspaceId).get();
        if (ws.data()?.ownerId === (req as any).uid) return next();
        const member = await ws.ref.collection('members').doc((req as any).uid).get();
        if (['owner', 'admin', 'editor'].includes(member.data()?.role)) return next();
        res.status(403).json({ error: 'Only owners, admins and editors can change this.' });
    } catch (error: any) {
        console.error('[Marketing] Role check failed:', error.message);
        res.status(500).json({ error: 'Could not check your permissions.' });
    }
}

export const workspaceRef = (req: Request) => db.collection('workspaces').doc((req as any).workspaceId);

/**
 * Reads one of OUR stored files (URLs written by this server into our storage) as a data URL.
 * Never call this with a user-supplied URL: it does not apply SSRF checks.
 */
export async function storedFileAsDataUrl(url: string | null | undefined, opts: { maxWidth?: number; jpeg?: boolean } = {}) {
    if (!url) return null;
    try {
        const { data, headers } = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000, maxContentLength: 20 * 1024 * 1024 });
        let buffer = Buffer.from(data);
        let mime = String(headers['content-type'] || 'image/png').split(';')[0];
        if (opts.maxWidth || opts.jpeg) {
            let img = sharp(buffer).rotate();
            if (opts.maxWidth) img = img.resize(opts.maxWidth, null, { withoutEnlargement: true });
            buffer = opts.jpeg ? await img.jpeg({ quality: 86 }).toBuffer() : await img.png().toBuffer();
            mime = opts.jpeg ? 'image/jpeg' : 'image/png';
        }
        return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch (error: any) {
        console.warn('[Marketing] Could not read stored file:', error.message);
        return null;
    }
}
