import axios from 'axios';

interface ThreadsPublishConfig {
    accessToken: string;
    threadsUserId: string;
    videoUrl?: string; // omitted or empty → text-only post
    text?: string;
}

async function publishContainer(accessToken: string, threadsUserId: string, creationId: string): Promise<string> {
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

/** Text-only post: a TEXT container needs no processing, so it is published straight away. */
async function publishTextToThreads(accessToken: string, threadsUserId: string, text: string): Promise<string> {
    if (!text.trim()) throw new Error('Threads post has no text and no video');
    const initRes = await axios.post(`https://graph.threads.net/v1.0/${threadsUserId}/threads`, null, {
        params: {
            access_token: accessToken,
            media_type: 'TEXT',
            text,
        },
    });
    const creationId = initRes.data?.id;
    if (!creationId) throw new Error('Failed to create Threads text container');
    return publishContainer(accessToken, threadsUserId, creationId);
}

export async function publishToThreads(config: ThreadsPublishConfig): Promise<string> {
    const { accessToken, threadsUserId, videoUrl, text = '' } = config;

    if (!videoUrl) return publishTextToThreads(accessToken, threadsUserId, text);

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
    return publishContainer(accessToken, threadsUserId, creationId);
}
