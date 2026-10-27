export const betaEnabled = () => /^(on|true|1)$/i.test(process.env.BETA_ACCESS || '');

// Platforms testers may connect and publish to during the beta (BETA_PLATFORMS=tiktok,youtube).
// Others stay locked until their app review or setup is done.
const BETA_PLATFORM_IDS = ['tiktok', 'youtube'];
export const betaPlatforms = () =>
    String(process.env.BETA_PLATFORMS || '').split(',').map((p) => p.trim().toLowerCase()).filter((p) => BETA_PLATFORM_IDS.includes(p));

/** True when publishing to every one of `platforms` is allowed (always, outside the beta). */
export const betaPublishAllowed = (platforms) => {
    if (!betaEnabled()) return true;
    const open = betaPlatforms();
    return Array.isArray(platforms) && platforms.length > 0 && platforms.every((p) => open.includes(String(p).toLowerCase()));
};

// Integrations that are not configured for the five-person pilot. Connections opens when at least
// one beta platform is enabled (only those platforms can be connected there).
const LOCKED_PAGES = [
    '/dashboard/connections', '/dashboard/dm', '/dashboard/automation',
    '/dashboard/leads', '/dashboard/ads', '/dashboard/analytics',
];
export const betaLockedPages = () => (betaPlatforms().length ? LOCKED_PAGES.filter((p) => p !== '/dashboard/connections') : LOCKED_PAGES);
export const BETA_LOCK_MESSAGE = 'Locked in beta. You can edit videos, share approval links and plan calendar drafts. Automatic publishing and connected-platform tools are not enabled yet.';
export const betaPlatformMessage = () => {
    const open = betaPlatforms().map((p) => (p === 'tiktok' ? 'TikTok' : 'YouTube'));
    return open.length ? `Locked in beta. Publishing works for ${open.join(' and ')} only for now.` : BETA_LOCK_MESSAGE;
};

/** OAuth callback for an open beta platform: the browser arrives from the platform without our sign-in token. */
export const isBetaOAuthCallback = (path) => {
    const m = /^\/connections\/([a-z_]+)\/callback$/.exec(path);
    return !!m && betaEnabled() && betaPlatforms().includes(m[1]);
};

export function betaFeatureLock(req, res, next) {
    if (!betaEnabled()) return next();
    const path = req.path;
    // /connections (list) and /connections/<open platform>/... stay open; other platforms are locked.
    const conn = /^\/connections(?:\/([a-z_]+))?(\/|$)/.exec(path);
    const lockedConnection = !!conn && (conn[1] ? !betaPlatforms().includes(conn[1]) : !betaPlatforms().length);
    const integration = lockedConnection
        || /^\/(dm|automation|leads|ads|analytics|webhooks|scheduler)(\/|$)/.test(path)
        || /^\/workspaces\/[^/]+\/(connections|automations|leads|analytics)(\/|$)/.test(path);
    const payments = /^\/billing\//.test(path) && !['GET', 'HEAD'].includes(req.method);
    // Publishing a stored post (publish-now, PATCH to pending) is checked in routes/schedule.ts,
    // where the post's platforms are known; the queue checks again before anything is sent.
    const publish = path === '/schedule/create' && req.method === 'POST' && req.body?.status !== 'draft' && !betaPublishAllowed(req.body?.platforms);
    if (integration || payments || publish) return res.status(403).json({ error: 'BETA_FEATURE_LOCKED', message: publish ? betaPlatformMessage() : BETA_LOCK_MESSAGE });
    next();
}
