import { apiClient } from '../lib/api'

// Keep in sync with server/src/utils/planLimits.ts (the server is the source of truth).
export const PLAN_LIMITS = {
    starter: {
        posts: 10, exports: 3, connections: 2,
        dms: 0, transcribeHrs: 0, clipAnalysis: 0,
        aiCalls: 0, renders: 0, storageGB: 0.5
    },
    nano: {
        posts: 30, exports: 10, connections: 3,
        dms: 10, transcribeHrs: 5, clipAnalysis: 0,
        aiCalls: 200, renders: 10, storageGB: 2
    },
    creator: {
        posts: 100, exports: 30, connections: 5,
        dms: 50, transcribeHrs: 20, clipAnalysis: 20,
        aiCalls: 1000, renders: 50, storageGB: 10
    },
    agency: {
        posts: -1, exports: -1, connections: -1,
        dms: -1, transcribeHrs: 50, clipAnalysis: 50,
        aiCalls: -1, renders: 500, storageGB: 50
    }
}

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
