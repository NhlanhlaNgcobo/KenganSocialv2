import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import cron from 'node-cron';
import { db } from '../utils/firestore';
import { encrypt, decrypt } from '../utils/tokenEncryption';
import { FieldValue } from 'firebase-admin/firestore';
import { publishToYouTube } from '../services/publishers/youtube';
import { deleteMetaPlatformData, fetchMetaUserId, linkMetaUser, revokeConnection, unlinkMetaUser } from '../services/platform-access';
import { purgePlatformAnalytics } from '../services/analytics/analyticsService';

const router = express.Router();

// ─── ENV helpers ─────────────────────────────────────────────────────────────
const env = (key: string) => process.env[key] ?? '';

const REDIRECT_BASE = env('SERVER_URL') || 'http://localhost:5000';

// ─── OAuth Config per platform ────────────────────────────────────────────────
const OAUTH_CONFIG = {
    youtube: {
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scopes: [
            'https://www.googleapis.com/auth/youtube.upload',
            'https://www.googleapis.com/auth/youtube.readonly',
            'https://www.googleapis.com/auth/youtube.force-ssl',
            // Channel analytics on the Analytics page (youtubeanalytics.googleapis.com/v2/reports).
            'https://www.googleapis.com/auth/yt-analytics.readonly',
        ],
        clientId: () => env('YOUTUBE_CLIENT_ID'),
        clientSecret: () => env('YOUTUBE_CLIENT_SECRET'),
        redirectUri: () => `${REDIRECT_BASE}/api/connections/youtube/callback`,
    },
    instagram: {
        authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
        tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
        scopes: [
            // Publishing Reels and reading insights for an Instagram professional account linked to a Page.
            'instagram_basic', 'instagram_content_publish', 'instagram_manage_insights',
            'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'business_management',
            // Inbox and DM automations: read/send Instagram DMs and subscribe the Page to message webhooks.
            'instagram_manage_messages', 'pages_manage_metadata',
        ],
        clientId: () => env('FACEBOOK_APP_ID'),
        clientSecret: () => env('FACEBOOK_APP_SECRET'),
        redirectUri: () => `${REDIRECT_BASE}/api/connections/instagram/callback`,
    },
    tiktok: {
        authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
        tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
        // Login Kit + Content Posting API. research.data.basic belongs to the Research API and makes
        // TikTok reject the whole sign-in for normal apps. TIKTOK_SCOPES also picks the posting mode:
        // with video.publish posts go straight to the profile, with only video.upload to the TikTok inbox.
        scopes: (env('TIKTOK_SCOPES') || 'user.info.basic,video.publish').split(',').map((x) => x.trim()).filter(Boolean),
        clientId: () => env('TIKTOK_CLIENT_KEY'),
        clientSecret: () => env('TIKTOK_CLIENT_SECRET'),
        redirectUri: () => `${REDIRECT_BASE}/api/connections/tiktok/callback`,
    },
    facebook: {
        authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
        tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
        // Only what the app uses: list the person's Pages, publish to the chosen Page and read its
        // follower count. business_management lets /me/accounts include Pages owned through a
        // business portfolio. (Unused permissions get an app rejected in Meta App Review.)
        scopes: [
            'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'business_management',
        ],
        clientId: () => env('FACEBOOK_APP_ID'),
        clientSecret: () => env('FACEBOOK_APP_SECRET'),
        redirectUri: () => `${REDIRECT_BASE}/api/connections/facebook/callback`,
    },
};

type Platform = keyof typeof OAUTH_CONFIG;
const PLATFORMS = Object.keys(OAUTH_CONFIG) as Platform[];

// ─── Middleware: extract workspaceId from Firebase token ──────────────────────
import { withWorkspace } from '../middleware/withWorkspace';

// ─── Helper: save connection doc ──────────────────────────────────────────────
async function saveConnection(
    workspaceId: string,
    platform: string,
    data: {
        accessToken: string;
        refreshToken?: string;
        tokenExpiry: number;
        accountId: string;
        accountName: string;
        accountAvatar?: string;
        followersCount?: number;
        scope: string[];
        meta?: Record<string, unknown>;
    }
) {
    const docRef = db
        .collection('workspaces')
        .doc(workspaceId)
        .collection('connections')
        .doc(platform);

    await docRef.set({
        platform,
        accessToken: encrypt(data.accessToken),
        refreshToken: data.refreshToken ? encrypt(data.refreshToken) : null,
        tokenExpiry: data.tokenExpiry,
        accountId: data.accountId,
        accountName: data.accountName,
        accountAvatar: data.accountAvatar ?? null,
        followersCount: data.followersCount ?? 0,
        scope: data.scope,
        status: 'active',
        connectedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(data.meta ?? {}),
    });
}

function ensureOAuthConfig(platform: Platform) {
    const cfg = OAUTH_CONFIG[platform];
    if (!cfg.clientId() || !cfg.clientSecret()) {
        throw new Error(`${platform.toUpperCase()}_OAUTH_NOT_CONFIGURED`);
    }
    return cfg;
}

// OAuth state is signed and expires, so a callback can only attach an account to the
// workspace that started the sign-in (a forged state naming another workspace is refused).
const STATE_TTL_MS = 15 * 60 * 1000;
function stateKey() {
    const key = env('TOKEN_ENCRYPTION_KEY');
    if (!key) throw new Error('TOKEN_ENCRYPTION_KEY_NOT_SET');
    return key;
}
function signState(data: { workspaceId: string; platform: string }) {
    const payload = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + STATE_TTL_MS, n: crypto.randomBytes(8).toString('hex') })).toString('base64url');
    const sig = crypto.createHmac('sha256', stateKey()).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}
function verifyState(state: string | undefined): { workspaceId: string; platform: string } {
    const [payload, sig] = String(state || '').split('.');
    if (!payload || !sig) throw new Error('INVALID_OAUTH_STATE');
    const expected = crypto.createHmac('sha256', stateKey()).update(payload).digest('base64url');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('INVALID_OAUTH_STATE');
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now()) throw new Error('EXPIRED_OAUTH_STATE');
    return data;
}

function buildOAuthUrl(platform: Platform, workspaceId: string) {
    const cfg = ensureOAuthConfig(platform);
    const state = signState({ workspaceId, platform });

    const params = new URLSearchParams({
        client_id: cfg.clientId(),
        redirect_uri: cfg.redirectUri(),
        scope: cfg.scopes.join(' '),
        response_type: 'code',
        state,
        access_type: 'offline',
        prompt: 'consent',
    });

    if (platform === 'tiktok') {
        // TikTok: client_key instead of client_id, comma-separated scopes, and none of
        // Google's access_type/prompt parameters.
        params.set('client_key', cfg.clientId());
        params.delete('client_id');
        params.set('scope', cfg.scopes.join(','));
        params.delete('access_type');
        params.delete('prompt');
    }

    return `${cfg.authUrl}?${params.toString()}`;
}

async function getConnectionDoc(workspaceId: string, platform: Platform) {
    const docRef = db
        .collection('workspaces')
        .doc(workspaceId)
        .collection('connections')
        .doc(platform);

    const snap = await docRef.get();
    if (!snap.exists) {
        return null;
    }

    return { ref: docRef, data: snap.data()! };
}

export async function getValidAccessToken(workspaceId: string, platform: Platform) {
    let connection = await getConnectionDoc(workspaceId, platform);
    if (!connection) {
        throw new Error('NOT_CONNECTED');
    }

    const tokenExpiry = Number(connection.data.tokenExpiry ?? 0);
    if (tokenExpiry && tokenExpiry <= Date.now() + 60_000) {
        await refreshPlatformToken(workspaceId, platform);
        connection = await getConnectionDoc(workspaceId, platform);
        if (!connection) {
            throw new Error('NOT_CONNECTED');
        }
    }

    return {
        accessToken: decrypt(connection.data.accessToken),
        connection: connection.data,
    };
}

function normalizeYoutubeVideo(item: any) {
    return {
        id: item.id,
        title: item.snippet?.title ?? 'Untitled',
        description: item.snippet?.description ?? '',
        thumbnailUrl:
            item.snippet?.thumbnails?.medium?.url ??
            item.snippet?.thumbnails?.default?.url ??
            null,
        publishedAt: item.snippet?.publishedAt ?? null,
        privacyStatus: item.status?.privacyStatus ?? 'private',
        viewCount: Number(item.statistics?.viewCount ?? 0),
        likeCount: Number(item.statistics?.likeCount ?? 0),
        commentCount: Number(item.statistics?.commentCount ?? 0),
        duration: item.contentDetails?.duration ?? null,
        channelTitle: item.snippet?.channelTitle ?? '',
    };
}

function normalizeYoutubeComment(item: any) {
    const comment = item.snippet?.topLevelComment?.snippet ?? {};
    return {
        id: item.id,
        videoId: item.snippet?.videoId ?? null,
        textDisplay: comment.textDisplay ?? '',
        textOriginal: comment.textOriginal ?? '',
        authorDisplayName: comment.authorDisplayName ?? 'Unknown',
        authorProfileImageUrl: comment.authorProfileImageUrl ?? null,
        likeCount: Number(comment.likeCount ?? 0),
        publishedAt: comment.publishedAt ?? null,
        updatedAt: comment.updatedAt ?? null,
        totalReplyCount: Number(item.snippet?.totalReplyCount ?? 0),
    };
}

async function youtubeApiRequest<T = any>(
    workspaceId: string,
    config: {
        method?: 'get' | 'post' | 'delete' | 'put';
        url: string;
        params?: Record<string, any>;
        data?: any;
        headers?: Record<string, string>;
    }
): Promise<T> {
    const { accessToken } = await getValidAccessToken(workspaceId, 'youtube');

    const response = await axios.request<T>({
        method: config.method ?? 'get',
        url: config.url,
        params: config.params,
        data: config.data,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(config.headers ?? {}),
        },
    });

    return response.data;
}

// ─────────────────────────────────────────────────────────────────────────────
//   OAUTH INITIATION  GET /api/connections/:platform/auth
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:platform/auth', withWorkspace, (req: Request, res: Response) => {
    const platform = req.params.platform as Platform;
    if (!OAUTH_CONFIG[platform]) return res.status(404).json({ error: 'UNKNOWN_PLATFORM' });

    const workspaceId = (req as any).workspaceId;
    try {
        res.redirect(buildOAuthUrl(platform, workspaceId));
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'OAUTH_NOT_CONFIGURED' });
    }
});

router.get('/:platform/auth-url', withWorkspace, (req: Request, res: Response) => {
    const platform = req.params.platform as Platform;
    if (!OAUTH_CONFIG[platform]) {
        return res.status(404).json({ error: 'UNKNOWN_PLATFORM' });
    }

    try {
        const workspaceId = (req as any).workspaceId;
        return res.json({ url: buildOAuthUrl(platform, workspaceId) });
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'OAUTH_NOT_CONFIGURED' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//   YOUTUBE CALLBACK
// ─────────────────────────────────────────────────────────────────────────────
router.get('/youtube/callback', async (req: Request, res: Response) => {
    try {
        const { code, state } = req.query as Record<string, string>;
        const { workspaceId } = verifyState(state);
        const cfg = OAUTH_CONFIG.youtube;

        // Exchange code for tokens
        const tokenRes = await axios.post(cfg.tokenUrl, new URLSearchParams({
            code,
            client_id: cfg.clientId(),
            client_secret: cfg.clientSecret(),
            redirect_uri: cfg.redirectUri(),
            grant_type: 'authorization_code',
        }));

        const { access_token, refresh_token, expires_in } = tokenRes.data;

        // Fetch channel info
        const channelRes = await axios.get(
            'https://www.googleapis.com/youtube/v3/channels',
            {
                params: { part: 'snippet,statistics', mine: true },
                headers: { Authorization: `Bearer ${access_token}` },
            }
        );

        const channel = channelRes.data.items?.[0];
        if (!channel) {
            return res.redirect(`${env('CLIENT_URL') || 'http://localhost:5173'}/dashboard/connections?error=youtube&reason=no_channel`);
        }

        await saveConnection(workspaceId, 'youtube', {
            accessToken: access_token,
            refreshToken: refresh_token,
            tokenExpiry: Date.now() + expires_in * 1000,
            accountId: channel.id,
            accountName: channel.snippet.title,
            accountAvatar: channel.snippet.thumbnails?.default?.url,
            followersCount: parseInt(channel.statistics?.subscriberCount ?? '0'),
            scope: cfg.scopes,
            meta: { channelId: channel.id, thumbnailUrl: channel.snippet.thumbnails?.default?.url },
        });

        res.redirect(`${env('CLIENT_URL') || 'http://localhost:5173'}/dashboard/connections?connected=youtube`);
    } catch (err) {
        console.error('[YouTube callback]', err);
        res.redirect(`${env('CLIENT_URL') || 'http://localhost:5173'}/dashboard/connections?error=youtube`);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//   INSTAGRAM CALLBACK
// ─────────────────────────────────────────────────────────────────────────────
router.get('/instagram/callback', async (req: Request, res: Response) => {
    try {
        const { code, state } = req.query as Record<string, string>;
        const { workspaceId } = verifyState(state);
        const cfg = OAUTH_CONFIG.instagram;

        // Exchange code
        const tokenRes = await axios.get(cfg.tokenUrl, {
            params: {
                client_id: cfg.clientId(),
                client_secret: cfg.clientSecret(),
                redirect_uri: cfg.redirectUri(),
                code,
            },
        });

        let { access_token, expires_in } = tokenRes.data;

        // Swap the short-lived token (about an hour) for a long-lived one (about 60 days). Page tokens
        // fetched with a long-lived user token don't expire, which DMs and scheduled posts rely on.
        try {
            const longRes = await axios.get(cfg.tokenUrl, {
                params: {
                    grant_type: 'fb_exchange_token',
                    client_id: cfg.clientId(),
                    client_secret: cfg.clientSecret(),
                    fb_exchange_token: access_token,
                },
            });
            if (longRes.data?.access_token) {
                access_token = longRes.data.access_token;
                expires_in = longRes.data.expires_in ?? 5184000;
            }
        } catch (err: any) {
            console.warn('[Instagram callback] Long-lived token exchange failed:', err.response?.data?.error?.message || err.message);
        }

        // Get the Instagram Business Account via /me/accounts
        const accountsRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
            params: { access_token },
        });

        let igAccountId = '', igUsername = '', igFollowers = 0, pageId = '', pageToken = '';
        for (const page of accountsRes.data.data ?? []) {
            try {
                const igRes = await axios.get(
                    `https://graph.facebook.com/v19.0/${page.id}`,
                    {
                        params: {
                            fields: 'instagram_business_account{id,username,followers_count}',
                            access_token: page.access_token,
                        },
                    }
                );
                const iga = igRes.data?.instagram_business_account;
                if (iga) {
                    igAccountId = iga.id;
                    igUsername = iga.username;
                    igFollowers = iga.followers_count ?? 0;
                    pageId = page.id;
                    pageToken = page.access_token;
                    break;
                }
            } catch { /* page may not have IG */ }
        }

        // Without an Instagram professional account linked to a Facebook Page there is nothing to
        // publish to or read DMs from, so don't save an empty connection.
        if (!igAccountId) {
            return res.redirect(`${env('CLIENT_URL') || 'http://localhost:5173'}/dashboard/connections?error=instagram&reason=no_instagram_business`);
        }

        // DMs: subscribe the Page to message webhooks (best effort; needs pages_manage_metadata).
        if (pageId && pageToken) {
            try {
                await axios.post(`https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`, null, {
                    params: { subscribed_fields: 'messages', access_token: pageToken },
                });
            } catch (err: any) {
                console.warn('[Instagram callback] Page webhook subscription failed:', err.response?.data?.error?.message || err.message);
            }
        }

        const metaUserId = await fetchMetaUserId(access_token);
        await saveConnection(workspaceId, 'instagram', {
            accessToken: access_token,
            refreshToken: access_token, // Meta tokens are self-refreshing long-lived tokens
            tokenExpiry: Date.now() + (expires_in ?? 5184000) * 1000,
            accountId: igAccountId,
            accountName: igUsername,
            followersCount: igFollowers,
            scope: cfg.scopes,
            meta: {
                instagramAccountId: igAccountId,
                username: igUsername,
                // Used to send DMs (services/instagram-dm.ts). Page tokens from a long-lived user token don't expire.
                pageId: pageId || null,
                pageAccessToken: pageToken ? encrypt(pageToken) : null,
                metaUserId: metaUserId || null,
            },
        });
        await linkMetaUser(metaUserId, workspaceId, 'instagram');

        res.redirect(`${env('CLIENT_URL') || 'http://localhost:5173'}/dashboard/connections?connected=instagram`);
    } catch (err) {
        console.error('[Instagram callback]', err);
        res.redirect(`${env('CLIENT_URL') || 'http://localhost:5173'}/dashboard/connections?error=instagram`);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//   TIKTOK CALLBACK
// ─────────────────────────────────────────────────────────────────────────────
router.get('/tiktok/callback', async (req: Request, res: Response) => {
    try {
        const { code, state } = req.query as Record<string, string>;
        const { workspaceId } = verifyState(state);
        const cfg = OAUTH_CONFIG.tiktok;

        // Exchange code — TikTok uses client_key, not client_id
        const tokenRes = await axios.post(cfg.tokenUrl, new URLSearchParams({
            client_key: cfg.clientId(),
            client_secret: cfg.clientSecret(),
            code,
            grant_type: 'authorization_code',
            redirect_uri: cfg.redirectUri(),
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        // TikTok v2 returns the token fields at the top level (older docs showed them under data).
        const tokens = tokenRes.data?.data?.access_token ? tokenRes.data.data : tokenRes.data;
        if (!tokens?.access_token) {
            throw new Error(`TikTok token exchange failed: ${tokens?.error || 'no token'} ${tokens?.error_description || ''}`.trim());
        }
        const { access_token, refresh_token, expires_in, open_id } = tokens;

        // Get user info. follower_count needs user.info.stats, so only basic fields are requested.
        const userRes = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
            params: { fields: 'open_id,display_name,avatar_url' },
            headers: { Authorization: `Bearer ${access_token}` },
        });

        const user = userRes.data.data?.user;

        await saveConnection(workspaceId, 'tiktok', {
            accessToken: access_token,
            refreshToken: refresh_token,
            tokenExpiry: Date.now() + expires_in * 1000,
            accountId: open_id,
            accountName: user?.display_name ?? '',
            accountAvatar: user?.avatar_url,
            followersCount: 0,
            scope: cfg.scopes,
            meta: { open_id, display_name: user?.display_name, avatar_url: user?.avatar_url },
        });

        res.redirect(`${env('CLIENT_URL') || 'http://localhost:5173'}/dashboard/connections?connected=tiktok`);
    } catch (err) {
        console.error('[TikTok callback]', err);
        res.redirect(`${env('CLIENT_URL') || 'http://localhost:5173'}/dashboard/connections?error=tiktok`);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//   FACEBOOK PAGE CALLBACK  (same Meta app as Instagram)
//   Connects the first Page the person manages; its Page token does not expire.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/facebook/callback', async (req: Request, res: Response) => {
    const back = (q: string) => res.redirect(`${env('CLIENT_URL') || 'http://localhost:5173'}/dashboard/connections?${q}`);
    try {
        const { code, state } = req.query as Record<string, string>;
        const { workspaceId } = verifyState(state);
        const cfg = OAUTH_CONFIG.facebook;

        const tokenRes = await axios.get(cfg.tokenUrl, {
            params: { client_id: cfg.clientId(), client_secret: cfg.clientSecret(), redirect_uri: cfg.redirectUri(), code },
        });
        let userToken = tokenRes.data.access_token;
        // A long-lived user token makes the Page tokens below permanent.
        try {
            const longRes = await axios.get(cfg.tokenUrl, {
                params: { grant_type: 'fb_exchange_token', client_id: cfg.clientId(), client_secret: cfg.clientSecret(), fb_exchange_token: userToken },
            });
            if (longRes.data?.access_token) userToken = longRes.data.access_token;
        } catch (err: any) {
            console.warn('[Facebook callback] Long-lived token exchange failed:', err.response?.data?.error?.message || err.message);
        }

        const pagesRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
            params: { access_token: userToken, fields: 'id,name,access_token,followers_count,fan_count,picture{url}' },
        });
        const page = (pagesRes.data?.data || [])[0];
        if (!page?.access_token) return back('error=facebook&reason=no_page');

        const metaUserId = await fetchMetaUserId(userToken);
        await saveConnection(workspaceId, 'facebook', {
            accessToken: page.access_token, // Page token: what posting and replies use
            refreshToken: userToken,
            tokenExpiry: Date.now() + 10 * 365 * 86400 * 1000, // Page tokens from a long-lived user token don't expire
            accountId: page.id,
            accountName: page.name,
            followersCount: page.followers_count ?? page.fan_count ?? 0,
            accountAvatar: page.picture?.data?.url || undefined,
            scope: cfg.scopes,
            meta: { pageId: page.id, pageName: page.name, pageCount: (pagesRes.data?.data || []).length, metaUserId: metaUserId || null },
        });
        await linkMetaUser(metaUserId, workspaceId, 'facebook');
        back('connected=facebook');
    } catch (err) {
        console.error('[Facebook callback]', err);
        back('error=facebook');
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//   GET /api/connections  — list all (metadata only, no raw tokens)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const snap = await db
        .collection('workspaces').doc(workspaceId)
        .collection('connections').get();

    const connections = snap.docs.map((d) => {
        // Strip encrypted tokens from the response
        const { accessToken, refreshToken, ...safe } = d.data();
        return safe;
    });

    res.json({ connections });
});

router.get('/youtube/videos', withWorkspace, async (req: Request, res: Response) => {
    try {
        const workspaceId = (req as any).workspaceId;
        const maxResults = Math.min(Number(req.query.maxResults ?? 12), 50);
        const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined;
        const searchData = await youtubeApiRequest<any>(workspaceId, {
            url: 'https://www.googleapis.com/youtube/v3/search',
            params: {
                part: 'id',
                forMine: true,
                type: 'video',
                maxResults,
                order: 'date',
                pageToken,
            },
        });

        const videoIds = (searchData.items ?? [])
            .map((item: any) => item.id?.videoId)
            .filter(Boolean);

        if (videoIds.length === 0) {
            return res.json({ videos: [], nextPageToken: searchData.nextPageToken ?? null });
        }

        const data = await youtubeApiRequest<any>(workspaceId, {
            url: 'https://www.googleapis.com/youtube/v3/videos',
            params: {
                part: 'snippet,status,statistics,contentDetails',
                id: videoIds.join(','),
            },
        });

        return res.json({
            videos: (data.items ?? []).map(normalizeYoutubeVideo),
            nextPageToken: searchData.nextPageToken ?? null,
        });
    } catch (error: any) {
        console.error('[YouTube videos]', error.response?.data || error.message);
        return res.status(error.message === 'NOT_CONNECTED' ? 404 : 500).json({
            error: error.message === 'NOT_CONNECTED' ? 'YOUTUBE_NOT_CONNECTED' : 'YOUTUBE_VIDEOS_FAILED',
        });
    }
});

router.get('/youtube/comments', withWorkspace, async (req: Request, res: Response) => {
    try {
        const workspaceId = (req as any).workspaceId;
        const connection = await getConnectionDoc(workspaceId, 'youtube');
        if (!connection) {
            return res.status(404).json({ error: 'YOUTUBE_NOT_CONNECTED' });
        }

        const maxResults = Math.min(Number(req.query.maxResults ?? 10), 50);
        const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined;
        const videoId = typeof req.query.videoId === 'string' ? req.query.videoId : undefined;
        const channelId = connection.data.channelId || connection.data.accountId;

        const params: Record<string, any> = {
            part: 'snippet',
            textFormat: 'plainText',
            maxResults,
            pageToken,
            order: 'time',
        };

        if (videoId) {
            params.videoId = videoId;
        } else {
            params.allThreadsRelatedToChannelId = channelId;
        }

        const data = await youtubeApiRequest<any>(workspaceId, {
            url: 'https://www.googleapis.com/youtube/v3/commentThreads',
            params,
        });

        return res.json({
            comments: (data.items ?? []).map(normalizeYoutubeComment),
            nextPageToken: data.nextPageToken ?? null,
        });
    } catch (error: any) {
        console.error('[YouTube comments]', error.response?.data || error.message);
        return res.status(500).json({ error: 'YOUTUBE_COMMENTS_FAILED' });
    }
});

router.post('/youtube/upload', withWorkspace, async (req: Request, res: Response) => {
    try {
        const workspaceId = (req as any).workspaceId;
        const {
            videoUrl,
            title,
            description = '',
            tags = [],
            categoryId = '22',
            privacyStatus = 'private',
        } = req.body ?? {};

        if (!videoUrl || !title) {
            return res.status(400).json({ error: 'VIDEO_URL_AND_TITLE_REQUIRED' });
        }

        const { accessToken } = await getValidAccessToken(workspaceId, 'youtube');
        const videoId = await publishToYouTube({
            accessToken,
            videoUrl,
            title,
            description,
            tags: Array.isArray(tags) ? tags : [],
            categoryId,
            privacyStatus,
        });

        return res.status(201).json({ success: true, videoId });
    } catch (error: any) {
        console.error('[YouTube upload]', error.response?.data || error.message);
        return res.status(error.message === 'NOT_CONNECTED' ? 404 : 500).json({
            error: error.message === 'NOT_CONNECTED' ? 'YOUTUBE_NOT_CONNECTED' : 'YOUTUBE_UPLOAD_FAILED',
        });
    }
});

router.delete('/youtube/videos/:videoId', withWorkspace, async (req: Request, res: Response) => {
    try {
        const workspaceId = (req as any).workspaceId;
        const { videoId } = req.params;

        if (!videoId) {
            return res.status(400).json({ error: 'VIDEO_ID_REQUIRED' });
        }

        await youtubeApiRequest(workspaceId, {
            method: 'delete',
            url: 'https://www.googleapis.com/youtube/v3/videos',
            params: { id: videoId },
        });

        return res.json({ success: true, videoId });
    } catch (error: any) {
        console.error('[YouTube delete]', error.response?.data || error.message);
        return res.status(error.message === 'NOT_CONNECTED' ? 404 : 500).json({
            error: error.message === 'NOT_CONNECTED' ? 'YOUTUBE_NOT_CONNECTED' : 'YOUTUBE_DELETE_FAILED',
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//   DELETE /api/connections/:platform  — revoke + delete
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:platform', withWorkspace, async (req: Request, res: Response) => {
    const { platform } = req.params;
    const workspaceId = (req as any).workspaceId;

    const docRef = db
        .collection('workspaces').doc(workspaceId)
        .collection('connections').doc(platform as string);

    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'NOT_CONNECTED' });

    // Revoke at the provider (best effort), delete what the connection brought in, then the
    // connection itself. Platform policies require both on disconnect (YouTube: within 7 days).
    const data = snap.data()!;
    const revoke = await revokeConnection(workspaceId, platform as string, data);
    let removed = 0;
    if (platform === 'instagram') removed += await deleteMetaPlatformData(workspaceId);
    removed += await purgePlatformAnalytics(workspaceId, platform as string);
    await unlinkMetaUser(data.metaUserId, workspaceId, platform as string);
    await docRef.delete();
    res.json({ success: true, platform, revoked: revoke.revoked, note: revoke.note || null, removed });
});

// ─────────────────────────────────────────────────────────────────────────────
//   GET /api/connections/tiktok/creator-info  — what TikTok allows this creator to post now
// ─────────────────────────────────────────────────────────────────────────────
router.get('/tiktok/creator-info', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    try {
        const { accessToken } = await getValidAccessToken(workspaceId, 'tiktok');
        const { data } = await axios.post('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {}, {
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
            timeout: 15000,
        });
        const info = data?.data || {};
        res.json({
            nickname: info.creator_nickname || '',
            username: info.creator_username || '',
            avatarUrl: info.creator_avatar_url || '',
            privacyLevelOptions: Array.isArray(info.privacy_level_options) ? info.privacy_level_options : [],
            commentDisabled: !!info.comment_disabled,
            duetDisabled: !!info.duet_disabled,
            stitchDisabled: !!info.stitch_disabled,
            maxVideoPostDurationSec: Number(info.max_video_post_duration_sec) || null,
            // TikTok returns an error code (e.g. spam_risk_too_many_posts) when the creator can't post now.
            canPost: !data?.error?.code || data.error.code === 'ok',
            reason: data?.error?.code && data.error.code !== 'ok' ? data.error.message || data.error.code : null,
        });
    } catch (err: any) {
        if (err.message === 'NOT_CONNECTED') return res.status(404).json({ error: 'TikTok is not connected.' });
        const e = err.response?.data?.error;
        res.status(502).json({ error: e?.message || 'Could not reach TikTok.', code: e?.code || null, canPost: false });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//   POST /api/connections/:platform/refresh  — manual token refresh
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:platform/refresh', withWorkspace, async (req: Request, res: Response) => {
    const { platform } = req.params as { platform: Platform };
    const workspaceId = (req as any).workspaceId;

    try {
        const updated = await refreshPlatformToken(workspaceId, platform);
        if (!updated) return res.status(400).json({ error: 'NO_REFRESH_TOKEN' });
        res.json({ success: true, tokenExpiry: updated });
    } catch (err: any) {
        res.status(500).json({ error: 'REFRESH_FAILED', message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//   TOKEN REFRESH LOGIC (shared between manual endpoint + cron)
// ─────────────────────────────────────────────────────────────────────────────
async function refreshPlatformToken(workspaceId: string, platform: Platform): Promise<number | null> {
    const cfg = OAUTH_CONFIG[platform];
    const docRef = db
        .collection('workspaces').doc(workspaceId)
        .collection('connections').doc(platform);

    const snap = await docRef.get();
    if (!snap.exists) return null;

    const data = snap.data()!;
    if (!data.refreshToken) return null;

    const refreshToken = decrypt(data.refreshToken);

    let newAccessToken = '';
    let newRefreshToken = '';
    let expiresIn = 3600;

    if (platform === 'youtube') {
        const res = await axios.post(cfg.tokenUrl, new URLSearchParams({
            client_id: cfg.clientId(),
            client_secret: cfg.clientSecret(),
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }));
        newAccessToken = res.data.access_token;
        newRefreshToken = res.data.refresh_token ?? refreshToken; // Google may not rotate
        expiresIn = res.data.expires_in ?? 3600;
    } else if (platform === 'tiktok') {
        const res = await axios.post(cfg.tokenUrl, new URLSearchParams({
            client_key: cfg.clientId(),
            client_secret: cfg.clientSecret(),
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        // TikTok v2 returns token fields at the top level.
        const t = res.data?.data?.access_token ? res.data.data : res.data;
        if (!t?.access_token) throw new Error(`TikTok token refresh failed: ${t?.error || 'no token'}`);
        newAccessToken = t.access_token;
        newRefreshToken = t.refresh_token ?? refreshToken;
        expiresIn = t.expires_in ?? 3600;
    } else if (platform === 'facebook') {
        // Page tokens don't expire; nothing to refresh.
        return data.tokenExpiry ?? null;
    } else if (platform === 'instagram') {
        // Meta exchange long-lived token for new long-lived token
        const res = await axios.get(cfg.tokenUrl, {
            params: {
                grant_type: 'fb_exchange_token',
                client_id: cfg.clientId(),
                client_secret: cfg.clientSecret(),
                fb_exchange_token: refreshToken, // For Meta, we store the long-lived token as refresh token too
            },
        });
        newAccessToken = res.data.access_token;
        newRefreshToken = res.data.access_token; // Meta tokens are self-refreshing
        expiresIn = res.data.expires_in ?? 5184000;
    } else {
        throw new Error(`Token refresh is not supported for ${platform}`);
    }

    const tokenExpiry = Date.now() + expiresIn * 1000;

    await docRef.update({
        accessToken: encrypt(newAccessToken),
        refreshToken: encrypt(newRefreshToken),
        tokenExpiry,
        status: 'active',
        updatedAt: FieldValue.serverTimestamp(),
    });

    return tokenExpiry;
}

// ─────────────────────────────────────────────────────────────────────────────
//   TOKEN AUTO-REFRESH CRON  (every 6 hours)
//   Scans all connections expiring within 24 hours
// ─────────────────────────────────────────────────────────────────────────────
export function startTokenRefreshCron() {
    cron.schedule('0 */6 * * *', async () => {
        console.log('[TokenRefreshCron] Scanning for expiring tokens…');
        const expiryThreshold = Date.now() + 86400 * 1000; // within 24 hours

        try {
            // Scan all workspace connection sub-collections
            const workspacesSnap = await db.collection('workspaces').get();

            for (const wsDoc of workspacesSnap.docs) {
                const workspaceId = wsDoc.id;
                const ownerId = wsDoc.data().ownerId;

                // Filtered in memory: a workspace has a handful of connections, and a two-field
                // query would need a composite index.
                const allConnections = await db
                    .collection('workspaces').doc(workspaceId)
                    .collection('connections')
                    .get();

                // Access removed at the platform (or a refresh that keeps failing) for 30 days:
                // delete the connection and the data it brought in (YouTube API Services III.D.2).
                for (const connDoc of allConnections.docs) {
                    const d = connDoc.data();
                    const since = (d.revokedAt || d.updatedAt)?.toMillis?.() ?? 0;
                    if ((d.status === 'expired' || d.status === 'revoked') && since && since < Date.now() - 30 * 86400 * 1000) {
                        if (connDoc.id === 'instagram') await deleteMetaPlatformData(workspaceId);
                        await purgePlatformAnalytics(workspaceId, connDoc.id);
                        await unlinkMetaUser(d.metaUserId, workspaceId, connDoc.id);
                        await connDoc.ref.delete();
                        console.log(`[TokenRefreshCron] Deleted ${connDoc.id} for ${workspaceId}: access ended over 30 days ago`);
                    }
                }

                const connectionsSnap = allConnections.docs.filter((d) => d.data().status === 'active' && Number(d.data().tokenExpiry ?? 0) < expiryThreshold);
                for (const connDoc of connectionsSnap) {
                    const platform = connDoc.id as Platform;
                    if (!PLATFORMS.includes(platform)) continue;

                    try {
                        await refreshPlatformToken(workspaceId, platform);
                        console.log(`[TokenRefreshCron] ✅ Refreshed ${platform} for workspace ${workspaceId}`);
                    } catch (err) {
                        console.error(`[TokenRefreshCron] ❌ Failed to refresh ${platform} for ${workspaceId}`, err);

                        // Mark as expired and notify user
                        await connDoc.ref.update({
                            status: 'expired',
                            updatedAt: FieldValue.serverTimestamp(),
                        });

                        // Send re-auth email (using your existing email utility)
                        try {
                            const userSnap = await db.collection('users').doc(ownerId).get();
                            const email = userSnap.data()?.email;
                            if (email) {
                                // Stub: replace with your sendEmail(email, ...) call
                                console.warn(`[TokenRefreshCron] Re-auth required: ${email} → ${platform}`);
                            }
                        } catch { /* ignore email failure */ }
                    }
                }
            }
        } catch (err) {
            console.error('[TokenRefreshCron] Cron error:', err);
        }
    });

    console.log('[TokenRefreshCron] Scheduled — runs every 6 hours');
}

export default router;
