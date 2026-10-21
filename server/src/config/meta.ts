/**
 * Meta Graph API version, shared by every Meta call. Meta retires each version about two years
 * after release (v19.0 ended 21 May 2026); v25.0 is supported until July 2028.
 * META_GRAPH_VERSION overrides it, e.g. to test a newer version.
 */
export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';

export const graphUrl = (path: string) => `https://graph.facebook.com/${META_GRAPH_VERSION}/${path.replace(/^\/+/, '')}`;

/** App secret used to verify Meta webhooks and signed requests. */
export const metaAppSecret = () => process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET || '';
