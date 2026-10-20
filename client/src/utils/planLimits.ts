import { apiClient } from '../lib/api'

// Keep in sync with server/src/utils/planLimits.ts (the server is the source of truth).
/*
 * Limits are set so every paid plan keeps at least a 50% gross margin even when a customer uses
 * all of it (see docs/KenganSocial_Launch_Plan_and_Costs.docx, "Pricing"). Costly features have
 * hard caps; only near-free ones (posts, DMs) are unlimited.
 *  aiCalls        AI credits: 1 per text generation; AI images cost 2 (fast) or 6 (best) each
 *  transcribeHrs  hours of audio transcribed (rounded up per video), including clip projects
 *  clipAnalysis   long-video clip projects
 *  renders        launch/tutorial videos and AI video processing
 */
export const PLAN_LIMITS = {
    starter: {
        posts: 10, exports: 3, connections: 2,
        dms: 0, transcribeHrs: 0, clipAnalysis: 0,
        aiCalls: 0, renders: 0, storageGB: 0.5
    },
    nano: {
        posts: 30, exports: 10, connections: 3,
        dms: 10, transcribeHrs: 3, clipAnalysis: 3,
        aiCalls: 100, renders: 6, storageGB: 2
    },
    creator: {
        posts: 100, exports: 30, connections: 6,
        dms: 50, transcribeHrs: 10, clipAnalysis: 12,
        aiCalls: 250, renders: 25, storageGB: 10
    },
    agency: {
        posts: -1, exports: 150, connections: 25,
        dms: -1, transcribeHrs: 40, clipAnalysis: 40,
        aiCalls: 1300, renders: 150, storageGB: 50
    }
}

/** Longest source video (minutes) a plan can turn into clips. Kept out of PLAN_LIMITS: it is not a monthly counter. */
export const MAX_SOURCE_MINUTES = { starter: 0, nano: 30, creator: 90, agency: 180 } as const

/** Client brands a workspace can manage in Clients & approvals (-1 = unlimited, 0 = not on this plan).
 *  Approvals are for Creator Pro, Agency and Enterprise (Enterprise uses the agency tier). */
export const MAX_CLIENTS = { starter: 0, nano: 0, creator: 5, agency: -1 } as const

/** Plans that include Clients & approvals. */
export const APPROVAL_PLANS = ['creator', 'agency'] as const

export type Plan = keyof typeof PLAN_LIMITS
export type PlanFeature = keyof typeof PLAN_LIMITS.starter

export const PLAN_DISPLAY_NAMES: Record<Plan, string> = {
    starter: 'Free',
    nano: 'Creator Starter',
    creator: 'Creator Pro',
    agency: 'Agency'
}

// Order of internal tiers, used to label Upgrade / Downgrade.
export const PLAN_RANK: Record<Plan, number> = { starter: 0, nano: 1, creator: 2, agency: 3 }

// One contact address for billing, cancellations and plan changes (matches the server's BILLING_EMAIL).
export const BILLING_EMAIL = 'billing@kengansocial.com'

// -1 means unlimited (agency fair-use caps enforced separately via overage billing)
// All counters reset on the 1st of each billing month at 00:00 UTC

export type CatalogPlan = {
    id: string
    name: string
    tier: Plan
    monthlyPriceZar: number
    annualMonthlyPriceZar: number
    description: string
    features: string[]
    limits: Record<PlanFeature, number>
    purchasable: boolean
    contactOnly: boolean
    popular: boolean
}

export type PlanCatalog = {
    currency: string
    annualDiscountPercent: number
    paymentsConfigured: boolean
    supportEmail: string
    supportUrl: string
    plans: CatalogPlan[]
}

/** Prices and plans come from the server (GET /api/billing/plans); the client never hardcodes them. */
export async function fetchPlanCatalog(): Promise<PlanCatalog> {
    return apiClient('/billing/plans')
}

export function formatZar(amount: number): string {
    return `R${Math.round(amount).toLocaleString('en-ZA')}`
}
