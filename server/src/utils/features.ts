/**
 * Server-side feature switches (environment variables), also reported to the app by GET /api/features.
 *
 * YOUTUBE_LINK_IMPORT=on enables importing a video from a YouTube link (downloaded with yt-dlp).
 * It is OFF by default: YouTube's API Services policies restrict downloading YouTube content and
 * TikTok's review rejects apps that copy content from other platforms, so keep it off while
 * applying for API access unless you have legal sign-off (see docs/API_APPLICATIONS.md).
 */
export const features = {
    youtubeLinkImport: () => String(process.env.YOUTUBE_LINK_IMPORT || '').toLowerCase() === 'on',
};

export const YOUTUBE_LINK_IMPORT_OFF = 'Importing from a YouTube link is turned off. Upload the video file from your device instead.';
