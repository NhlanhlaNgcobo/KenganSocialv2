/**
 * Where the clips are going. Each target sets the ratio, a default length, a length cap
 * and the screen areas its app covers (captions and the hook card stay out of them).
 */

export const PLATFORMS = {
    tiktok: {
        label: 'TikTok',
        ratio: '9:16',
        length: 'short',
        maxLength: 'long',
        // Caption, username and the action column cover roughly the bottom fifth.
        safeTop: 0.11,
        safeBottom: 0.24,
    },
    shorts: {
        label: 'YouTube Shorts',
        ratio: '9:16',
        length: 'short',
        maxLength: 'medium', // Shorts are up to 60s for the best reach
        safeTop: 0.1,
        safeBottom: 0.2,
    },
    reels: {
        label: 'Instagram Reels',
        ratio: '9:16',
        length: 'short',
        maxLength: 'long',
        safeTop: 0.12,
        safeBottom: 0.25,
    },
    facebook: {
        label: 'Facebook Reels',
        ratio: '9:16',
        length: 'short',
        maxLength: 'long', // Facebook Reels run up to 90s
        safeTop: 0.12,
        safeBottom: 0.25,
    },
};

export const DEFAULT_SAFE = { safeTop: 0.08, safeBottom: 0.16 };

const LENGTH_ORDER = ['short', 'medium', 'long'];

/** Caps a clip length at what the platform allows. */
export function capLength(platform, length) {
    const p = PLATFORMS[platform];
    if (!p) return length;
    return LENGTH_ORDER.indexOf(length) > LENGTH_ORDER.indexOf(p.maxLength) ? p.maxLength : length;
}
