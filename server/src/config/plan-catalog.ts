/**
 * Plan prices and the public catalog shown on Pricing and Billing. No server dependencies, so
 * scripts/build-plan-catalog.mjs can write the copy the web app shows when the API can't be reached
 * (client/src/content/plan-catalog.json).
 */
import { MAX_CLIENTS, MAX_SOURCE_MINUTES, PLAN_LIMITS, PLAN_DISPLAY_NAMES, Plan } from '../utils/planLimits';

export const BILLING_EMAIL = 'billing@kengansocial.co.za';

// Annual billing charges 12 months at this fraction of the monthly price (0.9 = 10% off; deeper
// discounts push the full-use margin below 50%).
export const ANNUAL_DISCOUNT = 0.9;
export const ANNUAL_DISCOUNT_PERCENT = Math.round((1 - ANNUAL_DISCOUNT) * 100);

export type CatalogEntry = {
    label: string;
    amountZar: number;
    /** Internal tier (key of PLAN_LIMITS) the workspace gets once this plan is paid for. */
    tier: Plan;
    description: string;
    /** Sold through a conversation, not self-serve checkout. */
    contactOnly?: boolean;
    popular?: boolean;
    /** Extra lines shown after the limits-derived features. Only list what the product actually does. */
    extras?: string[];
};

// Single source of truth for paid plan prices (ZAR, monthly).
export const PLAN_CATALOG: Record<string, CatalogEntry> = {
    creator_starter: {
        label: 'Creator Starter',
        amountZar: 299,
        tier: 'nano',
        description: 'For creators posting regularly who want AI help and a taste of AI clips.',
    },
    creator_pro: {
        label: 'Creator Pro',
        amountZar: 699,
        tier: 'creator',
        description: 'For full-time creators running several channels.',
        popular: true,
    },
    agency: {
        label: 'Agency',
        amountZar: 3499,
        tier: 'agency',
        description: 'For teams and agencies managing several client brands.',
        extras: ['Leads board'],
    },
    enterprise: {
        label: 'Enterprise',
        amountZar: 8999,
        tier: 'agency',
        description: 'For larger organisations with custom needs.',
        contactOnly: true,
        extras: ['Everything in Agency', 'Limits agreed with you'],
    },
};

function formatCount(n: number) {
    return n.toLocaleString('en-ZA');
}

/** Headline features derived from PLAN_LIMITS so prices and limits never drift apart. */
function featuresForTier(tier: Plan): string[] {
    const l = PLAN_LIMITS[tier];
    const line = (value: number, unit: string, unlimited: string) =>
        value === -1 ? unlimited : value > 0 ? `${formatCount(value)} ${unit}` : null;

    return [
        line(l.posts, 'scheduled posts / month', 'Unlimited scheduled posts'),
        line(l.exports, 'video exports / month', 'Unlimited video exports'),
        line(l.connections, 'connected accounts', 'Unlimited connected accounts'),
        line(l.aiCalls, 'AI credits / month', 'Unlimited AI credits'),
        line(l.renders, 'video renders / month', 'Unlimited video renders'),
        l.clipAnalysis > 0 ? `${formatCount(l.clipAnalysis)} AI clip projects / month (videos up to ${MAX_SOURCE_MINUTES[tier]} min)` : null,
        l.transcribeMinutes > 0 ? `${formatCount(l.transcribeMinutes / 60)} hrs transcription / month` : null,
        MAX_CLIENTS[tier] === -1 ? 'Client approvals, unlimited clients' : MAX_CLIENTS[tier] > 0 ? `Client approvals for up to ${MAX_CLIENTS[tier]} clients` : null,
        `${l.storageGB} GB storage`,
    ].filter(Boolean) as string[];
}

export function publicCatalog({ paymentsConfigured, supportUrl }: { paymentsConfigured: boolean; supportUrl: string }) {
    const free = {
        id: 'starter',
        name: PLAN_DISPLAY_NAMES.starter,
        tier: 'starter' as Plan,
        monthlyPriceZar: 0,
        annualMonthlyPriceZar: 0,
        description: 'Try KenganSocial with no card needed.',
        features: featuresForTier('starter'),
        limits: PLAN_LIMITS.starter,
        purchasable: false,
        contactOnly: false,
        popular: false,
    };

    const paid = Object.entries(PLAN_CATALOG).map(([id, p]) => ({
        id,
        name: p.label,
        tier: p.tier,
        monthlyPriceZar: p.amountZar,
        annualMonthlyPriceZar: Math.round(p.amountZar * ANNUAL_DISCOUNT),
        description: p.description,
        features: [...(p.contactOnly ? [] : featuresForTier(p.tier)), ...(p.extras || [])],
        limits: PLAN_LIMITS[p.tier],
        purchasable: !p.contactOnly,
        contactOnly: Boolean(p.contactOnly),
        popular: Boolean(p.popular),
    }));

    return {
        currency: 'ZAR',
        annualDiscountPercent: ANNUAL_DISCOUNT_PERCENT,
        paymentsConfigured,
        supportEmail: BILLING_EMAIL,
        supportUrl,
        plans: [free, ...paid],
    };
}
