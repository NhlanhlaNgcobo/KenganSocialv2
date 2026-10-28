import { tiktokPostMode, tiktokScopes } from '../services/publishers/tiktok';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import cron from 'node-cron';
import { db } from '../utils/firestore';
import { encrypt, decrypt } from '../utils/tokenEncryption';
import { consumeState, redisNonceClaimer, safeOAuthError, signState as signOAuthState } from '../services/oauth-state';
import { readyUsageRedis } from '../utils/usageRedis';
import { availabilityFor } from '../services/publish-availability';
import { usageLimit } from '../middleware/planGate';
import { FieldValue } from 'firebase-admin/firestore';
import { publishToYouTube } from '../services/publishers/youtube';
import { deleteConnection } from '../services/data-deletion.service';
import { graphUrl, graphErrorMessage, metaDialogUrl } from '../config/meta';

/** App-scoped Facebook user id of a Meta login; Meta's data-deletion callback identifies people by it. */
async function metaUserIdFor(userToken: string): Promise<string | null> {
    try {
        const me = await axios.get(graphUrl('me'), { params: { fields: 'id', access_token: userToken } });
        return me.data?.id || null;
    } catch (err: any) {
        console.warn('[Meta] Could not read the Facebook user id:', err.response?.data?.error?.message || err.message);
        return null;
    }
}

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
        authUrl: metaDialogUrl(),
        tokenUrl: graphUrl('oauth/access_token'),
        // Keep in step with client/src/content/platform-permissions.js: reviewers compare them.
        scopes: [
            // Publishing and insights for an Instagram professional account linked to a Page.
            'instagram_basic', 'instagram_content_publish', 'instagram_manage_insights',
            // Inbox: comments (read, reply, comment-to-DM) and direct messages.
            'instagram_manage_comments', 'instagram_manage_messages',
            // Finding the linked Page (also in Business Manager) and subscribing it to webhooks.
            'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'business_management',
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
        // with video.publish posts go straight to the profile, with only video.upload (the default) to the TikTok inbox.
        scopes: tiktokScopes(),
        clientId: () => env('TIKTOK_CLIENT_KEY'),
        clientSecret: () => env('TIKTOK_CLIENT_SECRET'),
        redirectUri: () => `${REDIRECT_BASE}/api/connections/tiktok/callback`,
    },
    facebook: {
        authUrl: metaDialogUrl(),
        tokenUrl: graphUrl('oauth/access_token'),
        scopes: [
            // Publish to the Page, read and answer its comments, Messenger DMs, webhooks.
            'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_metadata',
            'pages_manage_engagement', 'pages_read_user_content', 'pages_messaging', 'business_management',
        ],
        clientId: () => env('FACEBOOK_APP_ID'),
        clientSecret: () => env('FACEBOOK_APP_SECRET'),
        redirectUri: () => `${REDIRECT_BASE}/api/connections/facebook/callback`,
    },
    meta_ads: {
        authUrl: metaDialogUrl(),
        tokenUrl: graphUrl('oauth/access_token'),
        // Ads page (routes/ads.ts): campaign results (ads_read); pause, resume and budget changes the user makes (ads_management).
        scopes: ['ads_read', 'ads_management'],
        clientId: () => env('FACEBOOK_APP_ID'),
        clientSecret: () => env('FACEBOOK_APP_SECRET'),
        redirectUri: () => `${REDIRECT_BASE}/api/connections/meta_ads/callback`,
    },
};

type Platform = keyof typeof OAUTH_CONFIG;
const PLATFORMS = Object.keys(OAUTH_CONFIG) as Platform[];

// ─── Middleware: extract workspaceId from Firebase token ──────────────────────
import { withWorkspace } from '../middleware/withWorkspace';
import { requireWorkspaceRole } from '../middleware/workspaceAccess';

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

// OAuth state is signed, expires, names the user + workspace + platform that started the sign-in,
// and works once (services/oauth-state.ts). The callback also re-checks that this user may still
// manage connections for that workspace.
function stateKey() {
    const key = env('TOKEN_ENCRYPTION_KEY');
    if (!key) throw new Error('TOKEN_ENCRYPTION_KEY_NOT_SET');
    return key;
}
const claimNonce = redisNonceClaimer(readyUsageRedis);
async function verifyCallbackState(state: string | undefined, platforms: string[]): Promise<{ workspaceId: string; platform: string }> {
    const data = await consumeState(stateKey(), state, platforms, claimNonce);
    if (data.uid) {
        const ws = await db.collection('workspaces').doc(data.workspaceId).get();
        if (!ws.exists) throw new Error('OAUTH_WORKSPACE_GONE');
        if (ws.data()?.ownerId !== data.uid) {
            const member = await ws.ref.collection('members').doc(data.uid).get();
            if (!member.exists || !['owner', 'admin'].includes(member.data()?.role)) throw new Error('OAUTH_NOT_ALLOWED');
        }
    }
    return data;
}

function buildOAuthUrl(platform: Platform, workspaceId: string, uid: string) {
    const cfg = ensureOAuthConfig(platform);
    const state = signOAuthState(stateKey(), { workspaceId, platform, uid });

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

/** Access token for a connection, refreshed first when it expires within a minute. Used by the post queue too. */
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

/**
 * Connected accounts per workspace (plan/beta/pilot `connections` limit). Reconnecting a platform
 * that is already connected is always allowed.
 */
async function connectionCapCheck(req: Request, res: Response, next: NextFunction) {
    const workspaceId = (req as any).workspaceId;
    const limit = usageLimit(workspaceId, (req as any).plan || 'starter', 'connections');
    if (limit === -1) return next();
    try {
        const snap = await db.collection('workspaces').doc(workspaceId).collection('connections').get();
        const ids = snap.docs.map((d) => d.id);
        if (ids.includes(req.params.platform) || ids.length < limit) return next();
        return res.status(402).json({ error: 'CONNECTION_LIMIT', message: `You can connect up to ${limit} accounts. Disconnect one to add another.`, limit });
    } catch (err: any) {
        console.error('[Connections] cap check failed:', err?.message);
        return res.status(503).json({ error: 'TRY_AGAIN', message: "We couldn't check your connections. Try again." });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//   OAUTH INITIATION  GET /api/connections/:platform/auth
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:platform/auth', withWorkspace, requireWorkspaceRole('owner', 'admin'), connectionCapCheck, (req: Request, res: Response) => {
    const platform = req.params.platform as Platform;
    if (!OAUTH_CONFIG[platform]) return res.status(404).json({ error: 'UNKNOWN_PLATFORM' });

    const workspaceId = (req as any).workspaceId;
    try {
        res.redirect(buildOAuthUrl(platform, workspaceId, (req as any).uid));
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'OAUTH_NOT_CONFIGURED' });
    }
});

router.get('/:platform/auth-url', withWorkspace, requireWorkspaceRole('owner', 'admin'), connectionCapCheck, (req: Request, res: Response) => {
    const platform = req.params.platform as Platform;
    if (!OAUTH_CONFIG[platform]) {
        return res.status(404).json({ error: 'UNKNOWN_PLATFORM' });
    }

    try {
        const workspaceId = (req as any).workspaceId;
        return res.json({ url: buildOAuthUrl(platform, workspaceId, (req as any).uid) });
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
        const { workspaceId } = await verifyCallbackState(state, ['youtube']);
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
        console.error('[YouTube callback]', safeOAuthError(err));
        res.redirect(`${env('CLIENT_URL') || 'http://localhost:5173'}/dashboard/connections?error=youtube`);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//   META (Instagram, Facebook Page, Meta Ads) — one Facebook Login flow each
//   1. exchange the code for a long-lived user token (about 60 days; Page tokens fetched with it don't expire)
//   2. list what the person can connect: Instagram accounts linked to their Pages, Pages, or ad accounts
//   3. one candidate → connect it; several → the person picks one on the Connections page (?select=<platform>)
// ─────────────────────────────────────────────────────────────────────────────
type MetaPlatform = 'instagram' | 'facebook' | 'meta_ads';
const META_PICK_PLATFORMS: MetaPlatform[] = ['instagram', 'facebook', 'meta_ads'];
const PENDING_TTL_MS = 15 * 60 * 1000;
const clientUrl = () => env('CLIENT_URL') || 'http://localhost:5173';

interface MetaCandidate {
    accountId: string;
    name: string;
    avatar?: string | null;
    followers?: number;
    detail?: string; // e.g. the linked Page, or the ad account's currency
    pageId?: string;
    pageToken?: string; // encrypted while pending
    extra?: Record<string, unknown>;
}

interface MetaLogin {
    userToken: string;
    expiresIn: number;
    metaUserId: string | null;
}

async function metaLoginFromCode(platform: MetaPlatform, code: string): Promise<MetaLogin> {
    const cfg = OAUTH_CONFIG[platform];
    const tokenRes = await axios.get(cfg.tokenUrl, {
        params: { client_id: cfg.clientId(), client_secret: cfg.clientSecret(), redirect_uri: cfg.redirectUri(), code },
    });
    let userToken: string = tokenRes.data.access_token;
    let expiresIn: number = tokenRes.data.expires_in ?? 3600;
    try {
        const longRes = await axios.get(cfg.tokenUrl, {
            params: { grant_type: 'fb_exchange_token', client_id: cfg.clientId(), client_secret: cfg.clientSecret(), fb_exchange_token: userToken },
        });
        if (longRes.data?.access_token) {
            userToken = longRes.data.access_token;
            expiresIn = longRes.data.expires_in ?? 5184000;
        }
    } catch (err: any) {
        console.warn(`[Meta ${platform}] Long-lived token exchange failed:`, graphErrorMessage(err));
    }
    return { userToken, expiresIn, metaUserId: await metaUserIdFor(userToken) };
}

/** Every item of a paged Graph list (up to 500). */
async function graphList(path: string, params: Record<string, string>) {
    const items: any[] = [];
    let url: string | null = graphUrl(path);
    let query: Record<string, string> | undefined = { limit: '100', ...params };
    while (url && items.length < 500) {
        const res: any = await axios.get(url, { params: query, timeout: 20000 });
        items.push(...(res.data?.data || []));
        url = res.data?.paging?.next || null;
        query = undefined; // the next URL carries every parameter
    }
    return items;
}

async function metaCandidates(platform: MetaPlatform, userToken: string): Promise<MetaCandidate[]> {
    if (platform === 'meta_ads') {
        const accounts = await graphList('me/adaccounts', { fields: 'id,name,account_status,currency,business{name}', access_token: userToken });
        return accounts.map((a) => ({
            accountId: String(a.id),
            name: a.name || a.id,
            detail: [a.business?.name, a.currency, a.account_status === 1 ? '' : 'not active'].filter(Boolean).join(' · '),
            extra: { currency: a.currency || null, accountStatus: a.account_status ?? null },
        }));
    }
    const fields =
        platform === 'instagram'
            ? 'id,name,access_token,instagram_business_account{id,username,followers_count,profile_picture_url}'
            : 'id,name,access_token,followers_count,fan_count,picture{url}';
    const pages = await graphList('me/accounts', { fields, access_token: userToken });
    if (platform === 'instagram') {
        return pages
            .filter((p) => p.instagram_business_account && p.access_token)
            .map((p) => ({
                accountId: String(p.instagram_business_account.id),
                name: p.instagram_business_account.username || p.name,
                avatar: p.instagram_business_account.profile_picture_url || null,
                followers: p.instagram_business_account.followers_count ?? 0,
                detail: `Linked to the Page ${p.name}`,
                pageId: String(p.id),
                pageToken: p.access_token,
            }));
    }
    return pages
        .filter((p) => p.access_token)
        .map((p) => ({
            accountId: String(p.id),
            name: p.name,
            avatar: p.picture?.data?.url || null,
            followers: p.followers_count ?? p.fan_count ?? 0,
            pageId: String(p.id),
            pageToken: p.access_token,
        }));
}

/**
 * Page webhook fields each Meta connection needs (POST /{page-id}/subscribed_apps, which needs
 * pages_manage_metadata). Facebook: Page comments (feed), Messenger messages and the Page's own
 * replies (message_echoes, to notice the owner answering by hand). Instagram: its messages and
 * comments are chosen in the app's Instagram webhook settings, but they are only delivered for a Page
 * that has the app installed, which this subscription does; if Meta refuses `messages` (it can need
 * pages_messaging, which the Instagram sign-in doesn't ask for), the Page is subscribed to `name`
 * (rare events) just to install the app. Each list is tried in turn until one is accepted.
 */
const PAGE_WEBHOOK_FIELDS: Record<'instagram' | 'facebook', string[][]> = {
    instagram: [['messages'], ['name']],
    facebook: [['feed', 'messages', 'message_echoes'], ['feed', 'messages']],
};

export interface WebhookSubscription {
    ok: boolean;
    pageId: string;
    fields: string[];
    error: string | null;
    at: number;
}

/** Fields this app already has on the Page, so a new subscription adds to them instead of replacing them. */
async function subscribedFields(pageId: string, pageToken: string): Promise<string[] | null> {
    try {
        const { data } = await axios.get(graphUrl(`${pageId}/subscribed_apps`), { params: { access_token: pageToken }, timeout: 15000 });
        const appId = env('FACEBOOK_APP_ID');
        const ours = (data?.data || []).find((a: any) => (appId ? String(a.id) === appId : true));
        return Array.isArray(ours?.subscribed_fields) ? ours.subscribed_fields.map(String) : [];
    } catch (err: any) {
        console.warn(`[Meta] Could not read Page ${pageId} webhook subscriptions:`, graphErrorMessage(err));
        return null;
    }
}

/**
 * Subscribes the Page to the union of what it already has, what this connection needs, and what the
 * workspace's other Meta connection on the same Page needs (so connecting Instagram after Facebook
 * keeps `feed`). The result is stored on the connection (webhookSubscription) and shown on Connections.
 */
async function subscribePage(workspaceId: string, platform: 'instagram' | 'facebook', pageId: string, pageToken: string): Promise<WebhookSubscription> {
    const other = platform === 'instagram' ? 'facebook' : 'instagram';
    const sibling = (await getConnectionDoc(workspaceId, other).catch(() => null))?.data;
    const sameSibling = sibling && String(sibling.pageId || sibling.accountId) === pageId && sibling.status === 'active';
    const siblingFields = sameSibling ? sibling.webhookSubscription?.fields || PAGE_WEBHOOK_FIELDS[other][0] : [];
    const existing = await subscribedFields(pageId, pageToken);
    let lastError = 'unknown error';
    for (const needed of PAGE_WEBHOOK_FIELDS[platform]) {
        const fields = [...new Set<string>([...(existing || []), ...siblingFields, ...needed])];
        try {
            const { data } = await axios.post(graphUrl(`${pageId}/subscribed_apps`), null, {
                params: { subscribed_fields: fields.join(','), access_token: pageToken },
                timeout: 15000,
            });
            if (data?.success === false) throw new Error('Meta did not confirm the subscription');
            return { ok: true, pageId, fields, error: null, at: Date.now() };
        } catch (err: any) {
            lastError = graphErrorMessage(err);
            console.warn(`[Meta] Page ${pageId} webhook subscription (${fields.join(',')}) failed:`, lastError);
        }
    }
    return { ok: false, pageId, fields: existing || [], error: lastError.slice(0, 300), at: Date.now() };
}

async function saveMetaConnection(workspaceId: string, platform: MetaPlatform, c: MetaCandidate, login: MetaLogin) {
    const cfg = OAUTH_CONFIG[platform];
    const userExpiry = Date.now() + login.expiresIn * 1000;
    if (platform === 'instagram') {
        // Instagram events (messages, comments) are chosen in the app's webhook settings; the Page must have the app installed.
        const webhookSubscription = await subscribePage(workspaceId, 'instagram', c.pageId!, c.pageToken!);
        await saveConnection(workspaceId, 'instagram', {
            accessToken: login.userToken,
            refreshToken: login.userToken, // a long-lived Meta token renews by exchanging itself
            tokenExpiry: userExpiry,
            accountId: c.accountId,
            accountName: c.name,
            accountAvatar: c.avatar || undefined,
            followersCount: c.followers,
            scope: cfg.scopes,
            meta: {
                metaUserId: login.metaUserId,
                instagramAccountId: c.accountId,
                username: c.name,
                // Messages and comment replies go through the linked Page (services/meta/messaging.ts).
                pageId: c.pageId,
                pageAccessToken: encrypt(c.pageToken!),
                webhookSubscription,
            },
        });
    } else if (platform === 'facebook') {
        const webhookSubscription = await subscribePage(workspaceId, 'facebook', c.pageId!, c.pageToken!);
        await saveConnection(workspaceId, 'facebook', {
            accessToken: c.pageToken!, // Page token: what posting, replies and messages use
            refreshToken: login.userToken,
            tokenExpiry: Date.now() + 10 * 365 * 86400 * 1000, // Page tokens from a long-lived user token don't expire
            accountId: c.accountId,
            accountName: c.name,
            followersCount: c.followers,
            accountAvatar: c.avatar || undefined,
            scope: cfg.scopes,
            meta: { metaUserId: login.metaUserId, pageId: c.accountId, pageName: c.name, webhookSubscription },
        });
    } else {
        await saveConnection(workspaceId, 'meta_ads', {
            accessToken: login.userToken,
            refreshToken: login.userToken,
            tokenExpiry: userExpiry,
            accountId: c.accountId,
            accountName: c.name,
            scope: cfg.scopes,
            meta: { metaUserId: login.metaUserId, adAccountId: c.accountId, ...(c.extra || {}) },
        });
    }
}

const pendingRef = (workspaceId: string, platform: MetaPlatform) =>
    db.collection('workspaces').doc(workspaceId).collection('metaPending').doc(platform);

const NO_CANDIDATES_REASON: Record<MetaPlatform, string> = {
    instagram: 'no_instagram_business',
    facebook: 'no_page',
    meta_ads: 'no_ad_account',
};

/** Shared Meta callback: connect the single candidate, or hold the list for the person to pick from. */
function metaCallback(platform: MetaPlatform) {
    return async (req: Request, res: Response) => {
        const back = (q: string) => res.redirect(`${clientUrl()}/dashboard/connections?${q}`);
        try {
            const { code, state, error } = req.query as Record<string, string>;
            if (error) return back(`error=${platform}&reason=cancelled`); // the person declined on Facebook
            const { workspaceId } = await verifyCallbackState(state, [platform]);
            const login = await metaLoginFromCode(platform, code);
            const candidates = await metaCandidates(platform, login.userToken);
            if (!candidates.length) return back(`error=${platform}&reason=${NO_CANDIDATES_REASON[platform]}`);
            if (candidates.length === 1) {
                await saveMetaConnection(workspaceId, platform, candidates[0], login);
                await pendingRef(workspaceId, platform).delete().catch(() => {});
                return back(`connected=${platform}`);
            }
            // Tokens stay encrypted on the server; the browser only sees names to pick from.
            await pendingRef(workspaceId, platform).set({
                platform,
                candidates: candidates.map((c) => ({ ...c, pageToken: c.pageToken ? encrypt(c.pageToken) : null })),
                userToken: encrypt(login.userToken),
                expiresIn: login.expiresIn,
                metaUserId: login.metaUserId,
                expiresAt: Date.now() + PENDING_TTL_MS,
            });
            back(`select=${platform}`);
        } catch (err: any) {
            console.error(`[Meta ${platform} callback]`, safeOAuthError(err));
            back(`error=${platform}`);
        }
    };
}

router.get('/instagram/callback', metaCallback('instagram'));
router.get('/facebook/callback', metaCallback('facebook'));
router.get('/meta_ads/callback', metaCallback('meta_ads'));

async function loadPending(workspaceId: string, platform: MetaPlatform) {
    const snap = await pendingRef(workspaceId, platform).get();
    const data = snap.data();
    if (!snap.exists || !data) return null;
    if (Number(data.expiresAt) < Date.now()) {
        await snap.ref.delete().catch(() => {});
        return null;
    }
    return data;
}

// The accounts to pick from after a Meta sign-in that found several (names only, no tokens).
router.get('/:platform/candidates', withWorkspace, async (req: Request, res: Response) => {
    const platform = req.params.platform as MetaPlatform;
    const workspaceId = (req as any).workspaceId;
    if (!META_PICK_PLATFORMS.includes(platform)) return res.status(404).json({ error: 'UNKNOWN_PLATFORM' });
    if (!workspaceId) return res.status(403).json({ error: 'NO_WORKSPACE' });
    const pending = await loadPending(workspaceId, platform);
    if (!pending) return res.status(410).json({ error: 'SELECTION_EXPIRED', message: 'The sign-in has expired. Connect again.' });
    res.json({
        platform,
        candidates: (pending.candidates as MetaCandidate[]).map(({ accountId, name, avatar, followers, detail }) => ({ accountId, name, avatar: avatar || null, followers: followers ?? null, detail: detail || '' })),
    });
});

router.post('/:platform/select', withWorkspace, requireWorkspaceRole('owner', 'admin'), async (req: Request, res: Response) => {
    const platform = req.params.platform as MetaPlatform;
    const workspaceId = (req as any).workspaceId;
    if (!META_PICK_PLATFORMS.includes(platform)) return res.status(404).json({ error: 'UNKNOWN_PLATFORM' });
    if (!workspaceId) return res.status(403).json({ error: 'NO_WORKSPACE' });
    const accountId = String(req.body?.accountId || '');
    const pending = await loadPending(workspaceId, platform);
    if (!pending) return res.status(410).json({ error: 'SELECTION_EXPIRED', message: 'The sign-in has expired. Connect again.' });
    // Only an account from this sign-in's own list can be chosen.
    const choice = (pending.candidates as MetaCandidate[]).find((c) => c.accountId === accountId);
    if (!choice) return res.status(400).json({ error: 'NOT_A_CANDIDATE', message: 'Pick one of the listed accounts.' });
    try {
        await saveMetaConnection(
            workspaceId,
            platform,
            { ...choice, pageToken: choice.pageToken ? decrypt(choice.pageToken) : undefined },
            { userToken: decrypt(pending.userToken), expiresIn: Number(pending.expiresIn) || 5184000, metaUserId: pending.metaUserId || null }
        );
        await pendingRef(workspaceId, platform).delete();
        res.json({ success: true, platform, accountId });
    } catch (err: any) {
        console.error(`[Meta ${platform} select]`, err.message);
        res.status(500).json({ error: 'CONNECT_FAILED', message: 'The account could not be connected. Try again.' });
    }
});

router.delete('/:platform/candidates', withWorkspace, async (req: Request, res: Response) => {
    const platform = req.params.platform as MetaPlatform;
    const workspaceId = (req as any).workspaceId;
    if (!META_PICK_PLATFORMS.includes(platform) || !workspaceId) return res.status(404).json({ error: 'UNKNOWN_PLATFORM' });
    await pendingRef(workspaceId, platform).delete();
    res.json({ success: true });
});

// Subscribes the Instagram account's Page, or the Facebook Page, to webhooks again (the "Retry" on
// Connections when messages and comments aren't arriving).
router.post('/:platform/webhooks', withWorkspace, requireWorkspaceRole('owner', 'admin'), async (req: Request, res: Response) => {
    const platform = req.params.platform;
    const workspaceId = (req as any).workspaceId;
    if (platform !== 'instagram' && platform !== 'facebook') return res.status(404).json({ error: 'UNKNOWN_PLATFORM' });
    if (!workspaceId) return res.status(403).json({ error: 'NO_WORKSPACE' });
    try {
        const conn = await getConnectionDoc(workspaceId, platform);
        if (!conn) return res.status(404).json({ error: 'NOT_CONNECTED', message: 'Connect the account first.' });
        const encrypted = platform === 'instagram' ? conn.data.pageAccessToken : conn.data.accessToken;
        const pageId = String(conn.data.pageId || conn.data.accountId || '');
        if (!encrypted || !pageId) return res.status(409).json({ error: 'RECONNECT_REQUIRED', message: 'Reconnect the account to enable messages and comments.' });
        const webhookSubscription = await subscribePage(workspaceId, platform, pageId, decrypt(encrypted));
        await conn.ref.update({ webhookSubscription, updatedAt: FieldValue.serverTimestamp() });
        if (!webhookSubscription.ok) {
            return res.status(502).json({ error: 'SUBSCRIBE_FAILED', message: `Meta refused the webhook subscription: ${webhookSubscription.error}`, webhookSubscription });
        }
        res.json({ success: true, webhookSubscription });
    } catch (err: any) {
        console.error(`[Meta ${platform} webhooks]`, err.message);
        res.status(500).json({ error: 'SUBSCRIBE_FAILED', message: 'The subscription could not be renewed. Try again.' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//   TIKTOK CALLBACK
// ─────────────────────────────────────────────────────────────────────────────
router.get('/tiktok/callback', async (req: Request, res: Response) => {
    try {
        const { code, state } = req.query as Record<string, string>;
        const { workspaceId } = await verifyCallbackState(state, ['tiktok']);
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
        console.error('[TikTok callback]', safeOAuthError(err));
        res.redirect(`${env('CLIENT_URL') || 'http://localhost:5173'}/dashboard/connections?error=tiktok`);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//   GET /api/connections  — list all (metadata only, no raw tokens)
// ─────────────────────────────────────────────────────────────────────────────
// What each network can do here: connect, publish, or export-and-post-manually (separate from "connected").
router.get('/availability', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const snap = await db.collection('workspaces').doc(workspaceId).collection('connections').get();
    const byPlatform = new Map(snap.docs.map((d) => [d.id, d.data()]));
    const platforms = (Object.keys(OAUTH_CONFIG) as Platform[]).map((p) => {
        const cfg = OAUTH_CONFIG[p];
        const conn = byPlatform.get(p);
        return availabilityFor(p, { configured: !!(cfg.clientId() && cfg.clientSecret()), connection: conn ? { status: conn.status } : null });
    });
    res.json({ platforms: [...platforms, availabilityFor('linkedin', { configured: false }), availabilityFor('x', { configured: false })] });
});

router.get('/', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const snap = await db
        .collection('workspaces').doc(workspaceId)
        .collection('connections').get();

    const connections = snap.docs.map((d) => {
        // Strip encrypted tokens from the response
        const { accessToken, refreshToken, pageAccessToken, ...safe } = d.data();
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
//   DELETE /api/connections/:platform  — revoke with the platform, delete token and fetched data
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:platform', withWorkspace, requireWorkspaceRole('owner', 'admin'), async (req: Request, res: Response) => {
    const platform = String(req.params.platform);
    const workspaceId = (req as any).workspaceId;
    if (!workspaceId) return res.status(403).json({ error: 'NO_WORKSPACE' });
    if (!OAUTH_CONFIG[platform as Platform]) return res.status(404).json({ error: 'UNKNOWN_PLATFORM' });

    try {
        const result = await deleteConnection(workspaceId, platform, { revoke: true });
        if (!result.existed) return res.status(404).json({ error: 'NOT_CONNECTED' });
        res.json({ success: true, platform, revoked: result.revoked });
    } catch (err: any) {
        console.error(`[Disconnect ${platform}]`, err.message);
        res.status(500).json({ error: 'DISCONNECT_FAILED', message: 'The account could not be disconnected. Please try again.' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//   POST /api/connections/:platform/refresh  — manual token refresh
// ─────────────────────────────────────────────────────────────────────────────
//   GET /api/connections/tiktok/creator-info  — what TikTok allows this creator to post now
//   (TikTok's Direct Post rules: show the creator, only the privacy levels it returns, the
//   interaction settings it allows, the maximum video length, and block posting when it says so.)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/tiktok/creator-info', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    // Inbox mode (video.upload only): the creator finishes the post in the TikTok app, which sets
    // privacy and the other options; there is no Direct Post screen to fill in here.
    if (tiktokPostMode() === 'inbox') return res.json({ mode: 'inbox', canPost: true });
    try {
        const { accessToken } = await getValidAccessToken(workspaceId, 'tiktok');
        const { data } = await axios.post('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {}, {
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
            timeout: 15000,
        });
        const info = data?.data || {};
        res.json({
            mode: 'direct',
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
router.post('/:platform/refresh', withWorkspace, requireWorkspaceRole('owner', 'admin'), async (req: Request, res: Response) => {
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
    } else if (platform === 'instagram' || platform === 'meta_ads') {
        // A long-lived Meta user token is renewed by exchanging it for a new one
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
        expiredAt: FieldValue.delete(),
        tokenError: FieldValue.delete(),
        userTokenExpired: FieldValue.delete(),
        userTokenError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
    });

    return tokenExpiry;
}

// ─────────────────────────────────────────────────────────────────────────────
//   TOKEN AUTO-REFRESH CRON  (every 6 hours)
//   Scans all connections expiring within 24 hours
// ─────────────────────────────────────────────────────────────────────────────
const EXPIRED_RETENTION_MS = 6 * 86400 * 1000;

/** Whether an Instagram connection's Page token (what messaging and comment replies use) still works. */
async function pageTokenWorks(conn: FirebaseFirestore.DocumentData) {
    if (!conn.pageId || !conn.pageAccessToken) return false;
    try {
        await axios.get(graphUrl(String(conn.pageId)), { params: { fields: 'id', access_token: decrypt(conn.pageAccessToken) }, timeout: 15000 });
        return true;
    } catch {
        return false;
    }
}

/**
 * Renews tokens expiring within 24 hours, marks ones that can't be renewed as expired, and deletes
 * connections left expired for EXPIRED_RETENTION_MS. Each workspace has only a few connections, so
 * they are read whole and filtered here (no composite index needed); one workspace's failure
 * doesn't stop the others.
 */
export async function runTokenMaintenance() {
    const expiryThreshold = Date.now() + 86400 * 1000; // within 24 hours
    const workspacesSnap = await db.collection('workspaces').select('ownerId').get();
    for (const wsDoc of workspacesSnap.docs) {
        const workspaceId = wsDoc.id;
        const ownerId = wsDoc.data().ownerId;
        try {
            const all = (await db.collection('workspaces').doc(workspaceId).collection('connections').get()).docs;
            const expiring = all.filter((d) => d.data().status === 'active' && Number(d.data().tokenExpiry || 0) > 0 && Number(d.data().tokenExpiry) < expiryThreshold);

            for (const connDoc of expiring) {
                const platform = connDoc.id as Platform;
                if (!PLATFORMS.includes(platform)) continue;

                try {
                    await refreshPlatformToken(workspaceId, platform);
                    console.log(`[TokenRefreshCron] ✅ Refreshed ${platform} for workspace ${workspaceId}`);
                } catch (err: any) {
                    // Only the platform refusing the token (4xx, or TikTok's error body) means access is gone;
                    // network errors and outages are retried on the next run.
                    const httpStatus = Number(err.response?.status || 0);
                    const refused = (httpStatus >= 400 && httpStatus < 500) || /invalid_grant|invalid|revoked|expired/i.test(String(err.message));
                    console.error(`[TokenRefreshCron] ❌ Failed to refresh ${platform} for ${workspaceId}${refused ? '' : ' (will retry)'}:`, err.response?.data || err.message);
                    if (!refused) continue;

                    // Instagram: the user token could not be renewed, but messaging and comment replies use
                    // the Page token. While that still works, keep the connection active (Connections asks
                    // for a reconnect to keep publishing) instead of stopping the Inbox and automations.
                    if (platform === 'instagram' && (await pageTokenWorks(connDoc.data()))) {
                        await connDoc.ref.update({
                            userTokenExpired: true,
                            userTokenError: String(err.response?.data?.error?.message || err.message).slice(0, 300),
                            updatedAt: FieldValue.serverTimestamp(),
                        });
                        console.warn(`[TokenRefreshCron] Instagram user token for ${workspaceId} could not be renewed; the Page token still works, so messaging continues`);
                        continue;
                    }

                    // Mark as expired and notify user. If it isn't reconnected, the sweep below deletes it.
                    await connDoc.ref.update({
                        status: 'expired',
                        expiredAt: Date.now(),
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

            // Access refused for 6 days and not reconnected: delete the token and the account's data
            // (the Privacy Policy promises within 7 days; this job runs every 6 hours).
            for (const connDoc of all.filter((d) => d.data().status === 'expired')) {
                const expiredAt = Number(connDoc.data().expiredAt || 0);
                if (!expiredAt) {
                    await connDoc.ref.update({ expiredAt: Date.now() }); // marked expired before this rule existed
                } else if (expiredAt < Date.now() - EXPIRED_RETENTION_MS) {
                    await deleteConnection(workspaceId, connDoc.id, { revoke: false }).catch((err) =>
                        console.error(`[TokenRefreshCron] Could not delete expired ${connDoc.id} for ${workspaceId}:`, err.message)
                    );
                }
            }
        } catch (err: any) {
            console.error(`[TokenRefreshCron] Workspace ${workspaceId} failed:`, err.message);
        }
    }
}

export function startTokenRefreshCron() {
    cron.schedule('0 */6 * * *', async () => {
        console.log('[TokenRefreshCron] Scanning for expiring tokens…');
        await runTokenMaintenance().catch((err) => console.error('[TokenRefreshCron] Cron error:', err.message));
    });

    console.log('[TokenRefreshCron] Scheduled — runs every 6 hours');
}

export default router;
