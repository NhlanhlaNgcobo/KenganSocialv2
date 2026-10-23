/*
 * Limits are set so every paid plan keeps at least a 60% gross margin even when a customer uses
 * all of it, on the annual price, after VAT and Payfast fees (scripts/pricing-model.mjs and
 * docs/pricing/KenganSocial_Pricing_Model.pdf). Costs are counted by what they really use:
 *  aiCalls            AI credits; see CREDIT_COSTS for what each action costs
 *  transcribeMinutes  minutes of audio transcribed (rounded up per video), including clip projects
 *  clipAnalysis       long-video clip projects (source length capped by MAX_SOURCE_MINUTES)
 *  renders            a launch/tutorial video or video ad, or each started 5 minutes of AI-edited video
 *  exports            each started 5 minutes of video exported from the editor
 */
export const PLAN_LIMITS = {
    starter: {
        posts: 10, exports: 3, connections: 2,
        dms: 0, transcribeMinutes: 0, clipAnalysis: 0,
        aiCalls: 0, renders: 0, storageGB: 0.5
    },
    nano: {
        posts: 30, exports: 8, connections: 3,
        dms: 10, transcribeMinutes: 120, clipAnalysis: 3,
        aiCalls: 60, renders: 3, storageGB: 2
    },
    creator: {
        posts: 100, exports: 20, connections: 6,
        dms: 50, transcribeMinutes: 420, clipAnalysis: 7,
        aiCalls: 100, renders: 5, storageGB: 5
    },
    agency: {
        posts: 1000, exports: 80, connections: 25,
        dms: -1, transcribeMinutes: 1200, clipAnalysis: 15,
        aiCalls: 500, renders: 25, storageGB: 20
    }
}

/**
 * The 7-day trial unlocks every feature of the trial plan (Agency) but with these quantities, so a
 * sign-up costs at most about R100 (Creator Starter allowances). Applied by planGate.
 */
export const TRIAL_LIMITS = {
    posts: 30, exports: 8, connections: 3,
    dms: 10, transcribeMinutes: 120, clipAnalysis: 3,
    aiCalls: 60, renders: 3, storageGB: 2
}

/**
 * AI credits per action. One credit covers up to US$0.015 of model usage (a text call with 4k
 * tokens in and 1.5k out); costlier actions cost the credits their worst case needs.
 */
export const CREDIT_COSTS = {
    text: 1, // one generation: a caption per platform, hooks, hashtags, AI writer, repurpose, brand voice, DM draft
    headlines: 1, // thumbnail headline ideas
    trendingRefresh: 2, // a manual trending refresh (web search + one model call); cached reads are free
    websiteSetup: 5, // brand set-up from a website (2-3 calls with screenshots)
    styleLearn: 5, // AI Edit learning a style from a reference video
    fastImage: 5, // one AI image, fast quality
    bestImage: 6, // one AI image, best quality
    lyrics: 17, // lyric transcription and structuring for a song
} as const

/** Seconds of video one export or AI-edit render unit covers. */
export const VIDEO_UNIT_SECONDS = 300

/** Units for a video of `seconds`: each started 5 minutes counts once (at least 1). */
export function videoUnits(seconds: number): number {
    return Math.max(1, Math.ceil((Number(seconds) || 0) / VIDEO_UNIT_SECONDS))
}

/** Transcription minutes for audio of `seconds` (rounded up, at least 1). */
export function transcriptionMinutes(seconds: number): number {
    return Math.max(1, Math.ceil((Number(seconds) || 0) / 60))
}

/** Longest source video (minutes) a plan can turn into clips. Kept out of PLAN_LIMITS: it is not a monthly counter. */
export const MAX_SOURCE_MINUTES = { starter: 0, nano: 30, creator: 60, agency: 120 } as const

/** Client brands a workspace can manage in Clients & approvals (-1 = unlimited, 0 = not on this plan).
 *  Approvals are for Creator Pro, Agency and Enterprise (Enterprise uses the agency tier). */
export const MAX_CLIENTS = { starter: 0, nano: 0, creator: 5, agency: -1 } as const

/** Plans that include Clients & approvals. */
export const APPROVAL_PLANS = ['creator', 'agency'] as const

export type Plan = keyof typeof PLAN_LIMITS
export type PlanFeature = keyof typeof PLAN_LIMITS.starter

// Names shown for internal tiers that have no paid catalog entry (paid names come from billing PLAN_CATALOG).
export const PLAN_DISPLAY_NAMES: Record<Plan, string> = {
    starter: 'Free',
    nano: 'Creator Starter',
    creator: 'Creator Pro',
    agency: 'Agency'
}

// -1 means unlimited (only for features with no running cost, e.g. DM rule count)
// All counters reset on the 1st of each billing month at 00:00 UTC
