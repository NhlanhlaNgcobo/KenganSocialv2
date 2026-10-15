import axios from 'axios';

interface LinkedInPublishConfig {
    accessToken: string;
    authorId: string; // e.g., urn:li:person:12345 or urn:li:organization:67890
    videoUrl?: string; // omitted or empty → text-only post
    text?: string;
}

/** Connections store the bare member id; the UGC API needs a URN. */
function toAuthorUrn(authorId: string): string {
    return authorId.startsWith('urn:li:') ? authorId : `urn:li:person:${authorId}`;
}

const UGC_HEADERS = (accessToken: string) => ({
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
});

/** Text-only share through the same UGC Posts API the video path uses (shareMediaCategory NONE). */
async function publishTextToLinkedIn(accessToken: string, author: string, text: string): Promise<string> {
    if (!text.trim()) throw new Error('LinkedIn post has no text and no video');
    const postRes = await axios.post(
        'https://api.linkedin.com/v2/ugcPosts',
        {
            author,
            lifecycleState: 'PUBLISHED',
            specificContent: {
                'com.linkedin.ugc.ShareContent': {
                    shareCommentary: { text },
                    shareMediaCategory: 'NONE',
                },
            },
            visibility: {
                'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
            },
        },
        { headers: UGC_HEADERS(accessToken) }
    );
    return postRes.data?.id || postRes.headers?.['x-restli-id'];
}

export async function publishToLinkedIn(config: LinkedInPublishConfig): Promise<string> {
    const { accessToken, videoUrl, text = '' } = config;
    const authorId = toAuthorUrn(config.authorId);

    if (!videoUrl) return publishTextToLinkedIn(accessToken, authorId, text);

    // Download video size
    const videoHead = await axios.head(videoUrl);
    const videoSize = videoHead.headers['content-length'];

    // 1. Register Upload
    const registerRes = await axios.post(
        'https://api.linkedin.com/v2/assets?action=registerUpload',
        {
            registerUploadRequest: {
                recipes: ['urn:li:digitalmediaRecipe:feedshare-video'],
                owner: authorId,
                serviceRelationships: [
                    {
                        relationshipType: 'OWNER',
                        identifier: 'urn:li:userGeneratedContent',
                    },
                ],
            },
        },
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        }
    );

    const uploadUrl = registerRes.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
    const assetUrn = registerRes.data.value.asset;

    // 2. Upload Video
    const videoStream = await axios({
        method: 'get',
        url: videoUrl,
        responseType: 'stream',
    });

    await axios.put(uploadUrl, videoStream.data, {
        headers: {
            Authorization: `Bearer ${accessToken}`, // sometimes optional on S3 URLs but safe to include
            'Content-Type': 'application/octet-stream',
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });

    // 3. Create UGC Post
    const postRes = await axios.post(
        'https://api.linkedin.com/v2/ugcPosts',
        {
            author: authorId,
            lifecycleState: 'PUBLISHED',
            specificContent: {
                'com.linkedin.ugc.ShareContent': {
                    shareCommentary: {
                        text,
                    },
                    shareMediaCategory: 'VIDEO',
                    media: [
                        {
                            status: 'READY',
                            media: assetUrn,
                        },
                    ],
                },
            },
            visibility: {
                'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
            },
        },
        { headers: UGC_HEADERS(accessToken) }
    );

    return postRes.data?.id || postRes.headers?.['x-restli-id'];
}
