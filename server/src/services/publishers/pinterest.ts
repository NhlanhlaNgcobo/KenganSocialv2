import axios from 'axios';

interface PinterestPublishConfig {
    accessToken: string;
    boardId: string;
    videoUrl: string;
    title?: string;
    description?: string;
    link?: string;
}

export async function publishToPinterest(config: PinterestPublishConfig): Promise<string> {
    const { accessToken, boardId, videoUrl, title = '', description = '', link = '' } = config;

    // Note: For video pins, Pinterest expects 'media_source' to be registered if direct upload.
    // However, video_url works via 'video_id' registered media. 
    // Let's assume standard direct URL pin via v5 works with url image_url or we register video.
    // According to standard v5: we register media first to get media_id, then pin it.

    // 1. Register media
    const registerRes = await axios.post(
        'https://api.pinterest.com/v5/media',
        {
            media_type: 'video'
        },
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        }
    );

    const mediaId = registerRes.data.media_id;
    const uploadUrl = registerRes.data.upload_url;
    const uploadParameters = registerRes.data.upload_parameters;

    // 2. Upload video
    const videoStream = await axios({
        method: 'get',
        url: videoUrl,
        responseType: 'stream',
    });

    const formData = new FormData();
    Object.keys(uploadParameters).forEach(key => {
        formData.append(key, uploadParameters[key]);
    });
    formData.append('file', videoStream.data as any);

    await axios.post(uploadUrl, formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });

    // 3. Poll for ready status
    let isReady = false;
    let attempts = 0;
    while (attempts < 30 && !isReady) {
        await new Promise(r => setTimeout(r, 5000));
        attempts++;
        const statusRes = await axios.get(`https://api.pinterest.com/v5/media/${mediaId}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (statusRes.data.status === 'succeeded') isReady = true;
        else if (statusRes.data.status === 'failed') throw new Error('Pinterest video processing failed');
    }

    // 4. Create Pin
    const pinRes = await axios.post(
        'https://api.pinterest.com/v5/pins',
        {
            board_id: boardId,
            title,
            description,
            link,
            media_source: {
                source_type: 'video_id',
                cover_image_url: 'https://example.com/cover.jpg', // Should be dynamic in prod
                content_type: 'video/mp4',
                media_id: mediaId,
            },
        },
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        }
    );

    return pinRes.data.id;
}
