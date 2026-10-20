import axios from 'axios';
import { db } from '../../utils/firestore';
import admin from 'firebase-admin';
import { decrypt } from '../../utils/tokenEncryption';

/**
 * Platform analytics fetchers. Every number returned here comes from the platform's API.
 * When a platform can't be read the snapshot has status 'unavailable', zeroed metrics and
 * the reason; metrics a platform doesn't provide are null. Nothing is estimated or invented.
 */

export interface AnalyticsPost {
    id: string;
    platform: string;
    caption: string;
    thumbnail: string | null;
    url: string | null;
    publishedAt: string | null;
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
}

export interface AnalyticsSnapshot {
    platform: string;
    periodDays: number;
    status: 'ok' | 'unavailable';
    error?: string;
    reach: number | null; // views / reach over the period
    impressions: number | null;
    engagementRate: number | null; // percent
    followerGrowth: number | null; // net new followers in the period
    followers: number | null; // current total, when the platform reports it
    posts: AnalyticsPost[]; // recent posts with their own stats
    byDay: { date: string; reach: number | null; followers: number | null }[];
}

type Fetcher = (workspaceId: string, accessToken: string, accountId: string, periodDays: number) => Promise<AnalyticsSnapshot>;

const HTTP_TIMEOUT = 15000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function unavailable(platform: string, periodDays: number, error: string): AnalyticsSnapshot {
    return {
        platform, periodDays, status: 'unavailable', error,
        reach: 0, impressions: 0, engagementRate: 0, followerGrowth: 0, followers: null,
        posts: [], byDay: [],
    };
}

function okSnapshot(platform: string, periodDays: number, partial: Partial<AnalyticsSnapshot>): AnalyticsSnapshot {
    return {
        platform, periodDays, status: 'ok',
        reach: null, impressions: null, engagementRate: null, followerGrowth: null, followers: null,
        posts: [], byDay: [],
        ...partial,
    };
}

/** Turns an API failure into a reason a user can act on. */
function describeError(platform: string, err: any): string {
    const status = err?.response?.status;
    const apiMessage = err?.response?.data?.error?.message || err?.response?.data?.message || err?.response?.data?.error?.code;
    console.warn(`[Analytics] ${platform} fetch failed (${status ?? 'network'}):`, apiMessage || err?.message);
    if (status === 401) return 'Access expired. Reconnect this account.';
    if (status === 403) return "This connection doesn't have permission to read analytics. Reconnect it to grant access.";
    if (status === 429) return 'The platform is rate-limiting requests. Try again later.';
    if (err?.code === 'ECONNABORTED') return 'The platform took too long to respond.';
    return apiMessage ? `The platform returned an error: ${String(apiMessage).slice(0, 160)}` : 'Could not reach the platform.';
}

const isoDate = (d: Date) => d.toISOString().split('T')[0];
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const sum = (values: Array<number | null>) => values.reduce<number>((acc, v) => acc + (v ?? 0), 0);

/** Splits the last `periodDays` into [since, until] unix-second windows of at most `maxDays` (Meta insights limit). */
function windows(periodDays: number, maxDays = 30) {
    const out: { since: number; until: number }[] = [];
    let end = Date.now();
    const start = end - periodDays * DAY_MS;
    while (end > start) {
        const s = Math.max(start, end - maxDays * DAY_MS);
        out.push({ since: Math.floor(s / 1000), until: Math.floor(end / 1000) });
        end = s;
    }
    return out;
}

// ─── YouTube ─────────────────────────────────────────────────────────────────
async function youtubePosts(token: string): Promise<AnalyticsPost[]> {
    const headers = { Authorization: `Bearer ${token}` };
    const channel = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
        params: { part: 'contentDetails', mine: true }, headers, timeout: HTTP_TIMEOUT,
    });
    const uploads = channel.data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) return [];
    const items = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
        params: { part: 'contentDetails', playlistId: uploads, maxResults: 25 }, headers, timeout: HTTP_TIMEOUT,
    });
    const ids = (items.data?.items || []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
    if (!ids.length) return [];
    const videos = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: { part: 'snippet,statistics', id: ids.join(',') }, headers, timeout: HTTP_TIMEOUT,
    });
    return (videos.data?.items || []).map((v: any) => ({
        id: v.id,
        platform: 'youtube',
        caption: v.snippet?.title || '',
        thumbnail: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || null,
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`,
        publishedAt: v.snippet?.publishedAt || null,
        views: num(v.statistics?.viewCount),
        likes: num(v.statistics?.likeCount),
        comments: num(v.statistics?.commentCount),
        shares: null,
    }));
}

const youtube: Fetcher = async (_workspaceId, token, accountId, periodDays) => {
    try {
        const res = await axios.get('https://youtubeanalytics.googleapis.com/v2/reports', {
            params: {
                ids: accountId ? `channel==${accountId}` : 'channel==MINE',
                startDate: isoDate(new Date(Date.now() - periodDays * DAY_MS)),
                endDate: isoDate(new Date()),
                metrics: 'views,comments,likes,shares,subscribersGained,subscribersLost',
                dimensions: 'day',
                sort: 'day',
            },
            headers: { Authorization: `Bearer ${token}` },
            timeout: HTTP_TIMEOUT,
        });
        // Columns follow the request: [day, views, comments, likes, shares, subscribersGained, subscribersLost]
        const rows: any[][] = res.data?.rows || [];
        const views = sum(rows.map((r) => num(r[1])));
        const interactions = sum(rows.map((r) => (num(r[2]) ?? 0) + (num(r[3]) ?? 0) + (num(r[4]) ?? 0)));
        const growth = sum(rows.map((r) => (num(r[5]) ?? 0) - (num(r[6]) ?? 0)));

        let posts: AnalyticsPost[] = [];
        try {
            posts = await youtubePosts(token);
        } catch (err) {
            describeError('youtube posts', err);
        }

        return okSnapshot('youtube', periodDays, {
            reach: views,
            engagementRate: views > 0 ? (interactions / views) * 100 : null,
            followerGrowth: growth,
            posts,
            byDay: rows.map((r) => ({ date: String(r[0]), reach: num(r[1]), followers: (num(r[5]) ?? 0) - (num(r[6]) ?? 0) })),
        });
    } catch (err) {
        return unavailable('youtube', periodDays, describeError('youtube', err));
    }
};

// ─── Instagram (professional account via Facebook Login) ─────────────────────
const IG_GRAPH = 'https://graph.facebook.com/v19.0';

const instagram: Fetcher = async (_workspaceId, token, accountId, periodDays) => {
    try {
        // Daily reach, fetched in ≤30-day windows.
        const byDate = new Map<string, number>();
        for (const w of windows(periodDays)) {
            const res = await axios.get(`${IG_GRAPH}/${accountId}/insights`, {
                params: { metric: 'reach', period: 'day', since: w.since, until: w.until, access_token: token },
                timeout: HTTP_TIMEOUT,
            });
            for (const v of res.data?.data?.[0]?.values || []) {
                const date = String(v.end_time || '').slice(0, 10);
                const value = num(v.value);
                if (date && value !== null) byDate.set(date, value);
            }
        }
        const byDay = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, reach]) => ({ date, reach, followers: null }));
        const reach = sum(byDay.map((d) => d.reach));

        // Interactions (likes, comments, shares, saves) for the engagement rate — best effort.
        let interactions: number | null = null;
        try {
            let total = 0;
            for (const w of windows(periodDays)) {
                const res = await axios.get(`${IG_GRAPH}/${accountId}/insights`, {
                    params: { metric: 'total_interactions', metric_type: 'total_value', period: 'day', since: w.since, until: w.until, access_token: token },
                    timeout: HTTP_TIMEOUT,
                });
                total += num(res.data?.data?.[0]?.total_value?.value) ?? 0;
            }
            interactions = total;
        } catch (err) {
            describeError('instagram interactions', err);
        }

        // Instagram only reports daily follower changes for the last 30 days.
        let followerGrowth: number | null = null;
        if (periodDays <= 30) {
            try {
                const [w] = windows(periodDays);
                const res = await axios.get(`${IG_GRAPH}/${accountId}/insights`, {
                    params: { metric: 'follower_count', period: 'day', since: w.since, until: w.until, access_token: token },
                    timeout: HTTP_TIMEOUT,
                });
                followerGrowth = sum((res.data?.data?.[0]?.values || []).map((v: any) => num(v.value)));
            } catch (err) {
                describeError('instagram followers', err);
            }
        }

        let followers: number | null = null;
        let posts: AnalyticsPost[] = [];
        try {
            const [profile, media] = await Promise.all([
                axios.get(`${IG_GRAPH}/${accountId}`, { params: { fields: 'followers_count', access_token: token }, timeout: HTTP_TIMEOUT }),
                axios.get(`${IG_GRAPH}/${accountId}/media`, {
                    params: { fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count', limit: 25, access_token: token },
                    timeout: HTTP_TIMEOUT,
                }),
            ]);
            followers = num(profile.data?.followers_count);
            posts = (media.data?.data || []).map((m: any) => ({
                id: m.id,
                platform: 'instagram',
                caption: m.caption || '',
                thumbnail: m.thumbnail_url || (m.media_type === 'VIDEO' ? null : m.media_url) || null,
                url: m.permalink || null,
                publishedAt: m.timestamp || null,
                views: null,
                likes: num(m.like_count),
                comments: num(m.comments_count),
                shares: null,
            }));
        } catch (err) {
            describeError('instagram media', err);
        }

        return okSnapshot('instagram', periodDays, {
            reach,
            engagementRate: interactions !== null && reach > 0 ? (interactions / reach) * 100 : null,
            followerGrowth,
            followers,
            posts,
            byDay,
        });
    } catch (err) {
        return unavailable('instagram', periodDays, describeError('instagram', err));
    }
};

// ─── TikTok ──────────────────────────────────────────────────────────────────
const tiktok: Fetcher = async (_workspaceId, token, _accountId, periodDays) => {
    try {
        const res = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
            params: { fields: 'follower_count,likes_count,video_count' },
            headers: { Authorization: `Bearer ${token}` },
            timeout: HTTP_TIMEOUT,
        });
        const user = res.data?.data?.user;
        const followers = num(user?.follower_count);
        if (followers === null) {
            return unavailable('tiktok', periodDays, 'TikTok needs the user.info.stats permission to share account stats. Add it to TIKTOK_SCOPES and reconnect.');
        }
        // TikTok only exposes current totals here, so reach and growth for the period are unknown.
        return okSnapshot('tiktok', periodDays, { followers });
    } catch (err: any) {
        if (err?.response?.data?.error?.code === 'scope_not_authorized') {
            return unavailable('tiktok', periodDays, 'TikTok needs the user.info.stats permission to share account stats. Add it to TIKTOK_SCOPES and reconnect.');
        }
        return unavailable('tiktok', periodDays, describeError('tiktok', err));
    }
};

// ─── Facebook Page ──────────────────────────────────────────────────────────
// Page insights need read_insights (not requested yet); report the follower count meanwhile.
const facebook: Fetcher = async (_workspaceId, _token, _accountId, periodDays) =>
    unavailable('facebook', periodDays, 'Facebook Page insights are not connected yet. Followers show on the Connections page.');
export const fetchers: Record<string, Fetcher> = { youtube, instagram, tiktok, facebook };

/** Reads one connection document and returns its snapshot (never throws). */
export async function fetchConnectionAnalytics(workspaceId: string, platform: string, conn: any, periodDays: number): Promise<AnalyticsSnapshot> {
    const fetcher = fetchers[platform];
    if (!fetcher) return unavailable(platform, periodDays, "Analytics aren't available for this platform yet.");
    if (!conn?.accessToken) return unavailable(platform, periodDays, 'This account is not fully connected. Reconnect it.');
    let token: string;
    try {
        token = decrypt(conn.accessToken);
    } catch {
        return unavailable(platform, periodDays, 'The saved sign-in for this account is unreadable. Reconnect it.');
    }
    try {
        return await fetcher(workspaceId, token, conn.accountId, periodDays);
    } catch (err) {
        return unavailable(platform, periodDays, describeError(platform, err));
    }
}

// Cron Sync function: stores a daily snapshot of what the platforms reported.
export async function syncWorkspaceAnalytics(workspaceId: string, plan: string) {
    const connsSnap = await db.collection('workspaces').doc(workspaceId).collection('connections').get();
    const todayStr = new Date().toISOString().split('T')[0];

    const retentions: Record<string, number> = { 'starter': 7, 'nano': 30, 'creator': 90, 'agency': 730 };
    const maxDays = retentions[plan] || 7;

    const snapshotData: any = {
        date: todayStr,
        platforms: {},
        summary: { totalReach: 0, totalImpressions: 0, totalFollowers: 0 },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await Promise.all(connsSnap.docs.map(async (doc) => {
        const platform = doc.id;
        const data = await fetchConnectionAnalytics(workspaceId, platform, doc.data(), 7);
        const { posts: _posts, ...stored } = data;
        snapshotData.platforms[platform] = stored;
        if (data.status === 'ok') {
            snapshotData.summary.totalReach += data.reach ?? 0;
            snapshotData.summary.totalImpressions += data.impressions ?? 0;
            snapshotData.summary.totalFollowers += data.followerGrowth ?? 0;
        } else {
            console.error(`Sync fail for ${platform} in ${workspaceId}: ${data.error}`);
        }
    }));

    const snapRef = db.collection('analytics').doc(workspaceId).collection('snapshots').doc(todayStr);
    await snapRef.set(snapshotData);

    // Cleanup logic
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxDays);
    const oldSnaps = await db.collection('analytics').doc(workspaceId).collection('snapshots')
        .where('createdAt', '<', cutoff).get();

    if (!oldSnaps.empty) {
        const batch = db.batch();
        oldSnaps.forEach(s => batch.delete(s.ref));
        await batch.commit();
    }
}

export const BEST_TIMES_TIMEZONE = 'Africa/Johannesburg';
const BEST_TIMES_MIN_POSTS = 5;

export interface BestPostingTimes {
    status: 'ok' | 'insufficient_data';
    timezone: string;
    minPosts: number;
    postsAnalysed: number;
    slots: { hour: number; avgEngagement: number; posts: number }[];
}

/**
 * Best hours to post, from the publish time and interactions (likes + comments + shares)
 * of the workspace's own recent posts. Returns no slots until there are enough posts.
 */
export function calculateBestPostingTimes(posts: AnalyticsPost[]): BestPostingTimes {
    const hourFormat = new Intl.DateTimeFormat('en-ZA', { hour: 'numeric', hourCycle: 'h23', timeZone: BEST_TIMES_TIMEZONE });
    const byHour = new Map<number, { total: number; count: number }>();
    let analysed = 0;
    for (const post of posts) {
        if (!post.publishedAt) continue;
        const date = new Date(post.publishedAt);
        if (Number.isNaN(date.getTime())) continue;
        if (post.likes === null && post.comments === null && post.shares === null) continue;
        const hour = Number(hourFormat.format(date)) % 24;
        const engagement = (post.likes ?? 0) + (post.comments ?? 0) + (post.shares ?? 0);
        const entry = byHour.get(hour) || { total: 0, count: 0 };
        entry.total += engagement;
        entry.count += 1;
        byHour.set(hour, entry);
        analysed += 1;
    }

    const base = { timezone: BEST_TIMES_TIMEZONE, minPosts: BEST_TIMES_MIN_POSTS, postsAnalysed: analysed };
    if (analysed < BEST_TIMES_MIN_POSTS) return { status: 'insufficient_data', ...base, slots: [] };

    const slots = [...byHour.entries()]
        .map(([hour, v]) => ({ hour, avgEngagement: v.total / v.count, posts: v.count }))
        .sort((a, b) => b.avgEngagement - a.avgEngagement)
        .slice(0, 3);
    return { status: 'ok', ...base, slots };
}
