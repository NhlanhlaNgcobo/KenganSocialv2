import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { storedMediaUrl, parseMediaUrl, signMediaUrl, mediaWorkspace } from './media-links.js';
import { getStorage } from '../config/firebase.js';
import { v4 as uuidv4 } from 'uuid';
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';

/**
 * Storage backend, chosen by STORAGE_DRIVER:
 *   firebase (default) - Firebase / Google Cloud Storage bucket
 *   s3                 - any S3-compatible bucket (Backblaze B2, Cloudflare R2, ...)
 *   local              - files on this server's disk under ./uploads, served at /uploads
 */
export function getStorageDriver() {
    return (process.env.STORAGE_DRIVER || 'firebase').toLowerCase();
}

const EXTENSIONS = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'video/quicktime': 'mov',
    'video/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'application/pdf': 'pdf',
};

export const LOCAL_UPLOAD_DIR = path.resolve(process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads'));

// ---------------------
// Firebase
// ---------------------

function getCandidateBucketNames() {
    const configured = process.env.FIREBASE_STORAGE_BUCKET;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    return [...new Set([configured, projectId ? `${projectId}.appspot.com` : null, projectId ? `${projectId}.firebasestorage.app` : null].filter(Boolean))];
}

async function resolveWritableBucket() {
    const storage = getStorage();
    let lastError = null;

    for (const bucketName of getCandidateBucketNames()) {
        try {
            const bucket = storage.bucket(bucketName);
            await bucket.getMetadata();
            return bucket;
        } catch (error) {
            lastError = error;
            console.error(`[Storage Service] Bucket check failed for ${bucketName}:`, error.message || error);
        }
    }

    throw lastError || new Error('No valid Firebase Storage bucket available');
}

// ---------------------
// S3-compatible (B2 / R2)
// ---------------------

let s3Client = null;

function getS3() {
    if (!s3Client) {
        s3Client = new S3Client({
            endpoint: process.env.S3_ENDPOINT,
            region: process.env.S3_REGION || 'auto',
            credentials: {
                accessKeyId: process.env.S3_ACCESS_KEY_ID,
                secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
            },
        });
    }
    return s3Client;
}

function s3PublicBase() {
    return (process.env.S3_PUBLIC_URL || '').replace(/\/+$/, '');
}

// ---------------------
// Local disk
// ---------------------

/**
 * Base URL for locally stored files, as saved in the database and shown in the app.
 * In development this is the local API (http://localhost:PORT), so files display even when the
 * public tunnel is down; in production it is SERVER_URL. LOCAL_MEDIA_BASE_URL overrides both.
 * Platforms that download media themselves get the public address via publicMediaUrl().
 */
function localApiBase() {
    return `http://localhost:${process.env.PORT || 5000}`;
}
function localPublicBase() {
    const base =
        process.env.LOCAL_MEDIA_BASE_URL ||
        (process.env.NODE_ENV === 'production' && process.env.SERVER_URL ? process.env.SERVER_URL : localApiBase());
    return `${base.replace(/\/+$/, '')}/uploads`;
}

/**
 * A media URL that outside services (Instagram, TikTok, …) can download: locally stored files are
 * rewritten from the local API address to SERVER_URL (e.g. the ngrok tunnel). Other URLs pass through.
 */
export function publicMediaUrl(url, workspaceId) {
    const ref = parseMediaUrl(url);
    if (ref) {
        if (!workspaceId || mediaWorkspace(ref.key) !== workspaceId) throw new Error('Media belongs to a different workspace');
        return signMediaUrl(url, 48 * 60 * 60);
    }
    if (!url || getStorageDriver() !== 'local') return url;
    const server = (process.env.SERVER_URL || '').replace(/\/+$/, '');
    const local = `${localApiBase()}/uploads/`;
    return server && url.startsWith(local) ? `${server}/uploads/${url.slice(local.length)}` : url;
}

/** Locally stored files may be saved under either base (older records used SERVER_URL). */
function localKeyFromUrl(fileUrl) {
    const marker = '/uploads/';
    const at = String(fileUrl || '').indexOf(marker);
    return at === -1 ? null : decodeURIComponent(fileUrl.slice(at + marker.length));
}

function resolveLocalPath(key) {
    const fullPath = path.resolve(LOCAL_UPLOAD_DIR, key);
    if (!fullPath.startsWith(LOCAL_UPLOAD_DIR + path.sep)) {
        throw new Error(`Refusing storage path outside upload dir: ${key}`);
    }
    return fullPath;
}

async function sumLocalBytes(dir) {
    let total = 0;
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        total += entry.isDirectory() ? await sumLocalBytes(entryPath) : (await fs.stat(entryPath)).size;
    }
    return total;
}

// ---------------------
// Public API
// ---------------------

/**
 * Upload a buffer to the configured storage and return the public URL.
 * @param {Buffer} buffer - File buffer
 * @param {string} destination - Path in storage (e.g., 'workspace-id/media')
 * @param {string} mimeType - File mime type
 */
export async function uploadFile(buffer, destination, mimeType) {
    try {
        const fileExtension = EXTENSIONS[mimeType] || (mimeType.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
        const fileName = `${destination}/${uuidv4()}.${fileExtension}`;
        const driver = getStorageDriver();

        if (driver === 'local') {
            const fullPath = resolveLocalPath(fileName);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, buffer);
            return storedMediaUrl('local', fileName);
        }

        if (driver === 's3') {
            await getS3().send(new PutObjectCommand({
                Bucket: process.env.S3_BUCKET,
                Key: fileName,
                Body: buffer,
                ContentType: mimeType,
            }));
            return storedMediaUrl('s3', fileName, process.env.S3_BUCKET);
        }

        const bucket = await resolveWritableBucket();
        const file = bucket.file(fileName);

        await file.save(buffer, {
            metadata: { contentType: mimeType },
            public: false,
        });

        // For Firebase Storage, the public URL looks like this:
        // https://storage.googleapis.com/[BUCKET_NAME]/[FILE_PATH]
        return storedMediaUrl('firebase', fileName, bucket.name);
    } catch (error) {
        console.error('[Storage Service] Upload error:', error);
        throw new Error('Failed to upload file to storage');
    }
}

/**
 * Upload a file from disk without loading it into memory (large videos).
 * @param {string} filePath  local file to upload
 * @param {string} destination  folder in storage (e.g. 'workspaces/<id>/library/<assetId>')
 * @param {string} mimeType
 * @returns {Promise<string>} the stored file's URL (same form as uploadFile)
 */
export async function uploadLocalFile(filePath, destination, mimeType) {
    const fileExtension = EXTENSIONS[mimeType] || (mimeType.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
    const fileName = `${destination}/${uuidv4()}.${fileExtension}`;
    const driver = getStorageDriver();
    try {
        if (driver === 'local') {
            const fullPath = resolveLocalPath(fileName);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.copyFile(filePath, fullPath);
            return storedMediaUrl('local', fileName);
        }

        if (driver === 's3') {
            const { size } = await fs.stat(filePath);
            await getS3().send(new PutObjectCommand({
                Bucket: process.env.S3_BUCKET,
                Key: fileName,
                Body: createReadStream(filePath),
                ContentLength: size,
                ContentType: mimeType,
            }));
            return storedMediaUrl('s3', fileName, process.env.S3_BUCKET);
        }

        const bucket = await resolveWritableBucket();
        await bucket.upload(filePath, { destination: fileName, metadata: { contentType: mimeType }, public: false, resumable: true });
        return storedMediaUrl('firebase', fileName, bucket.name);
    } catch (error) {
        console.error('[Storage Service] File upload error:', error);
        throw new Error('Failed to upload file to storage');
    }
}

/**
 * Delete a file (by the URL uploadFile returned) from the configured storage.
 */
export async function deleteFile(fileUrl) {
    try {
        const ref = parseMediaUrl(fileUrl);
        const driver = ref?.driver || getStorageDriver();

        if (driver === 'local') {
            const key = ref?.key || localKeyFromUrl(fileUrl);
            if (key) await fs.unlink(resolveLocalPath(key));
            return;
        }

        if (driver === 's3') {
            const key = ref?.key || fileUrl.split(`${s3PublicBase()}/`)[1];
            if (key) {
                await getS3().send(new DeleteObjectCommand({
                    Bucket: process.env.S3_BUCKET,
                    Key: decodeURIComponent(key),
                }));
            }
            return;
        }

        for (const bucketName of getCandidateBucketNames()) {
            const bucket = getStorage().bucket(bucketName);
            const filePath = ref?.bucket === bucketName ? ref.key : fileUrl.split(`${bucket.name}/`)[1];
            if (filePath) {
                await bucket.file(filePath).delete();
                return;
            }
        }
    } catch (error) {
        console.error('[Storage Service] Delete error:', error);
        // We don't necessarily want to throw here if it's already gone
    }
}

/**
 * Deletes every file under a key prefix (e.g. 'workspaces/<id>') in the configured storage.
 * Used when a workspace is deleted. Returns the number of files removed (local: directories count as one).
 */
export async function deletePrefix(prefix) {
    const clean = String(prefix || '').replace(/^\/+|\/+$/g, '');
    if (!clean) throw new Error('Refusing to delete an empty storage prefix');
    const driver = getStorageDriver();

    if (driver === 'local') {
        const dir = resolveLocalPath(clean);
        try {
            await fs.rm(dir, { recursive: true, force: true });
            return 1;
        } catch {
            return 0;
        }
    }

    if (driver === 's3') {
        let removed = 0;
        let ContinuationToken;
        do {
            const page = await getS3().send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: `${clean}/`, ContinuationToken }));
            for (const obj of page.Contents || []) {
                await getS3().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: obj.Key }));
                removed++;
            }
            ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (ContinuationToken);
        return removed;
    }

    let removed = 0;
    for (const bucketName of getCandidateBucketNames()) {
        try {
            const [files] = await getStorage().bucket(bucketName).getFiles({ prefix: `${clean}/` });
            await Promise.all(files.map((f) => f.delete().catch(() => {})));
            removed += files.length;
        } catch {
            /* bucket may not exist */
        }
    }
    return removed;
}

/**
 * Total bytes stored under a key prefix, for local and S3 drivers.
 * Returns null for the Firebase driver (callers query the bucket directly).
 */
export async function getPrefixSizeBytes(prefix) {
    const driver = getStorageDriver();

    if (driver === 'local') {
        return sumLocalBytes(resolveLocalPath(prefix));
    }

    if (driver === 's3') {
        let total = 0;
        let ContinuationToken;
        do {
            const page = await getS3().send(new ListObjectsV2Command({
                Bucket: process.env.S3_BUCKET,
                Prefix: prefix,
                ContinuationToken,
            }));
            for (const obj of page.Contents || []) total += obj.Size || 0;
            ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (ContinuationToken);
        return total;
    }

    return null;
}

/** Provider download URLs are minted only after a scoped link has been verified. */
export async function storageReadUrl(ref) {
    if (ref.driver === 's3' && ref.bucket === process.env.S3_BUCKET) {
        return getSignedUrl(getS3(), new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key }), { expiresIn: 300 });
    }
    if (ref.driver === 'firebase' && getCandidateBucketNames().includes(ref.bucket)) {
        const [url] = await getStorage().bucket(ref.bucket).file(ref.key).getSignedUrl({ action: 'read', expires: Date.now() + 300000 });
        return url;
    }
    throw new Error('Unknown media storage');
}
