import axios from 'axios';

interface YouTubePublishConfig {
    accessToken: string;
    videoUrl: string; // The URL to download the video from (e.g., Firebase Storage)
    title: string;
    description?: string;
    tags?: string[];
    categoryId?: string;
    privacyStatus?: 'public' | 'unlisted' | 'private';
}

export async function publishToYouTube(config: YouTubePublishConfig): Promise<string> {
    const { accessToken, videoUrl, title, description = '', tags = [], categoryId = '22', privacyStatus = 'public' } = config;

    // 1. Download video stream from Firebase/URL
    const videoStream = await axios({
        method: 'get',
        url: videoUrl,
        responseType: 'stream',
    });

    // 2. Prepare metadata
    const metadata = {
        snippet: {
            title,
            description,
            tags,
            categoryId,
        },
        status: {
            privacyStatus,
        },
    };

    // 3. Initiate resumable upload session
    const initRes = await axios.post(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        metadata,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-Upload-Content-Type': 'video/mp4',
                'X-Upload-Content-Length': videoStream.headers['content-length'],
            },
        }
    );

    const uploadUrl = initRes.headers.location;
    if (!uploadUrl) {
        throw new Error('Failed to obtain YouTube resumable upload URL');
    }

    // 4. Upload video chunks
    const uploadRes = await axios.put(uploadUrl, videoStream.data, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'video/mp4',
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });

    if (!uploadRes.data?.id) {
        throw new Error('Failed to get video ID from YouTube response');
    }

    return uploadRes.data.id;
}
