import axios from 'axios';

/**
 * TikTok Content Posting API, direct post (scope video.publish).
 * https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
 *
 * Unaudited apps may only post with privacy SELF_ONLY ("only me"); set
 * TIKTOK_DEFAULT_PRIVACY=PUBLIC_TO_EVERYONE once TikTok has audited the app.
 *
 * Two modes, chosen by the scopes the app requests (TIKTOK_SCOPES):
 *  - direct (video.publish): posts straight to the profile.
 *  - inbox  (video.upload only): sends the video to the creator's TikTok inbox; they finish
 *    posting in the TikTok app. https://developers.tiktok.com/doc/content-posting-api-reference-upload-video
 */

interface TikTokPublishConfig {
    accessToken: string;
    openId: string;
    videoUrl: string; // must be downloadable by this server
    title?: string;
    privacyLevel?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
    disableDuet?: boolean;
    disableComment?: boolean;
    disableStitch?: boolean;
}

const API = 'https://open.tiktokapis.com/v2/post/publish';

export function tiktokPostMode(): 'direct' | 'inbox' {
    const scopes = (process.env.TIKTOK_SCOPES || 'user.info.basic,video.publish').split(',').map((x) => x.trim());
    return scopes.includes('video.publish') ? 'direct' : 'inbox';
}
const SINGLE_CHUNK_MAX = 64 * 1024 * 1024;
const CHUNK_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;

function tiktokError(error: any, step: string): Error {
    const e = error.response?.data?.error;
    return new Error(`TikTok ${step} failed: ${e?.code || error.message}${e?.message ? ` (${e.message})` : ''}`);
}

/** TikTok's chunk rules: one chunk up to 64 MB; otherwise fixed chunks, the last one absorbing the remainder. */
export function planChunks(size: number) {
    if (size <= SINGLE_CHUNK_MAX) return { chunkSize: size, count: 1 };
    return { chunkSize: CHUNK_SIZE, count: Math.floor(size / CHUNK_SIZE) };
}

export async function publishToTikTok(config: TikTokPublishConfig): Promise<string> {
    const { accessToken, videoUrl, title = '' } = config;
    const privacyLevel = config.privacyLevel || (process.env.TIKTOK_DEFAULT_PRIVACY as TikTokPublishConfig['privacyLevel']) || 'SELF_ONLY';
    const auth = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' };

    // The whole file is needed up front: TikTok wants the exact size and chunk plan at init.
    const { data } = await axios.get(videoUrl, { responseType: 'arraybuffer', maxContentLength: MAX_VIDEO_BYTES, timeout: 10 * 60 * 1000 });
    const video = Buffer.from(data);
    if (!video.length) throw new Error('The video file is empty.');
    const { chunkSize, count } = planChunks(video.length);

    const mode = tiktokPostMode();
    const sourceInfo = { source: 'FILE_UPLOAD', video_size: video.length, chunk_size: chunkSize, total_chunk_count: count };

    let init;
    try {
        init = mode === 'inbox'
            ? await axios.post(`${API}/inbox/video/init/`, { source_info: sourceInfo }, { headers: auth })
            : await axios.post(
            `${API}/video/init/`,
            {
                post_info: {
                    title: title.slice(0, 2200),
                    privacy_level: privacyLevel,
                    disable_duet: config.disableDuet || false,
                    disable_comment: config.disableComment || false,
                    disable_stitch: config.disableStitch || false,
                },
                source_info: sourceInfo,
            },
            { headers: auth }
        );
    } catch (error) {
        throw tiktokError(error, 'upload start');
    }

    const publishId = init.data?.data?.publish_id;
    const uploadUrl = init.data?.data?.upload_url;
    if (!publishId || !uploadUrl) throw new Error('TikTok did not return an upload URL.');

    for (let i = 0; i < count; i += 1) {
        const start = i * chunkSize;
        const end = i === count - 1 ? video.length : start + chunkSize; // last chunk takes the remainder
        const chunk = video.subarray(start, end);
        try {
            await axios.put(uploadUrl, chunk, {
                headers: {
                    'Content-Type': 'video/mp4',
                    'Content-Length': String(chunk.length),
                    'Content-Range': `bytes ${start}-${end - 1}/${video.length}`,
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
            });
        } catch (error) {
            throw tiktokError(error, `upload of part ${i + 1} of ${count}`);
        }
    }

    // TikTok processes the video after the last chunk; poll until it is posted or rejected.
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
            const { data: status } = await axios.post(`${API}/status/fetch/`, { publish_id: publishId }, { headers: auth });
            const state = status?.data?.status;
            if (state === 'PUBLISH_COMPLETE') return publishId;
            // Inbox mode ends here: the video waits in the creator's TikTok inbox.
            if (state === 'SEND_TO_USER_INBOX') return publishId;
            if (state === 'FAILED') throw new Error(`TikTok rejected the video: ${status?.data?.fail_reason || 'unknown reason'}`);
        } catch (error: any) {
            if (/rejected the video/.test(error.message)) throw error;
            // Transient status errors: keep polling until the deadline.
        }
    }
    // Still processing: the upload itself succeeded, so report it rather than failing the post.
    return publishId;
}
