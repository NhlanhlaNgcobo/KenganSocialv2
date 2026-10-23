import { getStorage as firebaseStorage } from 'firebase-admin/storage';
import { getStorageDriver, getPrefixSizeBytes } from '../services/storage.service.js';

function getCandidateBuckets() {
    const configured = process.env.FIREBASE_STORAGE_BUCKET;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const candidates = [
        configured,
        projectId ? `${projectId}.appspot.com` : null,
        projectId ? `${projectId}.firebasestorage.app` : null,
    ].filter(Boolean) as string[];

    return Array.from(new Set(candidates));
}

/**
 * Calculates the total size of all files in a workspace's storage prefix.
 * @param workspaceId Unique identifier for the workspace
 * @returns Total size in Gigabytes (GB)
 */
export async function calculateWorkspaceStorage(workspaceId: string): Promise<number> {
    if (getStorageDriver() !== 'firebase') {
        try {
            const totalBytes = (await getPrefixSizeBytes(`workspaces/${workspaceId}/`)) || 0;
            return parseFloat((totalBytes / (1024 * 1024 * 1024)).toFixed(4));
        } catch (err) {
            console.error(`[Storage] Failed to calculate usage for ${workspaceId}:`, err);
            return 0;
        }
    }

    for (const bucketName of getCandidateBuckets()) {
        try {
            const bucket = firebaseStorage().bucket(bucketName);
            const [files] = await bucket.getFiles({ prefix: `workspaces/${workspaceId}/` });

            const totalBytes = files.reduce((acc, file) => {
                return acc + parseInt(file.metadata.size?.toString() || '0');
            }, 0);

            const totalGB = totalBytes / (1024 * 1024 * 1024);
            return parseFloat(totalGB.toFixed(4));
        } catch (err) {
            console.error(`[Storage] Failed to calculate usage for ${workspaceId} in ${bucketName}:`, err);
        }
    }

    return 0;
}
