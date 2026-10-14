import axios from 'axios';

interface TikTokPublishConfig {
    accessToken: string;
    openId: string;
    videoUrl: string; // Ensure this is accessible to download stream
    title?: string;
    privacyLevel?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY';
    disableDuet?: boolean;
    disableComment?: boolean;
    disableStitch?: boolean;
}

export async function publishToTikTok(config: TikTokPublishConfig): Promise<string> {
    const { accessToken, openId, videoUrl, title = '', privacyLevel = 'PUBLIC_TO_EVERYONE' } = config;

    // Get video size
    const videoHead = await axios.head(videoUrl);
    const videoSize = parseInt(videoHead.headers['content-length'] || '0', 10);
    if (!videoSize) throw new Error('Could not determine video content length for TikTok');

    // Step 1: Initialize
    const initRes = await axios.post(
        'https://open.tiktokapis.com/v2/post/publish/video/init/',
        {
            post_info: {
                title,
                privacy_level: privacyLevel,
                disable_duet: config.disableDuet || false,
                disable_comment: config.disableComment || false,
                disable_stitch: config.disableStitch || false,
            },
            source_info: {
                source: 'FILE_UPLOAD',
                video_size: videoSize,
                chunk_size: Math.min(videoSize, 10 * 1024 * 1024), // 10MB default
                total_chunk_count: Math.ceil(videoSize / (10 * 1024 * 1024)),
            },
        },
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        }
    );

    const publishId = initRes.data?.data?.publish_id;
    const uploadUrl = initRes.data?.data?.upload_url;

    if (!publishId || !uploadUrl) {
        throw new Error('Failed to initialize TikTok upload');
    }

    // Step 2: Upload chunks (10MB each)
    const CHUNK_SIZE = 10 * 1024 * 1024;
    let bytesSent = 0;

    // We'll use a readable stream to fetch chunks from the source
    const response = await axios({
        method: 'get',
        url: videoUrl,
        responseType: 'stream',
    });

    const stream = response.data;

    let chunkBuffer = Buffer.alloc(0);

    for await (const data of stream) {
        chunkBuffer = Buffer.concat([chunkBuffer, data as Buffer]);

        while (chunkBuffer.length >= CHUNK_SIZE) {
            const chunk = chunkBuffer.subarray(0, CHUNK_SIZE);
            chunkBuffer = chunkBuffer.subarray(CHUNK_SIZE);

            await axios.put(uploadUrl, chunk, {
                headers: {
                    'Content-Range': `bytes ${bytesSent}-${bytesSent + chunk.length - 1}/${videoSize}`,
                    'Content-Length': chunk.length.toString(),
                    'Content-Type': 'video/mp4',
                },
            });
            bytesSent += chunk.length;
        }
    }

    // Last chunk
    if (chunkBuffer.length > 0) {
        await axios.put(uploadUrl, chunkBuffer, {
            headers: {
                'Content-Range': `bytes ${bytesSent}-${bytesSent + chunkBuffer.length - 1}/${videoSize}`,
                'Content-Length': chunkBuffer.length.toString(),
                'Content-Type': 'video/mp4',
            },
        });
        bytesSent += chunkBuffer.length;
    }

    // Step 3: Complete upload
    // Though sometimes implicit, explicit complete is safer for some TikTok API v2 versions/scenarios
    const completeRes = await axios.post(
        'https://open.tiktokapis.com/v2/post/publish/video/complete/',
        { publish_id: publishId },
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        }
    );

    return publishId;
}
