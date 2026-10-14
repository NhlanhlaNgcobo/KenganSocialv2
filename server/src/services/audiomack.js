import crypto from 'crypto';

/**
 * Audiomack Data API client (https://audiomack.com/data-api/docs).
 *
 * Requests are signed with OAuth 1.0a (HMAC-SHA1) using consumer credentials
 * issued by Audiomack. Search, track info and play URLs don't need a user
 * login; favorites, reposts, playlists and follows would, via the three-legged
 * flow (POST /request_token → audiomack.com/oauth/authenticate → POST /access_token).
 *
 * Usage policy: tracks are searched, previewed and streamed through Audiomack's
 * own short-lived play URLs as a guide track in the editor. Audio is never
 * downloaded, stored, or mixed into exported videos.
 */

const API_BASE = 'https://api.audiomack.com/v1';

export class AudiomackNotConfiguredError extends Error {
    constructor() {
        super('Audiomack is not connected. Set AUDIOMACK_CONSUMER_KEY and AUDIOMACK_CONSUMER_SECRET on the server.');
        this.status = 503;
    }
}

export const audiomackConfigured = () =>
    Boolean(process.env.AUDIOMACK_CONSUMER_KEY && process.env.AUDIOMACK_CONSUMER_SECRET);

/** RFC 3986 percent-encoding, as OAuth 1.0a requires (encodeURIComponent leaves !*'() alone). */
function percentEncode(value) {
    return encodeURIComponent(value).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** HMAC-SHA1 signature over the OAuth 1.0a base string (RFC 5849 §3.4). */
export function computeOAuthSignature(method, url, allParams, consumerSecret, tokenSecret = '') {
    const normalized = Object.entries(allParams)
        .map(([key, value]) => [percentEncode(key), percentEncode(value)])
        .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
        .map(([key, value]) => `${key}=${value}`)
        .join('&');

    const baseString = [method.toUpperCase(), percentEncode(url), percentEncode(normalized)].join('&');
    const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
    return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function authorizationHeader(method, url, params) {
    const consumerKey = process.env.AUDIOMACK_CONSUMER_KEY;
    const consumerSecret = process.env.AUDIOMACK_CONSUMER_SECRET;
    if (!consumerKey || !consumerSecret) throw new AudiomackNotConfiguredError();

    const oauthParams = {
        oauth_consumer_key: consumerKey,
        oauth_nonce: crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: String(Math.floor(Date.now() / 1000)),
        oauth_version: '1.0',
    };
    const signature = computeOAuthSignature(method, url, { ...params, ...oauthParams }, consumerSecret);

    return `OAuth ${Object.entries({ ...oauthParams, oauth_signature: signature })
        .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
        .join(', ')}`;
}

async function audiomackRequest(method, path, params = {}) {
    const url = `${API_BASE}${path}`;
    const body = new URLSearchParams(params).toString();

    const response = await fetch(method === 'GET' && body ? `${url}?${body}` : url, {
        method,
        headers: {
            Authorization: authorizationHeader(method, url, params),
            Accept: 'application/json',
            ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: method === 'POST' ? body : undefined,
    });

    if (!response.ok) {
        throw new Error(`Audiomack ${method} ${path} failed (${response.status}): ${await response.text()}`);
    }
    return response;
}

function toTrack(raw) {
    if (raw?.id === undefined || !raw.title) return null;
    const uploaderSlug = raw.uploader?.url_slug;
    const duration = Number(raw.duration);
    return {
        id: String(raw.id),
        title: String(raw.title),
        artist: String(raw.artist ?? raw.uploader?.name ?? 'Unknown artist'),
        artworkUrl: typeof raw.image === 'string' ? raw.image : null,
        genre: typeof raw.genre === 'string' && raw.genre ? raw.genre : null,
        durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
        permalink: uploaderSlug && raw.url_slug ? `https://audiomack.com/${uploaderSlug}/song/${raw.url_slug}` : null,
    };
}

/** GET /search?show=songs → documented as { results: [...], count }. */
export async function searchSongs(query, page = 1, limit = 20) {
    const response = await audiomackRequest('GET', '/search', {
        q: query,
        show: 'songs',
        page: String(page),
        limit: String(limit),
    });
    const payload = await response.json();
    const results = Array.isArray(payload) ? payload : payload.results ?? [];
    return results
        .filter((item) => !item.type || item.type === 'song')
        .map(toTrack)
        .filter(Boolean);
}

/**
 * POST /music/:id/play → a bare stream URL, valid for only ~10 seconds,
 * so the client requests one right before playback (and again on errors).
 */
export async function getPlayUrl(musicId, sessionId) {
    const response = await audiomackRequest('POST', `/music/${encodeURIComponent(musicId)}/play`, {
        session: sessionId,
        hq: 'true',
    });
    const text = (await response.text()).trim();
    const url = text.startsWith('"') ? JSON.parse(text) : text;
    if (!/^https:\/\//.test(url)) throw new Error('Audiomack returned an unexpected play response.');
    return url;
}
