import axios from 'axios';

interface ThreadsPublishConfig {
    accessToken: string;
    threadsUserId: string;
    videoUrl: string;
    text?: string;
}

export async function publishToThreads(config: ThreadsPublishConfig): Promise<string> {
    const { accessToken, threadsUserId, videoUrl, text = '' } = config;

    // Step 1: Create media container
    const initRes = await axios.post(
        `https://graph.threads.net/v1.0/${threadsUserId}/threads`,
        null,
        {
            params: {
                access_token: accessToken,
                media_type: 'VIDEO',
                video_url: videoUrl,
                text,
            },
        }
    );

    const creationId = initRes.data?.id;
    if (!creationId) {
        throw new Error('Failed to create Threads media container');
    }

    // Step 2: Poll status
    const maxAttempts = 30; // 5 mins at 10s intervals
    let attempts = 0;
    let isFinished = false;

    while (attempts < maxAttempts && !isFinished) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        attempts++;

        const statusRes = await axios.get(
            `https://graph.threads.net/v1.0/${creationId}`,
            {
                params: {
                    access_token: accessToken,
                    fields: 'status',
                },
            }
        );

        const status = statusRes.data?.status;
        if (status === 'FINISHED') {
            isFinished = true;
        } else if (status === 'ERROR') {
            throw new Error('Threads video processing failed');
        }
    }

    if (!isFinished) {
        throw new Error('Timeout waiting for Threads video processing');
    }

    // Step 3: Publish Media
    const publishRes = await axios.post(
        `https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`,
        null,
        {
            params: {
                access_token: accessToken,
                creation_id: creationId,
            },
        }
    );

    if (!publishRes.data?.id) {
        throw new Error('Failed to publish Threads media');
    }

    return publishRes.data.id; // This is the media_id
}
