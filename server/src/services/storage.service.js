import { getStorage } from '../config/firebase.js';
import { v4 as uuidv4 } from 'uuid';
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import fs from 'fs/promises';
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

function localPublicBase() {
    const serverUrl = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`;
    return `${serverUrl.replace(/\/+$/, '')}/uploads`;
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
            return `${localPublicBase()}/${fileName}`;
        }

        if (driver === 's3') {
            await getS3().send(new PutObjectCommand({
                Bucket: process.env.S3_BUCKET,
                Key: fileName,
                Body: buffer,
                ContentType: mimeType,
            }));
            return `${s3PublicBase()}/${fileName}`;
        }

        const bucket = await resolveWritableBucket();
        const file = bucket.file(fileName);

        await file.save(buffer, {
            metadata: { contentType: mimeType },
            public: true,
        });

        // For Firebase Storage, the public URL looks like this:
        // https://storage.googleapis.com/[BUCKET_NAME]/[FILE_PATH]
        return `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    } catch (error) {
        console.error('[Storage Service] Upload error:', error);
        throw new Error('Failed to upload file to storage');
    }
}

/**
 * Delete a file (by the URL uploadFile returned) from the configured storage.
 */
export async function deleteFile(fileUrl) {
    try {
        const driver = getStorageDriver();

        if (driver === 'local') {
            const key = fileUrl.split(`${localPublicBase()}/`)[1];
            if (key) await fs.unlink(resolveLocalPath(decodeURIComponent(key)));
            return;
        }

        if (driver === 's3') {
            const key = fileUrl.split(`${s3PublicBase()}/`)[1];
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
            const filePath = fileUrl.split(`${bucket.name}/`)[1];
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
