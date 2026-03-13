import { uploadFile } from '../services/storage.service.js';

/**
 * Handle single file upload to a workspace's storage folder.
 */
export async function uploadMedia(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { workspaceId } = req.params;
        const fileUrl = await uploadFile(
            req.file.buffer,
            `${workspaceId}/media`,
            req.file.mimetype
        );

        res.status(201).json({
            url: fileUrl,
            fileName: req.file.originalname,
            mimeType: req.file.mimetype
        });
    } catch (error) {
        console.error('[Media Controller] Upload error:', error);
        res.status(500).json({ error: 'Failed to upload media' });
    }
}
