import axios from 'axios';
import { graphUrl } from '../../config/meta';

interface InstagramPublishConfig {
    accessToken: string;
    igUserId: string;
    videoUrl: string;
    caption?: string;
}

export async function publishToInstagram(config: InstagramPublishConfig): Promise<string> {
    const { accessToken, igUserId, videoUrl, caption = '' } = config;

    // Step 1: Init Media container
    const initRes = await axios.post(
        graphUrl(`${igUserId}/media`),
        null,
        {
            params: {
                access_token: accessToken,
                media_type: 'REELS',
                video_url: videoUrl,
                caption,
            },
        }
    );

    const creationId = initRes.data?.id;
    if (!creationId) {
        throw new Error('Failed to create Instagram media container');
    }

    // Step 2: Poll status
    const maxAttempts = 60; // 10 mins at 10s intervals
    let attempts = 0;
    let isFinished = false;

    while (attempts < maxAttempts && !isFinished) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        attempts++;

        const statusRes = await axios.get(
            graphUrl(creationId),
            {
                params: {
                    access_token: accessToken,
                    fields: 'status_code',
                },
            }
        );

        const statusCode = statusRes.data?.status_code;
        if (statusCode === 'FINISHED') {
            isFinished = true;
        } else if (statusCode === 'ERROR') {
            throw new Error('Instagram video processing failed');
        }
    }

    if (!isFinished) {
        throw new Error('Timeout waiting for Instagram video processing');
    }

    // Step 3: Publish Media
    const publishRes = await axios.post(
        graphUrl(`${igUserId}/media_publish`),
        null,
        {
            params: {
                access_token: accessToken,
                creation_id: creationId,
            },
        }
    );

    if (!publishRes.data?.id) {
        throw new Error('Failed to publish Instagram media');
    }

    return publishRes.data.id;
}
