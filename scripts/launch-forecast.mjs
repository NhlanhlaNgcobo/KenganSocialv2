#!/usr/bin/env node
/**
 * South African market size and launch forecast: launch on 30 November 2026, months December to
 * February, three scenarios. Costs per month come from scripts/capacity-model.mjs (worker fleet,
 * AI, voice, music, storage, Payfast, fixed costs) for that month's users.
 *
 *   node scripts/launch-forecast.mjs           # tables in the terminal
 *   node scripts/launch-forecast.mjs --json    # used by scripts/build-forecast-doc.mjs
 *
 * Every input below is an assumption with its source noted; change them as real numbers arrive.
 */
import { evaluate } from './capacity-model.mjs';
import { PLANS } from './pricing-model.mjs';

// ---------------------------------------------------------------------------------------------
// 1. Market (South Africa)
// ---------------------------------------------------------------------------------------------
export const MARKET = {
    socialUsers: 41_000_000, // Ornico / World Wide Worx 2026: almost 41 million active social media users
    smmes: 2_700_000, // SEDA / Absa SBGI 2025: ~2.7 million SMMEs
    formalShare: 1 / 3, // about a third operate formally
    smmesPostingShare: 0.6, // assumption: formal SMMEs that market on social media
    creators: 500_000, // theSalt: 500,000+ creators in one network (a floor for the total)
    seriousCreatorShare: 0.3, // assumption: post weekly and want to grow or earn
    agencies: 31_000, // CompanyData/InfobelPRO: 31,000-37,000 registered marketing/advertising firms
    socialAgencyShare: 0.35, // assumption: firms that run clients' social media
};

/** Addressable customers per segment and which plans they buy. */
export function marketSize(m = MARKET) {
    const smes = m.smmes * m.formalShare * m.smmesPostingShare;
    const creators = m.creators * m.seriousCreatorShare;
    const agencies = m.agencies * m.socialAgencyShare;
    // Realistic share a new local tool can win in 3 years (SOM) vs the serviceable market (SAM).
    return {
        segments: [
            { id: 'creators', name: 'Creators, podcasters, streamers', sam: creators, plans: 'Free, Creator Starter, Creator Pro', som3y: 0.02 },
            { id: 'smes', name: 'Small businesses that market on social', sam: smes, plans: 'Free, Creator Starter, Creator Pro', som3y: 0.01 },
            { id: 'agencies', name: 'Agencies and social media managers', sam: agencies, plans: 'Creator Pro, Agency, Enterprise', som3y: 0.04 },
        ],
        sam: smes + creators + agencies,
    };
}

// ---------------------------------------------------------------------------------------------
// 2. Launch scenarios (30 Nov 2026 → 28 Feb 2027)
// ---------------------------------------------------------------------------------------------
export const MONTHS = [
    // Festive shutdown: many businesses close mid-December to mid-January; creators keep posting.
    { id: '2026-12', name: 'December 2026', seasonality: 0.75 },
    { id: '2027-01', name: 'January 2027', seasonality: 0.85 },
    { id: '2027-02', name: 'February 2027', seasonality: 1.1 },
];

export const SCENARIOS = {
    conservative: {
        label: 'Conservative',
        story: 'Organic only: founders’ networks, posts, a few creator shout-outs. R10 000/month marketing.',
        baseSignups: 900, // sign-ups a month before seasonality, growing with word of mouth
        growth: 0.25,
        trialToPaid: 0.04, // no-card trial benchmark: 4-6% is good
        freeToPaid: 0.015, // monthly, of active free users
        marketing: 10_000,
        enterpriseDeals: [0, 0, 0],
    },
    base: {
        label: 'Base',
        story: 'Paid social ads, 5–10 local creator partnerships, launch PR. R35 000/month marketing.',
        baseSignups: 2_000,
        growth: 0.35,
        trialToPaid: 0.06,
        freeToPaid: 0.02,
        marketing: 35_000,
        enterpriseDeals: [0, 0, 1],
    },
    optimistic: {
        label: 'Optimistic',
        story: 'Strong ads, a viral creator moment, agency outreach. R90 000/month marketing.',
        baseSignups: 4_500,
        growth: 0.5,
        trialToPaid: 0.09,
        freeToPaid: 0.03,
        marketing: 90_000,
        enterpriseDeals: [0, 1, 2],
    },
};

/** How new paying customers split across self-serve plans (assumption). */
export const PAID_SPLIT = { creator_starter: 0.58, creator_pro: 0.32, agency: 0.1 };
export const CHURN = 0.06; // paid customers cancelling per month (SMB SaaS; assumption)
export const FREE_ACTIVE = 0.5; // share of free accounts still using the app in a month
export const USE = 0.35; // share of each allowance used (as in the capacity model's "typical")
/** Minimum provider subscriptions on top of usage (US$ converted at R17.50). */
export const PROVIDER_MINIMUMS = { 'ElevenLabs Pro plan': 99 * 17.5, 'Treblo credit plan (estimate)': 50 * 17.5, 'Error tracking and email': 40 * 17.5 };
/** One-off before launch (November). */
export const PRELAUNCH = { 'Launch video, brand and creator seeding': 15_000, 'Legal review of Terms and Privacy Policy': 8_000, 'Information Officer registration and admin': 1_000 };

const plan = (id) => PLANS.find((p) => p.id === id);
/** The trial before 24 October 2026: Agency video length (120 min) and speech model, for comparison. */
export const AGENCY_TRIAL = { ...PLANS.find((p) => p.id === 'trial'), maxSourceMin: 120, whisper: 'medium' };

export function simulate(key, { agencyTrial = false } = {}) {
    const s = SCENARIOS[key];
    const paid = { creator_starter: 0, creator_pro: 0, agency: 0, enterprise: 0 };
    let free = 0;
    let cumulative = -Object.values(PRELAUNCH).reduce((a, b) => a + b, 0);
    const months = [];
    MONTHS.forEach((m, i) => {
        const signups = Math.round(s.baseSignups * m.seasonality * (1 + s.growth) ** i);
        // Churn on last month's customers, then this month's conversions.
        for (const k of Object.keys(paid)) paid[k] *= i === 0 ? 1 : 1 - CHURN;
        const fromTrial = signups * s.trialToPaid;
        const fromFree = free * FREE_ACTIVE * s.freeToPaid;
        const newPaid = fromTrial + fromFree;
        for (const [k, share] of Object.entries(PAID_SPLIT)) paid[k] += newPaid * share;
        paid.enterprise = s.enterpriseDeals.slice(0, i + 1).reduce((a, b) => a + b, 0);
        free = free - fromFree + signups - fromTrial;

        const population = [
            { plan: plan('starter'), users: Math.round(free * FREE_ACTIVE) },
            { plan: agencyTrial ? AGENCY_TRIAL : plan('trial'), users: signups }, // a 7-day trial each, counted in its month
            ...Object.entries(paid).map(([id, n]) => ({ plan: plan(id), users: Math.round(n) })),
        ];
        const e = evaluate(population, USE);
        const minimums = Object.values(PROVIDER_MINIMUMS).reduce((a, b) => a + b, 0);
        const cost = e.cost + minimums + s.marketing;
        const profit = e.revenue.net - cost;
        cumulative += profit;
        const payingUsers = Object.values(paid).reduce((a, b) => a + b, 0);
        const mrr = Object.entries(paid).reduce((a, [id, n]) => a + Math.round(n) * plan(id).price, 0);
        // Single-queue check: load above 0.7 means users start waiting at the busiest hour today.
        const load = { renders: (e.lambdaPerHour.short * e.serviceSec.short) / 3600, clips: (e.lambdaPerHour.clips * e.serviceSec.clips) / 3600 };
        months.push({
            ...m,
            signups,
            newPaid: Math.round(newPaid),
            paid: Object.fromEntries(Object.entries(paid).map(([k, v]) => [k, Math.round(v)])),
            payingUsers: Math.round(payingUsers),
            freeAccounts: Math.round(free),
            totalAccounts: Math.round(free + payingUsers),
            mrr,
            revenue: e.revenue,
            providers: e.providers,
            servers: e.compute,
            fixed: e.fixed,
            minimums,
            marketing: s.marketing,
            cost,
            profit,
            cumulative,
            peakWorkers: e.pools.short.servers + e.pools.clips.servers,
            singleQueueLoad: load,
        });
    });
    const last = months.at(-1);
    return {
        key,
        ...s,
        months,
        totals: {
            signups: months.reduce((a, m) => a + m.signups, 0),
            revenue: months.reduce((a, m) => a + m.revenue.net, 0),
            cost: months.reduce((a, m) => a + m.cost, 0) + Object.values(PRELAUNCH).reduce((a, b) => a + b, 0),
            profit: cumulative,
            endPaying: last.payingUsers,
            endAccounts: last.totalAccounts,
            endMrr: last.mrr,
            runRateProfit: last.profit,
            breakEvenMonth: months.find((m) => m.profit > 0)?.name || 'after February',
            paybackMonth: months.find((m) => m.cumulative > 0)?.name || 'after February',
        },
    };
}

export function run() {
    const market = marketSize();
    const scenarios = Object.fromEntries(Object.keys(SCENARIOS).map((k) => [k, simulate(k)]));
    const agencyTrial = Object.fromEntries(Object.keys(SCENARIOS).map((k) => [k, simulate(k, { agencyTrial: true })]));
    return { agencyTrial, MARKET, market, MONTHS, SCENARIOS, PAID_SPLIT, CHURN, FREE_ACTIVE, USE, PROVIDER_MINIMUMS, PRELAUNCH, scenarios };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
    const r = run();
    if (process.argv.includes('--json')) {
        console.log(JSON.stringify(r, null, 2));
    } else {
        const R = (x) => `R${Math.round(x).toLocaleString('en-ZA')}`;
        const n = (x) => Math.round(x).toLocaleString('en-ZA');
        console.log(`Serviceable market (SAM): ${n(r.market.sam)} potential customers`);
        for (const seg of r.market.segments) console.log(`  ${seg.name.padEnd(40)} ${n(seg.sam).padStart(9)}  3-year share ${seg.som3y * 100}% = ${n(seg.sam * seg.som3y)}`);
        for (const sc of Object.values(r.scenarios)) {
            console.log(`\n== ${sc.label}: ${sc.story}`);
            for (const m of sc.months) {
                console.log(`${m.name.padEnd(14)} sign-ups ${n(m.signups).padStart(6)} | paying ${n(m.payingUsers).padStart(5)} (S ${m.paid.creator_starter} P ${m.paid.creator_pro} A ${m.paid.agency} E ${m.paid.enterprise}) | accounts ${n(m.totalAccounts).padStart(6)} | MRR ${R(m.mrr).padStart(10)} | revenue ${R(m.revenue.net).padStart(10)} | cost ${R(m.cost).padStart(9)} | profit ${R(m.profit).padStart(10)} | cumulative ${R(m.cumulative).padStart(10)} | queue load r ${m.singleQueueLoad.renders.toFixed(2)} c ${m.singleQueueLoad.clips.toFixed(2)}`);
            }
            const t = sc.totals;
            const lt = r.agencyTrial[sc.key];
            console.log(`  with the old 120-min trial clips: queue load Feb r ${lt.months.at(-1).singleQueueLoad.renders.toFixed(2)} c ${lt.months.at(-1).singleQueueLoad.clips.toFixed(2)} | 3-month profit ${R(lt.totals.profit)}`);
            console.log(`3 months: revenue ${R(t.revenue)} | cost ${R(t.cost)} | profit ${R(t.profit)} | end: ${n(t.endPaying)} paying, ${n(t.endAccounts)} accounts, MRR ${R(t.endMrr)} | first profitable month ${t.breakEvenMonth} | paid back ${t.paybackMonth}`);
        }
    }
}
