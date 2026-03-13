import { getStorage } from '../config/firebase.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Upload a buffer to Firebase Storage and return the public URL.
 * @param {Buffer} buffer - File buffer
 * @param {string} destination - Path in storage (e.g., 'workspace-id/media')
 * @param {string} mimeType - File mime type
 */
export async function uploadFile(buffer, destination, mimeType) {
    try {
        const bucket = getStorage().bucket();
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
        const bucket = getStorage().bucket();
        // Extract path from URL
        const path = fileUrl.split(`${bucket.name}/`)[1];
        if (path) {
            await bucket.file(path).delete();
        }
    } catch (error) {
        console.error('[Storage Service] Delete error:', error);
        // We don't necessarily want to throw here if it's already gone
    }
}
