import { signMediaUrl, parseMediaUrl, mediaWorkspace } from '../media-links.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import { getStorageDriver, LOCAL_UPLOAD_DIR } from '../storage.service.js';

/**
 * The workspace's brand, as clips use it: an accent colour (caption highlight, hook card, progress
 * bar) and the logo, saved as a local PNG for FFmpeg. From the brand kit in Marketing
 * (workspaces/{id}/brandKit/current). Returns null when the kit has neither.
 */
const HEX = /^#[0-9a-f]{6}$/i;
const CACHE_DIR = path.join(os.tmpdir(), 'kengan-renders');

async function logoFile(url, workspaceId) {
    if (!url) return null;
    const ref = parseMediaUrl(url);
    if (ref && mediaWorkspace(ref.key) !== workspaceId) return null;
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, `brandlogo_${crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)}.png`);
    if (fs.existsSync(file)) return file;
    // Locally stored logos are read from disk rather than over HTTP.
    const local = getStorageDriver() === 'local' ? /\/uploads\/(.+)$/.exec(new URL(url, 'http://local').pathname) : null;
    if (local) {
        const source = path.resolve(LOCAL_UPLOAD_DIR, decodeURIComponent(local[1]));
        if (!source.startsWith(path.resolve(LOCAL_UPLOAD_DIR) + path.sep)) return null;
        if (!fs.existsSync(source)) return null;
        fs.copyFileSync(source, file);
        return file;
    }
    const { data } = await axios.get(signMediaUrl(url), { responseType: 'arraybuffer', timeout: 15000, maxContentLength: 6 * 1024 * 1024 });
    fs.writeFileSync(file, Buffer.from(data));
    return file;
}

export async function loadClipBrand(db, workspaceId) {
    if (!workspaceId) return null;
    const kit = (await db.collection('workspaces').doc(workspaceId).collection('brandKit').doc('current').get()).data();
    if (!kit) return null;
    const accent = [kit.colors?.accent, kit.colors?.primary, kit.colors?.secondary].find((c) => HEX.test(String(c || ''))) || null;
    let logoPath = null;
    try {
        logoPath = await logoFile(kit.logo?.primary || null, workspaceId);
    } catch (error) {
        console.warn('[Clips] Brand logo unavailable:', error.message);
    }
    return accent || logoPath ? { accent: accent ? accent.toLowerCase() : null, logoPath } : null;
}

/** Relative luminance (0 dark … 1 light) of '#rrggbb'. */
export function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
