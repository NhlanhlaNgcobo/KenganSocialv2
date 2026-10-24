#!/usr/bin/env node
/**
 * KenganSocial capacity and profit model: 1,000 users on each plan, and a realistic mix.
 *
 *   node scripts/capacity-model.mjs           # tables in the terminal
 *   node scripts/capacity-model.mjs --json    # used by scripts/build-capacity-doc.mjs
 *
 * Unlike scripts/pricing-model.mjs (cost of one customer at 100% use, compute priced per
 * VM-second), this sizes the actual fleet: how many worker VMs keep render queues short at the
 * busiest hour, what that fleet costs per month, and the profit once revenue, VAT, payment fees,
 * provider costs and fixed costs are counted. Prices and plans come from pricing-model.mjs.
 *
 * Job times were measured on 23 October 2026 (Intel i5-12500H, 16 threads) and converted to an
 * e2-standard-4 worker (4 vCPU): VM time = max(laptop wall time, laptop core-seconds x 1.2 / 4).
 */
import { ECON, PROVIDER, COMPUTE, PLANS, PER_WORKSPACE, CREDIT_COST, FIXED_MONTHLY, unitCosts } from './pricing-model.mjs';

export const USERS = 1000;

/** What a realistic customer base looks like (assumption; change when real numbers arrive). */
export const MIX = { starter: 0.5, creator_starter: 0.25, creator_pro: 0.15, agency: 0.08, enterprise: 0.02 };

/** Share of every allowance customers use in a month. */
export const SCENARIOS = { typical: 0.35, full: 1.0 };

/** Measured on this project (see header). Laptop: wall seconds and CPU core-seconds. */
export const MEASURED = {
    productAd15: { wall: 53, cpu: 333 }, // warm process, 15 s vertical 3D ad, voiceover + effects
    productAd25: { wall: 93, cpu: 642 }, // warm process, 25 s landscape
    launch20: { wall: 386, cpu: 1424 }, // cold process (bundle + AI provider fallback), 20 s launch video
    clip8min: { wall: 225, cpu: 1303, sourceSec: 481 }, // 8-min source, small Whisper, 5 clips
    apiDashboardRps: 248, // one API process, dashboard mix, 50 concurrent users, p95 441 ms
    apiDashboardP95At100: 1203, // ms at 100 concurrent users
};
const vmSeconds = ({ wall, cpu }) => Math.max(wall, (cpu * 1.2) / 4);

/** Service time (seconds on one 4-vCPU worker) per job. */
export const SERVICE = {
    render: { typical: vmSeconds(MEASURED.productAd25), full: 30 * COMPUTE.remotion + COMPUTE.capture }, // ad/launch/tutorial or 5 min AI edit
    exportUnit: { typical: 60 * COMPUTE.export, full: 300 * COMPUTE.export }, // 1 min typical, 5 min worst
    // Clip project: calibrated against the 8-min measurement (model coefficients x 1.1).
    // cloudStt: transcription by a speech API instead of Whisper on the worker's CPU.
    clipProject: (sourceMin, whisper, clips = 5, clipSec = 25, cloudStt = false) =>
        1.1 * (sourceMin * 60 * (COMPUTE.analysis + (cloudStt ? 0 : COMPUTE.whisper[whisper])) + clips * clipSec * COMPUTE.clipRender),
};
export const CLIP_CALIBRATION = { measured: vmSeconds(MEASURED.clip8min), modelled: SERVICE.clipProject(481 / 60, 'small') };

/** Busiest hour: 22 working days x 10 hours, with a 2x burst. */
export const PEAK_SHARE = 2 / (22 * 10);
/** Waiting targets at the busiest hour. */
export const TARGETS = { short: { seconds: 60, probability: 0.05 }, clips: { seconds: 300, probability: 0.1 } };

/** Worker and base infrastructure (US$ per month). e2-standard-4 africa-south1 + 100 GB disk. */
export const INFRA = {
    vmUsd: 140,
    spotDiscount: 0.35, // spot price as a share of on-demand: an estimate, check in the GCP console
    workerUtilisation: 0.6, // autoscaled fleet: average busy share of a running worker
    apiVms: 1, // measured headroom: ~5x the 1,000-user peak
    webHostingUsd: 20, // Vercel Pro or similar
    redisUsd: 0, // runs on the API VM
};

const zar = (usd) => usd * ECON.usdZar; // GCP and hosting billed in US$ (no import VAT on GCP-ZA billing)
const usdToCost = (usd) => usd * ECON.usdZar * (1 + ECON.vat) * (1 + ECON.buffer); // imported provider services

/** Erlang C: smallest number of servers so P(wait > t) <= p. a = offered load (erlangs). */
export function serversFor(lambdaPerSec, serviceSec, { seconds, probability }) {
    if (lambdaPerSec <= 0) return { servers: 0, pWait: 0, meanWait: 0 };
    const a = lambdaPerSec * serviceSec;
    for (let c = Math.max(1, Math.ceil(a)); c < 100000; c++) {
        if (c <= a) continue;
        // Erlang C via the stable Erlang B recursion.
        let b = 1;
        for (let k = 1; k <= c; k++) b = (a * b) / (k + a * b);
        const C = b / (1 - (a / c) * (1 - b));
        const mu = 1 / serviceSec;
        const pLate = C * Math.exp(-(c * mu - lambdaPerSec) * seconds);
        if (pLate <= probability) return { servers: c, pWait: C, meanWait: C / (c * mu - lambdaPerSec), load: a };
    }
    return { servers: Infinity };
}

/** Monthly work for `users` customers of one plan at utilisation `u`. */
function workload(plan, users, u, cloudStt = false) {
    const L = plan.limits;
    const typical = u < 1;
    const sourceMin = typical ? plan.maxSourceMin / 2 : plan.maxSourceMin;
    const clipJob = plan.maxSourceMin ? SERVICE.clipProject(sourceMin, plan.whisper || 'base', typical ? 5 : 10, typical ? 25 : 60, cloudStt) : 0;
    const jobs = {
        clips: users * L.clipAnalysis * u,
        renders: users * L.renders * u,
        exports: users * L.exports * u,
    };
    const service = { clips: clipJob, renders: SERVICE.render[typical ? 'typical' : 'full'], exports: SERVICE.exportUnit[typical ? 'typical' : 'full'] };
    const vmSecondsMonth = jobs.clips * service.clips + jobs.renders * service.renders + jobs.exports * service.exports;
    return { jobs, service, vmSecondsMonth, sourceMin };
}

/** Provider (third-party) costs for one plan, in rand per month. */
function providerCosts(plan, users, u, sourceMin, cloudStt = false) {
    const L = plan.limits;
    const chunk = 8500 * PROVIDER.haikuIn + 8000 * PROVIDER.haikuOut;
    const renderProvider = Math.max(
        8000 * PROVIDER.haikuOut + 8000 * PROVIDER.haikuIn + PROVIDER.trebloTrack + PROVIDER.remotionRender,
        60 * 6 * PROVIDER.elevenPerChar + PROVIDER.trebloTrack + PROVIDER.remotionRender
    );
    const units = unitCosts();
    return {
        'AI credits': users * L.aiCalls * u * CREDIT_COST,
        'Clip AI (transcript ranking)': users * L.clipAnalysis * u * usdToCost(Math.max(1, Math.ceil(sourceMin / 20)) * chunk),
        'Voice, music, render licence': users * L.renders * u * usdToCost(renderProvider),
        'Post delivery (egress)': users * L.posts * u * usdToCost(0.05 * 0.12),
        'Storage (GB-month + download)': users * L.storageGB * u * units.storageGb,
        'Firestore and sync': users * (PER_WORKSPACE[plan.tier] || 0) * (u < 1 ? 0.6 : 1),
        ...(cloudStt ? { 'Cloud transcription': users * L.clipAnalysis * u * usdToCost(sourceMin * PROVIDER.whisperApiMin) } : {}),
    };
}

/** Revenue after VAT and Payfast fees, monthly billing. */
function revenue(plan, users) {
    if (!plan.price) return { gross: 0, net: 0, fees: 0 };
    const gross = users * plan.price;
    const net = ECON.pricesIncludeVat ? gross / (1 + ECON.vat) : gross;
    const fees = users * (plan.price * ECON.payfastPct + ECON.payfastFixed) * (1 + ECON.vat);
    return { gross, net, fees };
}

/** Fleet, costs and profit for a population: [{ plan, users }]. */
export function evaluate(population, u, { spot = false, cloudStt = false } = {}) {
    let lambda = { short: 0, clips: 0 };
    let weighted = { short: 0, clips: 0 };
    let vmSecondsMonth = 0;
    const providers = {};
    let rev = { gross: 0, net: 0, fees: 0 };
    const jobs = { clips: 0, renders: 0, exports: 0 };
    let storageGb = 0;
    for (const { plan, users } of population) {
        if (!users) continue;
        const w = workload(plan, users, u, cloudStt);
        vmSecondsMonth += w.vmSecondsMonth;
        for (const k of Object.keys(jobs)) jobs[k] += w.jobs[k];
        const peak = (n) => (n * PEAK_SHARE) / 3600; // arrivals per second at the busiest hour
        lambda.short += peak(w.jobs.renders) + peak(w.jobs.exports);
        weighted.short += peak(w.jobs.renders) * w.service.renders + peak(w.jobs.exports) * w.service.exports;
        lambda.clips += peak(w.jobs.clips);
        weighted.clips += peak(w.jobs.clips) * w.service.clips;
        for (const [k, v] of Object.entries(providerCosts(plan, users, u, w.sourceMin, cloudStt))) providers[k] = (providers[k] || 0) + v;
        const r = revenue(plan, users);
        rev = { gross: rev.gross + r.gross, net: rev.net + r.net, fees: rev.fees + r.fees };
        storageGb += users * plan.limits.storageGB * u;
    }
    const service = { short: lambda.short ? weighted.short / lambda.short : 0, clips: lambda.clips ? weighted.clips / lambda.clips : 0 };
    const pools = {
        short: serversFor(lambda.short, service.short, TARGETS.short),
        clips: serversFor(lambda.clips, service.clips, TARGETS.clips),
    };
    const peakWorkers = pools.short.servers + pools.clips.servers;
    // Autoscaled fleet: pay for busy time / utilisation, at least one worker per pool always on.
    const workerHours = Math.max(vmSecondsMonth / 3600 / INFRA.workerUtilisation, (pools.short.servers ? 1 : 0) * 720 + (pools.clips.servers ? 1 : 0) * 720);
    const vmHourUsd = INFRA.vmUsd / 720;
    const workerUsd = workerHours * vmHourUsd * (spot ? INFRA.spotDiscount : 1);
    const compute = {
        'Worker VMs (autoscaled)': zar(workerUsd),
        'API VM (with Redis, Caddy)': zar(INFRA.apiVms * INFRA.vmUsd),
        'Web hosting': zar(INFRA.webHostingUsd),
    };
    const fixed = { ...FIXED_MONTHLY };
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    const cost = sum(providers) + sum(compute) + sum(fixed) + rev.fees;
    const profit = rev.net - cost;
    return {
        jobs,
        storageTb: storageGb / 1024,
        lambdaPerHour: { short: lambda.short * 3600, clips: lambda.clips * 3600 },
        serviceSec: service,
        pools,
        peakWorkers,
        workerHours,
        alwaysOnWorkersUsd: zar(peakWorkers * INFRA.vmUsd),
        // Busy-time worker cost with no always-on minimum: the part that grows with customers.
        workerVariable: zar((vmSecondsMonth / 3600 / INFRA.workerUtilisation) * vmHourUsd * (spot ? INFRA.spotDiscount : 1)),
        // Time from submitting to the result at the busiest hour: processing + typical queue wait.
        timeToResult: { short: service.short + pools.short.meanWait, clips: service.clips + pools.clips.meanWait },
        revenue: rev,
        providers,
        compute,
        fixed,
        cost,
        profit,
        margin: rev.net ? profit / rev.net : null,
        apiLoad: { peakRps: Math.round((USERS * 0.2 * 1) / 5), capacityRps: MEASURED.apiDashboardRps * INFRA.apiVms },
        elevenChars: jobs.renders * 360,
        trebloTracks: jobs.renders,
    };
}

export function run() {
    const paidAndFree = PLANS.filter((p) => p.id !== 'trial');
    const perPlan = {};
    for (const plan of paidAndFree) {
        perPlan[plan.id] = { name: plan.name, price: plan.price };
        for (const [s, u] of Object.entries(SCENARIOS)) {
            perPlan[plan.id][s] = evaluate([{ plan, users: USERS }], u);
            perPlan[plan.id][`${s}CloudStt`] = evaluate([{ plan, users: USERS }], u, { cloudStt: true });
        }
    }
    const mixPop = paidAndFree.map((plan) => ({ plan, users: Math.round(USERS * (MIX[plan.id] || 0)) }));
    const mix = { population: mixPop.map(({ plan, users }) => ({ id: plan.id, name: plan.name, users, price: plan.price })) };
    for (const [s, u] of Object.entries(SCENARIOS)) {
        mix[s] = evaluate(mixPop, u);
        mix[`${s}Spot`] = evaluate(mixPop, u, { spot: true });
        mix[`${s}CloudStt`] = evaluate(mixPop, u, { cloudStt: true });
    }
    // Break-even: paying users (in the mix's paid proportions) needed to cover fixed + base infrastructure.
    const paid = mixPop.filter(({ plan }) => plan.price > 0);
    const paidShare = paid.reduce((a, p) => a + p.users, 0);
    const perPaidUser = evaluate(paid.map(({ plan, users }) => ({ plan, users: users / paidShare })), SCENARIOS.typical);
    const fixedBase = Object.values(FIXED_MONTHLY).reduce((a, b) => a + b, 0) + zar(INFRA.vmUsd * INFRA.apiVms + INFRA.webHostingUsd + INFRA.vmUsd * 2);
    const contribution = perPaidUser.revenue.net - perPaidUser.revenue.fees - Object.values(perPaidUser.providers).reduce((a, b) => a + b, 0) - perPaidUser.workerVariable;
    return { USERS, MIX, SCENARIOS, MEASURED, SERVICE: { render: SERVICE.render, exportUnit: SERVICE.exportUnit }, CLIP_CALIBRATION, PEAK_SHARE, TARGETS, INFRA, ECON, perPlan, mix, breakEven: { fixedBase, contributionPerPaidUser: contribution, paidUsers: Math.ceil(fixedBase / contribution) } };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
    const r = run();
    if (process.argv.includes('--json')) {
        console.log(JSON.stringify(r, null, 2));
    } else {
        const R = (x) => `R${Math.round(x).toLocaleString('en-ZA')}`;
        console.log(`clip calibration: measured ${Math.round(r.CLIP_CALIBRATION.measured)} VM-s, model ${Math.round(r.CLIP_CALIBRATION.modelled)} VM-s`);
        const line = (name, e) =>
            `${name.padEnd(22)} rev ${R(e.revenue.net).padStart(12)} | cost ${R(e.cost).padStart(11)} | profit ${R(e.profit).padStart(12)} | margin ${e.margin == null ? '   -  ' : `${(e.margin * 100).toFixed(1)}%`.padStart(6)} | peak workers ${String(e.pools.short.servers).padStart(3)} short + ${String(e.pools.clips.servers).padStart(4)} clips | storage ${e.storageTb.toFixed(1)} TB`;
        for (const s of Object.keys(SCENARIOS)) {
            console.log(`\n== ${s} use (${SCENARIOS[s] * 100}% of allowances), 1,000 users ==`);
            for (const p of Object.values(r.perPlan)) console.log(line(p.name, p[s]));
            console.log(line('Mix', r.mix[s]));
            console.log(line('Mix (spot workers)', r.mix[`${s}Spot`]));
            console.log(line('Mix (cloud STT)', r.mix[`${s}CloudStt`]));
            console.log(line('Agency (cloud STT)', r.perPlan.agency[`${s}CloudStt`]));
        }
        console.log(`\nbreak-even: ~${r.breakEven.paidUsers} paying users cover ${R(r.breakEven.fixedBase)}/month of fixed and base costs`);
    }
}
