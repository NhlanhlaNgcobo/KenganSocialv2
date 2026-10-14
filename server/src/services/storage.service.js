import { getStorage } from '../config/firebase.js';
import { v4 as uuidv4 } from 'uuid';

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

/**
 * Upload a buffer to Firebase Storage and return the public URL.
 * @param {Buffer} buffer - File buffer
 * @param {string} destination - Path in storage (e.g., 'workspace-id/media')
 * @param {string} mimeType - File mime type
 */
export async function uploadFile(buffer, destination, mimeType) {
    try {
        const bucket = await resolveWritableBucket();
        const fileExtension = mimeType.split('/')[1] || 'bin';
        const fileName = `${destination}/${uuidv4()}.${fileExtension}`;
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
 * Delete a file from Firebase Storage.
 */
export async function deleteFile(fileUrl) {
    try {
        for (const bucketName of getCandidateBucketNames()) {
            const bucket = getStorage().bucket(bucketName);
            const path = fileUrl.split(`${bucket.name}/`)[1];
            if (path) {
                await bucket.file(path).delete();
                return;
            }
        }
    } catch (error) {
        console.error('[Storage Service] Delete error:', error);
        // We don't necessarily want to throw here if it's already gone
    }
}
