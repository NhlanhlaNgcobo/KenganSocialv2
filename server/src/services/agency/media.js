import fs from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { FFMPEG, probe, run } from '../ffmpeg-runner.js';
import { deleteFile, uploadFile, uploadLocalFile } from '../storage.service.js';

/**
 * Library media: checks an uploaded video, makes a poster frame and stores both durably
 * (storage driver: local disk, S3/R2 or Firebase), under workspaces/{id}/library/{assetId}/.
 */

export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

const POSTER_DIR = path.join(os.tmpdir(), 'kengan-renders');

async function makePoster(videoPath, duration) {
    fs.mkdirSync(POSTER_DIR, { recursive: true });
    const out = path.join(POSTER_DIR, `libposter_${uuidv4()}.jpg`);
    try {
        const at = Math.min(1, Math.max(0, duration / 3));
        await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at.toFixed(2), '-i', videoPath, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', out]);
        return fs.readFileSync(out);
    } catch {
        return null;
    } finally {
        fs.rm(out, { force: true }, () => {});
    }
}

/**
 * @param {object} opts
 * @param {string} opts.filePath   local file (an upload or a render)
 * @param {string} opts.mimeType
 * @param {string} opts.workspaceId
 * @param {string} opts.assetId
 * @returns {Promise<{ url, posterUrl, bytes, duration, width, height, mime }>}
 */
export async function storeVideo({ filePath, mimeType, workspaceId, assetId }) {
    const info = await probe(filePath).catch(() => null);
    if (!info?.hasVideo) throw Object.assign(new Error('This file is not a video we can play. Export it as MP4 and try again.'), { status: 400 });
    const bytes = fs.statSync(filePath).size;
    const folder = `workspaces/${workspaceId}/library/${assetId}`;
    const mime = VIDEO_TYPES.includes(mimeType) ? mimeType : 'video/mp4';
    const url = await uploadLocalFile(filePath, folder, mime);
    const poster = await makePoster(filePath, info.duration);
    const posterUrl = poster ? await uploadFile(poster, folder, 'image/jpeg').catch(() => null) : null;
    return { url, posterUrl, bytes, duration: Math.round(info.duration * 10) / 10, width: info.width, height: info.height, mime };
}

/** Deletes every stored file of an asset's versions (best effort). */
export async function deleteVersions(versions = []) {
    for (const v of versions) {
        if (v.url) await deleteFile(v.url).catch(() => {});
        if (v.posterUrl) await deleteFile(v.posterUrl).catch(() => {});
    }
}
