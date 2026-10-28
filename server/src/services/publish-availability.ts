/**
 * What each social network can do for this workspace right now, shown separately from whether an
 * account is connected (MVP brief §4):
 *
 *  approved-to-publish  connected, and our developer app may post there
 *  connected            connected, but publishing still needs platform review (review-required)
 *  review-required      our app can connect accounts but isn't approved to post yet
 *  expired              the connection's token stopped working: reconnect
 *  manual-export-only   no developer app set up for this network: export the video and post it yourself
 *
 * Which networks may publish: PUBLISH_APPROVED_PLATFORMS (comma list) when set; otherwise the beta's
 * BETA_PLATFORMS while BETA_ACCESS is on; otherwise every configured network (previous behaviour).
 */
import { betaEnabled, betaPlatforms } from '../config/beta-features.js';

export type Availability = 'approved-to-publish' | 'connected' | 'review-required' | 'expired' | 'manual-export-only';

export const PLATFORM_NOTES: Record<string, string> = {
    tiktok: 'Until TikTok audits the app, posts are private (only you can see them) and at most 5 accounts can post per day.',
    youtube: 'Uploads count against the YouTube Data API daily quota; unverified apps upload as private.',
    instagram: 'Needs an Instagram Professional account linked to a Facebook Page, and Meta app review for publishing.',
    facebook: 'Needs a Facebook Page you manage, and Meta app review for publishing.',
    meta_ads: 'Ads tools need Meta app review.',
    linkedin: 'Not built yet: needs LinkedIn w_member_social approval.',
    x: 'Off during the beta (paid API).',
};

export function approvedPlatforms(): string[] | null {
    const raw = process.env.PUBLISH_APPROVED_PLATFORMS;
    if (raw !== undefined && raw.trim() !== '') return raw.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
    if (betaEnabled()) return betaPlatforms();
    return null; // everything configured
}

export function publishApproved(platform: string): boolean {
    const list = approvedPlatforms();
    return list === null ? true : list.includes(String(platform).toLowerCase());
}

export function availabilityFor(platform: string, { configured, connection }: { configured: boolean; connection?: { status?: string } | null }) {
    const approved = configured && publishApproved(platform);
    let status: Availability;
    if (!configured) status = 'manual-export-only';
    else if (connection && connection.status && connection.status !== 'active') status = 'expired';
    else if (connection) status = approved ? 'approved-to-publish' : 'connected';
    else status = approved ? 'approved-to-publish' : 'review-required';
    return {
        platform,
        connected: !!connection && connection.status === 'active',
        canConnect: configured,
        canPublish: approved && !!connection && connection.status === 'active',
        status,
        manualExport: !approved || !configured,
        note: PLATFORM_NOTES[platform] || null,
    };
}
