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

// -1 means unlimited (agency fair-use caps enforced separately via overage billing)
// All counters reset on the 1st of each billing month at 00:00 UTC
