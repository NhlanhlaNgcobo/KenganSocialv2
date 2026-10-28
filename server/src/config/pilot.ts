/**
 * Invite-only private pilot (KenganSocial_OpenSource_MVP_Build_Brief.md §1, §5).
 *
 * PILOT_MODE=true turns on:
 *  - invite-only access: a one-time invite code (or the legacy config/pilot-access.json email
 *    list) is required, and at most PILOT_MAX_USERS accounts can redeem one
 *  - pilot quotas, applied on top of the plan/beta/trial caps (the lower one wins)
 *  - one workspace per user, so quotas can't be multiplied by creating more workspaces
 *
 * Unset or anything but "true": everything here is off and the app behaves as before.
 * Counters reset in UTC: daily at 00:00 UTC, monthly on the 1st (same as every other plan counter).
 * A workspace with `pilotLimits: { <feature>: n }` (server-only field, set by an admin) overrides
 * the pilot cap for that feature; `unlimited: true` removes caps as it always has.
 */
import type { PlanFeature } from '../utils/planLimits';

const num = (name: string, fallback: number) => {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const pilotMode = () => process.env.PILOT_MODE === 'true';

export function pilotConfig() {
    return {
        maxUsers: num('PILOT_MAX_USERS', 10),
        maxStorageMB: num('PILOT_MAX_STORAGE_MB', 700),
        maxUploadMB: num('PILOT_MAX_UPLOAD_MB', 1024),
        maxExportsPerMonth: num('PILOT_MAX_EXPORTS_PER_MONTH', 21),
        maxExportDurationS: num('PILOT_MAX_EXPORT_DURATION_S', 84),
        maxExportResolution: num('PILOT_MAX_EXPORT_RESOLUTION', 1080),
        maxAiTextPerDay: num('PILOT_MAX_AI_TEXT_PER_DAY', 14),
        maxTranscriptionMinutesMonth: num('PILOT_MAX_TRANSCRIPTION_MINUTES_MONTH', 14),
        maxScheduledPosts: num('PILOT_MAX_SCHEDULED_POSTS', 28),
        maxConnections: num('PILOT_MAX_CONNECTIONS', 4),
    };
}

/** Monthly pilot caps per plan feature (features not listed keep their plan/beta cap). */
export function pilotMonthlyCaps(): Partial<Record<PlanFeature, number>> {
    const c = pilotConfig();
    return {
        exports: c.maxExportsPerMonth,
        transcribeMinutes: c.maxTranscriptionMinutesMonth,
        posts: c.maxScheduledPosts,
        connections: c.maxConnections,
        storageGB: c.maxStorageMB / 1024,
        // The binding AI limit is the daily one; this stops a month of daily maxima being exceeded.
        aiCalls: c.maxAiTextPerDay * 31,
    };
}

/** Per-workspace admin overrides (`pilotLimits` on the workspace doc), noted by withWorkspace. */
const overrides = new Map<string, Partial<Record<PlanFeature | 'aiCallsDaily', number>>>();
export function notePilotOverrides(workspaceId: string, limits: unknown) {
    if (!workspaceId) return;
    if (limits && typeof limits === 'object') {
        const clean: Record<string, number> = {};
        for (const [k, v] of Object.entries(limits as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v) && v >= -1) clean[k] = v;
        overrides.set(workspaceId, clean);
    } else overrides.delete(workspaceId);
}

/** The pilot cap for a feature in a workspace (undefined: no pilot cap). -1 = unlimited. */
export function pilotCap(workspaceId: string, feature: PlanFeature | 'aiCallsDaily'): number | undefined {
    if (!pilotMode()) return undefined;
    const o = overrides.get(workspaceId)?.[feature];
    if (o !== undefined) return o;
    if (feature === 'aiCallsDaily') return pilotConfig().maxAiTextPerDay;
    return pilotMonthlyCaps()[feature];
}

/** Today's UTC date (YYYY-MM-DD) and the unix second the day ends, for daily counters. */
export function utcDay(now = new Date()) {
    const day = now.toISOString().slice(0, 10);
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) / 1000;
    return { day, end };
}
