#!/usr/bin/env node
/**
 * KenganSocial cost and pricing model.
 *
 *   node scripts/pricing-model.mjs            # tables in the terminal
 *   node scripts/pricing-model.mjs --json     # machine-readable (used for docs/pricing)
 *
 * Every plan must keep a gross margin of at least 60% when a customer uses 100% of every
 * allowance, on the annual (discounted) price, after VAT and payment fees. Costs are worst case:
 * the most expensive model in each fallback chain, maximum output tokens, the longest source
 * video a plan allows, and a 20% buffer on every third-party price. Edit the inputs below when a
 * provider changes its prices, then re-run.
 */

// ---------------------------------------------------------------------------------------------
// 1. Economic inputs
// ---------------------------------------------------------------------------------------------
export const ECON = {
    usdZar: 17.5, // R per US$ (spot ~16.4 in Sep 2026; Oct forecast high 17.33, buffered)
    vat: 0.15, // SA VAT: charged on imported digital services, and on our own prices if VAT-registered
    buffer: 0.2, // safety margin on every third-party unit price (sources disagree)
    payfastPct: 0.032, // card: 3.2% + R2.00, plus VAT on the fee
    payfastFixed: 2.0,
    targetMargin: 0.6,
    stressUsdZar: 20, // the margin must also hold at this exchange rate (headroom for a weaker rand)
    annualDiscount: 0.1,
    pricesIncludeVat: true, // treat list prices as VAT-inclusive (worst case: VAT-registered)
};

/** US$ provider price -> rand cost with exchange rate, VAT on imported services and buffer. */
const usd = (dollars) => dollars * ECON.usdZar * (1 + ECON.vat) * (1 + ECON.buffer);

// ---------------------------------------------------------------------------------------------
// 2. Provider prices (US$) — sources listed in docs/pricing/KenganSocial_Pricing_Model.pdf
// ---------------------------------------------------------------------------------------------
export const PROVIDER = {
    haikuIn: 1 / 1e6, // Claude Haiku 4.5 via OpenRouter, per input token
    haikuOut: 5 / 1e6, // per output token
    opusIn: 5 / 1e6, // Claude Opus (lyrics structuring), per input token
    opusOut: 25 / 1e6,
    fastImage: 0.0672, // Gemini Flash Image (Nano Banana 2) via OpenRouter, 1024px
    bestImage: 0.08, // GPT Image medium at up to 1536x864 / 1024x1280
    elevenPerChar: 0.1 / 1000, // ElevenLabs Multilingual v2
    trebloTrack: 0.1, // Treblo instrumental per 30 s step (credit plan; estimate)
    sonarQuery: 0.007, // Perplexity Sonar: $5 / 1k requests + tokens
    whisperApiMin: 0.006, // OpenAI whisper-1 per minute (lyrics only)
    remotionRender: 0.01, // Remotion Automators licence, per render ($100/month minimum)
};

// ---------------------------------------------------------------------------------------------
// 3. Compute: one e2-standard-4 VM (4 vCPU, 16 GB) in africa-south1, priced per VM-second
// ---------------------------------------------------------------------------------------------
export const COMPUTE = {
    vmUsdMonth: 128 + 12, // on-demand e2-standard-4 (~$128) + 100 GB pd-balanced (~$12)
    utilisation: 0.5, // capacity is bought for peaks: only half of every VM-second is useful
    // VM-seconds of work per second of media (measured on this project / docs, rounded up)
    whisper: { base: 0.1, small: 0.3, medium: 0.9 }, // faster-whisper int8 on CPU
    analysis: 0.05, // scene detection, audio energy, face windows per source second
    clipRender: 1.5, // FFmpeg libx264 1080x1920 + face tracking per output second
    export: 1.5, // editor export per output second
    remotion: 9, // Remotion/Chrome render per output second (20 s template: 1-3 min)
    capture: 60, // Chrome website capture for a launch/tutorial video (VM-seconds)
    thumbnailScan: 15, // frame scoring for the thumbnail studio (VM-seconds)
};
const SECONDS_PER_MONTH = 30 * 24 * 3600;
/** Rand cost of one useful VM-second (machine priced in US$, no import VAT on GCP-ZA billing). */
export const VM_SECOND = (COMPUTE.vmUsdMonth * ECON.usdZar) / (SECONDS_PER_MONTH * COMPUTE.utilisation);
const vm = (seconds) => seconds * VM_SECOND;

// ---------------------------------------------------------------------------------------------
// 4. Metered units and what one unit can cost at most
// ---------------------------------------------------------------------------------------------
/** One AI credit buys up to US$0.015 of model usage (a Haiku call with 4k in + 1.5k out = $0.0115). */
export const CREDIT_USD = 0.015;
export const CREDIT_COST = usd(CREDIT_USD);

/** Credits per action: each is priced so the action's worst-case provider cost fits its credits. */
export const CREDIT_PRICES = {
    text: 1, // captions (per platform), hooks, hashtags, AI writer, repurpose text, brand voice, DM draft
    headlines: 1, // thumbnail headline ideas
    trendingRefresh: 2, // Perplexity Sonar search + one LLM call (manual refresh only; cached reads free)
    websiteSetup: 5, // brand setup from a website: 2-3 calls with screenshots, 8k max output
    styleLearn: 5, // AI Edit learning a style: 3 keyframes, 8k max output
    fastImage: Math.ceil(PROVIDER.fastImage / CREDIT_USD), // 5
    bestImage: Math.ceil(PROVIDER.bestImage / CREDIT_USD), // 6
    lyrics: Math.ceil((PROVIDER.whisperApiMin * 6 + 3000 * PROVIDER.opusIn + 8000 * PROVIDER.opusOut) / CREDIT_USD), // 6-min song
};

/** Worst-case rand cost of each unit a plan allowance is counted in. */
export function unitCosts() {
    const chunkCost = 8500 * PROVIDER.haikuIn + 8000 * PROVIDER.haikuOut; // one 30k-char transcript chunk
    // An AI clip project (counted once, plus transcription minutes separately): up to 10 clips of 60 s.
    const clipProject = (sourceMin) => {
        const chunks = Math.max(1, Math.ceil(sourceMin / 20)); // ~22 min of speech per chunk, overlapping
        return vm(sourceMin * 60 * COMPUTE.analysis) + usd(chunks * chunkCost) + vm(10 * 60 * COMPUTE.clipRender);
    };
    return {
        aiCredit: CREDIT_COST,
        post: usd(0.05 * 0.12) + vm(2), // platforms download ~50 MB once (egress $0.12/GB)
        exportUnit: vm(300 * COMPUTE.export), // 1 export unit = up to 5 minutes of exported video
        // 1 render unit = one launch/tutorial video or video ad (<= 30 s), or 5 min of AI-edited video
        renderUnit: Math.max(
            vm(30 * COMPUTE.remotion + COMPUTE.capture) + usd(8000 * PROVIDER.haikuOut + 8000 * PROVIDER.haikuIn + PROVIDER.trebloTrack + PROVIDER.remotionRender), // launch video
            vm(25 * COMPUTE.remotion) + usd(60 * 6 * PROVIDER.elevenPerChar + PROVIDER.trebloTrack + PROVIDER.remotionRender), // 25 s video ad
            vm(300 * COMPUTE.clipRender) + usd(8000 * PROVIDER.haikuOut + 6000 * PROVIDER.haikuIn), // 5 min of AI edit
        ),
        transcriptionMinute: { base: vm(60 * COMPUTE.whisper.base), small: vm(60 * COMPUTE.whisper.small), medium: vm(60 * COMPUTE.whisper.medium) },
        clipProject,
        storageGb: usd(0.026 + 0.12) / (1 + ECON.vat), // GB-month stored + downloaded once (GCP billed in ZA)
        thumbnailScan: vm(COMPUTE.thumbnailScan),
    };
}

// ---------------------------------------------------------------------------------------------
// 5. Plans: allowances per month (-1 = unlimited; costed at the fair-use cap)
// ---------------------------------------------------------------------------------------------
export const FAIR_USE = { posts: 1000, dmRules: 200 };
/** Fixed platform cost per workspace per month (Firestore reads/writes, token refresh, analytics sync). */
export const PER_WORKSPACE = { starter: 1, nano: 3, creator: 6, agency: 14 };
/** Shared monthly costs that don't grow per customer (R). */
export const FIXED_MONTHLY = {
    'Remotion licence minimum ($100, render fees count towards it)': 100 * ECON.usdZar * (1 + ECON.vat),
    'Backups, snapshots, domain, email, monitoring': 600,
};

export const PLANS = [
    { id: 'starter', tier: 'starter', name: 'Free', price: 0, whisper: null, maxSourceMin: 0, limits: { posts: 10, exports: 3, transcribeMinutes: 0, clipAnalysis: 0, aiCalls: 0, renders: 0, storageGB: 0.5 } },
    { id: 'creator_starter', tier: 'nano', name: 'Creator Starter', price: 299, whisper: 'base', maxSourceMin: 30, limits: { posts: 30, exports: 8, transcribeMinutes: 120, clipAnalysis: 3, aiCalls: 60, renders: 3, storageGB: 2 } },
    { id: 'creator_pro', tier: 'creator', name: 'Creator Pro', price: 699, whisper: 'small', maxSourceMin: 60, limits: { posts: 100, exports: 20, transcribeMinutes: 420, clipAnalysis: 7, aiCalls: 100, renders: 5, storageGB: 5 } },
    { id: 'agency', tier: 'agency', name: 'Agency', price: 3499, whisper: 'medium', maxSourceMin: 120, limits: { posts: 1000, exports: 80, transcribeMinutes: 1200, clipAnalysis: 15, aiCalls: 500, renders: 25, storageGB: 20 } },
    // Enterprise runs on the Agency tier in the app; custom extras are quoted from the unit costs.
    { id: 'enterprise', tier: 'agency', name: 'Enterprise', price: 8999, whisper: 'medium', maxSourceMin: 120, limits: { posts: 1000, exports: 80, transcribeMinutes: 1200, clipAnalysis: 15, aiCalls: 500, renders: 25, storageGB: 20 } },
    // The 7-day trial unlocks every Agency feature but with Creator Starter quantities.
    { id: 'trial', tier: 'agency', name: 'Trial (7 days)', price: 0, whisper: 'medium', maxSourceMin: 120, limits: { posts: 30, exports: 8, transcribeMinutes: 120, clipAnalysis: 3, aiCalls: 60, renders: 3, storageGB: 2 } },
];

// ---------------------------------------------------------------------------------------------
// 6. Margin
// ---------------------------------------------------------------------------------------------
export function costPlan(plan) {
    const u = unitCosts();
    const n = (v, cap) => (v === -1 ? cap : v);
    const L = plan.limits;
    const lines = {
        Posts: n(L.posts, FAIR_USE.posts) * u.post,
        Exports: L.exports * u.exportUnit,
        Transcription: plan.whisper ? L.transcribeMinutes * u.transcriptionMinute[plan.whisper] : 0,
        'AI clip projects': L.clipAnalysis * u.clipProject(plan.maxSourceMin),
        'AI credits': L.aiCalls * u.aiCredit,
        Renders: L.renders * u.renderUnit,
        Storage: L.storageGB * u.storageGb,
        'Platform (Firestore, sync)': PER_WORKSPACE[plan.tier] || 0,
    };
    const variable = Object.values(lines).reduce((a, b) => a + b, 0);
    const result = { id: plan.id, name: plan.name, lines, variable };
    for (const [label, price] of [['monthly', plan.price], ['annual', Math.round(plan.price * (1 - ECON.annualDiscount))]]) {
        if (!price) continue;
        const net = ECON.pricesIncludeVat ? price / (1 + ECON.vat) : price;
        const fee = (price * ECON.payfastPct + ECON.payfastFixed) * (1 + ECON.vat);
        const cost = variable + fee;
        result[label] = { price, net, fee, cost, margin: (net - cost) / net, minPrice: minimumPrice(variable) };
    }
    return result;
}

/** Lowest list price that still gives the target margin for a given variable cost. */
export function minimumPrice(variable) {
    // margin = (p/(1+vat) - variable - (p*pct + fixed)*(1+vat)) / (p/(1+vat)) >= target
    const v = ECON.pricesIncludeVat ? 1 + ECON.vat : 1;
    const a = (1 - ECON.targetMargin) / v - ECON.payfastPct * (1 + ECON.vat);
    return (variable + ECON.payfastFixed * (1 + ECON.vat)) / a;
}

export function fixedMonthly() {
    return Object.values(FIXED_MONTHLY).reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------------------------------------
// 7. Output
// ---------------------------------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
    const u = unitCosts();
    const plans = PLANS.map(costPlan);
    if (process.argv.includes('--json')) {
        console.log(JSON.stringify({ ECON, PROVIDER, COMPUTE, VM_SECOND, CREDIT_USD, CREDIT_PRICES, units: { ...u, clipProject: Object.fromEntries([30, 60, 120, 180].map((m) => [m, u.clipProject(m)])) }, PLANS, plans, fixed: FIXED_MONTHLY, fixedTotal: fixedMonthly() }, null, 2));
    } else {
        const r = (x) => `R${x.toFixed(2)}`;
        console.log(`VM-second R${VM_SECOND.toFixed(5)} | AI credit ${r(u.aiCredit)} | export unit ${r(u.exportUnit)} | render unit ${r(u.renderUnit)} | post ${r(u.post)} | storage ${r(u.storageGb)}/GB`);
        console.log(`transcription/min base ${r(u.transcriptionMinute.base)} small ${r(u.transcriptionMinute.small)} medium ${r(u.transcriptionMinute.medium)} | clip project 30/60/120/180 min: ${[30, 60, 120, 180].map((m) => r(u.clipProject(m))).join(' ')}`);
        console.log('credits per action', CREDIT_PRICES);
        for (const p of plans) {
            const m = p.monthly ? `monthly ${(p.monthly.margin * 100).toFixed(1)}% | annual ${(p.annual.margin * 100).toFixed(1)}% | min list price for 60%: ${r(p.monthly.minPrice)}` : 'free plan';
            console.log(`${p.name.padEnd(16)} full-use cost ${r(p.variable).padStart(10)} | ${m}`);
        }
        console.log(`fixed monthly ${r(fixedMonthly())}`);
    }
}
