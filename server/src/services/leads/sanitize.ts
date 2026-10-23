/**
 * Validation for leads a person adds or imports (routes/leads.ts). Only whitelisted fields of the
 * expected types and lengths are kept, so a client can't store arbitrary data, set the score or tier
 * itself, or fake an externalId (which would make the lead messageable from the Inbox).
 */

export const LEAD_STATUSES = ['prospect', 'contacted', 'negotiating', 'closed', 'lost'];
export const LEAD_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube', 'email', 'whatsapp', 'other'];
export const MAX_IMPORT_ROWS = 500;

// Control characters (except tab and newline) are dropped from text fields.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const text = (value: unknown, max: number) => (typeof value === 'string' || typeof value === 'number' ? String(value).replace(CONTROL, '').trim().slice(0, max) : '');

function tagsOf(value: unknown, fallback: string[]) {
    if (!Array.isArray(value)) return fallback;
    const tags = [...new Set(value.filter((t): t is string => typeof t === 'string').map((t) => text(t, 40)).filter(Boolean))].slice(0, 20);
    return tags.length ? tags : fallback;
}

/** Validates a manually added or imported lead. Returns { value } or { error }. */
export function sanitizeNewLead(body: any, defaults: { tags?: string[] } = {}): { value?: Record<string, unknown>; error?: string } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'A lead must be an object.' };
    const username = text(body.username, 100).replace(/^@+/, '');
    if (!username) return { error: "Add the lead's username." };
    const platform = text(body.platform || 'instagram', 20).toLowerCase();
    if (!LEAD_PLATFORMS.includes(platform)) return { error: 'Pick a supported platform.' };
    const followers = Number(body.followersCount ?? 0);
    if (!Number.isFinite(followers) || followers < 0 || followers > 1e10) return { error: 'Followers must be a positive number.' };
    const status = LEAD_STATUSES.includes(body.status) ? body.status : 'prospect';
    return {
        value: {
            username,
            platform,
            displayName: text(body.displayName, 120) || username,
            followersCount: Math.floor(followers),
            notes: text(body.notes, 5000),
            status,
            tags: tagsOf(body.tags, defaults.tags || ['manual']),
            industryMatch: body.industryMatch === true,
            hasPreviousCollab: body.hasPreviousCollab === true,
            signals: { totalLikes: 0, totalComments: 0, dmOpened: false, dmReplied: false, linkClicked: false, bookingMade: false, storyReply: false },
        },
    };
}

/** Validates an import: up to MAX_IMPORT_ROWS rows; invalid rows are skipped and reported by position. */
export function sanitizeImport(rows: unknown): { leads: Record<string, unknown>[]; skipped: { row: number; error: string }[]; error?: string } {
    if (!Array.isArray(rows)) return { leads: [], skipped: [], error: 'Send the leads as a list.' };
    if (rows.length > MAX_IMPORT_ROWS) return { leads: [], skipped: [], error: `Import at most ${MAX_IMPORT_ROWS} leads at a time.` };
    const leads: Record<string, unknown>[] = [];
    const skipped: { row: number; error: string }[] = [];
    rows.forEach((row, i) => {
        const result = sanitizeNewLead(row, { tags: ['import'] });
        if (result.value) leads.push(result.value);
        else skipped.push({ row: i + 1, error: result.error || 'Invalid lead.' });
    });
    return { leads, skipped };
}

const SIGNAL_KEYS = ['totalLikes', 'totalComments', 'dmOpened', 'dmReplied', 'linkClicked', 'bookingMade', 'storyReply'];

/** Validates a lead edit (PATCH): only known fields, each with its expected type and length. */
export function sanitizeLeadUpdate(body: any): { value?: Record<string, unknown>; error?: string } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Send the fields to change.' };
    const value: Record<string, unknown> = {};
    if (body.status !== undefined) {
        if (!LEAD_STATUSES.includes(body.status)) return { error: 'Invalid lead status' };
        value.status = body.status;
    }
    if (body.notes !== undefined) value.notes = text(body.notes, 5000);
    if (body.displayName !== undefined) value.displayName = text(body.displayName, 120);
    if (body.username !== undefined) {
        const username = text(body.username, 100).replace(/^@+/, '');
        if (!username) return { error: "The lead's username can't be empty." };
        value.username = username;
    }
    if (body.platform !== undefined) {
        const platform = text(body.platform, 20).toLowerCase();
        if (!LEAD_PLATFORMS.includes(platform)) return { error: 'Pick a supported platform.' };
        value.platform = platform;
    }
    if (body.followersCount !== undefined) {
        const followers = Number(body.followersCount);
        if (!Number.isFinite(followers) || followers < 0 || followers > 1e10) return { error: 'Followers must be a positive number.' };
        value.followersCount = Math.floor(followers);
    }
    if (body.tags !== undefined) value.tags = tagsOf(body.tags, []);
    if (body.industryMatch !== undefined) value.industryMatch = body.industryMatch === true;
    if (body.hasPreviousCollab !== undefined) value.hasPreviousCollab = body.hasPreviousCollab === true;
    if (body.signals !== undefined) {
        if (!body.signals || typeof body.signals !== 'object' || Array.isArray(body.signals)) return { error: 'Invalid engagement signals.' };
        const signals: Record<string, number | boolean> = {};
        for (const key of SIGNAL_KEYS) {
            const v = body.signals[key];
            if (v === undefined) continue;
            if (key.startsWith('total')) {
                const n = Number(v);
                if (!Number.isFinite(n) || n < 0 || n > 1e9) return { error: `${key} must be a positive number.` };
                signals[key] = Math.floor(n);
            } else signals[key] = v === true;
        }
        value.signals = signals;
    }
    return { value };
}

/** A CSV cell that spreadsheets show as text: quotes escaped, and formula starters (= + - @ tab CR) neutralised. */
export function csvCell(raw: unknown): string {
    let cell = raw === undefined || raw === null ? '' : String(raw);
    if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
    return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
