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
        approval: publicApproval(a.approval, { forClient: false }),
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
        ...(forClient ? {} : { internal: !!c.internal }),
        text: c.text,
        timecode: typeof c.timecode === 'number' ? c.timecode : null,
        version: c.version || null,
        author: { kind: c.author?.kind || 'team', name: c.author?.name || (c.author?.kind === 'client' ? 'Client' : 'Team'), ...(forClient ? {} : { email: c.author?.email || null }) },
        resolved: !!c.resolved,
        createdAt: iso(c.createdAt),
    };
}

/** Comments the client may see: never the team's internal notes. */
export const visibleToClient = (c) => !c?.internal;

/**
 * The approval as it may leave the server. The audit fields (hashed IP, user agent) never do; the
 * reviewer's email only goes to the agency, never to the public review page.
 */
export function publicApproval(approval, { forClient = true } = {}) {
    if (!approval || !approval.status) return null;
    return {
        status: approval.status,
        version: approval.version ?? null,
        by: approval.by || 'Client',
        at: approval.at || null,
        note: approval.note || '',
        ...(forClient ? {} : { email: approval.email || null }),
    };
}

/** Keyed hash of the reviewer's IP for the audit trail, so the raw address is never stored. */
export function hashIp(ip, key = process.env.TOKEN_ENCRYPTION_KEY) {
    const value = String(ip || 'unknown');
    return key ? crypto.createHmac('sha256', key).update(value).digest('hex') : crypto.createHash('sha256').update(value).digest('hex');
}

/** Who left a comment or decision, kept server-side only (disputes: "who approved this, from where"). */
export function auditTrail(ip, userAgent, key) {
    return { ipHash: hashIp(ip, key), userAgent: clean(userAgent, 300) || null };
}

/** The activity log keeps the last 50 entries. */
export function appendActivity(list, entry) {
    return [...(Array.isArray(list) ? list : []).slice(-49), entry];
}

/**
 * Whether the client may record this decision. Returns null when allowed, or { status, message }.
 *  - it must be on the version the client was looking at (a newer upload means refresh first);
 *  - once approved, the link cannot undo it: the agency reopens it (new version or status change);
 *  - a change request can still be followed by an approval (or another change request).
 */
export function decisionConflict(asset, decision, viewedVersion) {
    const version = Number(viewedVersion);
    if (!Number.isInteger(version) || version < 1) return { status: 400, message: 'Refresh the page and try again.' };
    if (version !== asset.currentVersion) return { status: 409, message: 'A newer version was uploaded — refresh to review it.' };
    if (asset.status === 'draft') return { status: 409, message: 'The team has taken this video back to work on it. Refresh to see the latest.' };
    if (asset.status === 'approved' && asset.approval?.status === 'approved') {
        return { status: 409, message: decision === 'approved' ? 'This version is already approved.' : 'This version is already approved. Ask the team to reopen it if something needs to change.' };
    }
    return null;
}

/** Fields that change what gets posted; editing them after approval needs the client to look again. */
const CONTENT_DEFAULTS = { caption: '', platforms: [], clientId: null };
export const CONTENT_FIELDS = Object.keys(CONTENT_DEFAULTS);

/**
 * True when a team edit changes approved content. Title (an internal label) and the planned post
 * date only move the schedule, so they keep the approval; new media always arrives as a new version,
 * which resets approval on its own.
 */
export function editsApprovedContent(current, update) {
    const same = (f) => JSON.stringify(update[f] ?? CONTENT_DEFAULTS[f]) === JSON.stringify(current?.[f] ?? CONTENT_DEFAULTS[f]);
    return CONTENT_FIELDS.some((f) => update[f] !== undefined && !same(f));
}

const DECISION_TEXT = {
    approved: (who, title, v) => [`${who} approved ${title}`, `Version ${v} is approved and ready to schedule.`],
    changes_requested: (who, title, v, note) => [`${who} asked for changes on ${title}`, note ? `On version ${v}: ${note}` : `On version ${v}.`],
    comment: (who, title, v, note) => [`${who} commented on ${title}`, note ? `Version ${v}: ${note}` : `On version ${v}.`],
};

/** The in-app notification the agency gets when a client acts on a review link. */
export function reviewNotification({ workspaceId, kind, assetId, assetTitle, clientId, by, version, text }) {
    const [title, message] = (DECISION_TEXT[kind] || DECISION_TEXT.comment)(clean(by, 60) || 'Your client', `“${clean(assetTitle, 80) || 'a video'}”`, version, clean(text, 160));
    return {
        workspaceId,
        title,
        message,
        type: kind === 'approved' ? 'success' : kind === 'changes_requested' ? 'warning' : 'info',
        source: 'review',
        kind,
        assetId,
        clientId: clientId || null,
        link: `/dashboard/clients?asset=${encodeURIComponent(assetId)}`,
        read: false,
    };
}

/** What happens to a review link when one of its videos is deleted: drop it, or revoke an emptied link. */
export function reviewAfterDelete(assetIds, deletedId) {
    const remaining = (assetIds || []).filter((id) => id !== deletedId);
    return { remaining, revoke: remaining.length === 0 };
}
