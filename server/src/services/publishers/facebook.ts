import axios from 'axios';

/**
 * Publishes to a Facebook Page with the Page access token (pages_manage_posts):
 *  - video → POST /{page-id}/videos   (file_url, description)
 *  - image → POST /{page-id}/photos   (url, caption)
 *  - text  → POST /{page-id}/feed     (message)
 * Returns the new post/video id. Media must be at a public HTTPS URL that Facebook can fetch.
 */

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v19.0'}`;
const VIDEO = /\.(mp4|mov|m4v|webm)(\?|$)/i;
const IMAGE = /\.(jpe?g|png|gif|webp)(\?|$)/i;

interface FacebookPublishConfig {
    accessToken: string; // Page access token
    pageId: string;
    mediaUrl?: string;
    caption?: string;
    title?: string;
}

function graphError(err: any) {
    const e = err.response?.data?.error;
    return new Error(e ? `Facebook: ${e.message}${e.code ? ` (code ${e.code})` : ''}` : `Facebook: ${err.message}`);
}

export async function publishToFacebook({ accessToken, pageId, mediaUrl = '', caption = '', title = '' }: FacebookPublishConfig): Promise<string> {
    if (!pageId) throw new Error('Facebook Page is missing on the connection. Reconnect Facebook.');
    try {
        if (mediaUrl && (VIDEO.test(mediaUrl) || !IMAGE.test(mediaUrl))) {
            const res = await axios.post(`${GRAPH}/${pageId}/videos`, null, {
                params: { access_token: accessToken, file_url: mediaUrl, description: caption, ...(title ? { title: title.slice(0, 250) } : {}) },
                timeout: 120000,
            });
            return String(res.data?.id || '');
        }
        if (mediaUrl) {
            const res = await axios.post(`${GRAPH}/${pageId}/photos`, null, { params: { access_token: accessToken, url: mediaUrl, caption }, timeout: 60000 });
            return String(res.data?.post_id || res.data?.id || '');
        }
        if (!caption.trim()) throw new Error('Facebook: nothing to post (no media and no text).');
        const res = await axios.post(`${GRAPH}/${pageId}/feed`, null, { params: { access_token: accessToken, message: caption }, timeout: 30000 });
        return String(res.data?.id || '');
    } catch (err: any) {
        if (err.message?.startsWith('Facebook:')) throw err;
        throw graphError(err);
    }
}
