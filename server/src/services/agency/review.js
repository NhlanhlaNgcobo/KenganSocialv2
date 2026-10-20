import crypto from 'crypto';

/**
 * Client review links: an unguessable token in the URL (/review/<token>) gives a client access to
 * the videos in one review, without an account. Only the token's SHA-256 hash is used to look the
 * link up (review_links/{hash}), so the lookup collection never holds a usable link.
 */

export const STATUSES = ['draft', 'in_review', 'changes_requested', 'approved'];
export const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube'];
export const EXPIRY_DAYS = [7, 14, 30, 90];

export function newToken() {
    return crypto.randomBytes(24).toString('base64url');
}

export function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export const isToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{32}$/.test(t);

const iso = (v) => (v?.toDate ? v.toDate().toISOString() : v || null);

export function clean(text, max) {
    return String(text ?? '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .trim()
        .slice(0, max);
}

/** An asset as the agency sees it in lists. */
export function assetSummary(id, a) {
    const current = (a.versions || []).find((v) => v.n === a.currentVersion) || (a.versions || [])[0] || null;
    return {
        id,
        clientId: a.clientId || null,
        title: a.title,
        status: a.status,
        caption: a.caption || '',
        platforms: a.platforms || [],
        dueDate: a.dueDate || null,
        currentVersion: a.currentVersion,
        versionCount: (a.versions || []).length,
        posterUrl: current?.posterUrl || null,
        url: current?.url || null,
        duration: current?.duration || 0,
        width: current?.width || 0,
        height: current?.height || 0,
        commentCount: a.commentCount || 0,
        openComments: a.openComments || 0,
        clientActivity: !!a.clientActivity,
        approval: a.approval || null,
        createdAt: iso(a.createdAt),
        updatedAt: iso(a.updatedAt),
    };
}

/** Versions without internal fields. */
export function publicVersions(a) {
    return (a.versions || [])
        .map((v) => ({ n: v.n, url: v.url, posterUrl: v.posterUrl || null, duration: v.duration || 0, width: v.width || 0, height: v.height || 0, note: v.note || '', uploadedAt: iso(v.uploadedAt) }))
        .sort((x, y) => y.n - x.n);
}

export function publicComment(id, c, { forClient = false } = {}) {
    return {
        id,
        text: c.text,
        timecode: typeof c.timecode === 'number' ? c.timecode : null,
        version: c.version || null,
        author: { kind: c.author?.kind || 'team', name: c.author?.name || (c.author?.kind === 'client' ? 'Client' : 'Team'), ...(forClient ? {} : { email: c.author?.email || null }) },
        resolved: !!c.resolved,
        createdAt: iso(c.createdAt),
    };
}
