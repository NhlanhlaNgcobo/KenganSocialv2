#!/usr/bin/env node
/**
 * Builds docs/pricing/pricing-model.html from scripts/pricing-model.mjs (the PDF is printed from it).
 *   node scripts/build-pricing-doc.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPUTE, CREDIT_COST, CREDIT_PRICES, CREDIT_USD, ECON, FAIR_USE, FIXED_MONTHLY, PER_WORKSPACE, PLANS, PROVIDER, VM_SECOND, costPlan, fixedMonthly, minimumPrice, unitCosts } from './pricing-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs/pricing/pricing-model.html');

const R = (x, d = 2) => `R${Number(x).toLocaleString('en-ZA', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const u = unitCosts();

// Limits before this review (in production until 23 October 2026), costed with the same unit costs.
const OLD = [
    { id: 'creator_starter', tier: 'nano', name: 'Creator Starter', price: 299, whisper: 'base', maxSourceMin: 30, limits: { posts: 30, exports: 10, transcribeMinutes: 180, clipAnalysis: 3, aiCalls: 100, renders: 6, storageGB: 2 } },
    { id: 'creator_pro', tier: 'creator', name: 'Creator Pro', price: 699, whisper: 'small', maxSourceMin: 90, limits: { posts: 100, exports: 30, transcribeMinutes: 600, clipAnalysis: 12, aiCalls: 250, renders: 25, storageGB: 10 } },
    { id: 'agency', tier: 'agency', name: 'Agency', price: 3499, whisper: 'medium', maxSourceMin: 180, limits: { posts: -1, exports: 150, transcribeMinutes: 2400, clipAnalysis: 40, aiCalls: 1300, renders: 150, storageGB: 50 } },
];
const oldTrial = { id: 'trial', tier: 'agency', name: 'Trial (old)', price: 0, whisper: 'medium', maxSourceMin: 180, limits: OLD[2].limits };

const paid = PLANS.filter((p) => p.price > 0);
const now = paid.map(costPlan);
const before = OLD.map(costPlan);
const trialNow = costPlan(PLANS.find((p) => p.id === 'trial'));
const trialOld = costPlan(oldTrial);
const free = costPlan(PLANS.find((p) => p.id === 'starter'));

// Sensitivity: weaker rand and fewer useful VM-seconds.
function withEcon(patch, fn) {
    const saved = { ...ECON };
    Object.assign(ECON, patch);
    try { return fn(); } finally { Object.assign(ECON, saved); }
}
const realistic = withEcon({ buffer: 0 }, () => paid.map(costPlan));
const weakRand = withEcon({ usdZar: 20 }, () => paid.map(costPlan));
const notVatRegistered = withEcon({ pricesIncludeVat: false }, () => paid.map(costPlan));
// Exchange rate at which the first paid plan's annual margin reaches 60% (with the 20% buffer still on).
let lo = ECON.usdZar, hi = 40;
for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const worst = withEcon({ usdZar: mid }, () => Math.min(...paid.map((p) => costPlan(p).annual.margin)));
    if (worst >= ECON.targetMargin) lo = mid; else hi = mid;
}
const breakFx = lo;

// Fixed costs and break-even
const fixed = fixedMonthly();
const contribution = now.map((p) => p.monthly.net - p.monthly.cost); // at full use (worst case)
const avgContribution = contribution.reduce((a, b) => a + b, 0) / contribution.length;

const freeClip = u.transcriptionMinute.base * 30 + (u.clipProject(30) - (10 * 60 * COMPUTE.clipRender * VM_SECOND)) + 60 * COMPUTE.clipRender * VM_SECOND;

const limitRows = [
    ['Scheduled posts', 'posts'],
    ['Editor exports (5-min units)', 'exports'],
    ['Transcription (minutes)', 'transcribeMinutes'],
    ['AI clip projects', 'clipAnalysis'],
    ['AI credits', 'aiCalls'],
    ['Video renders', 'renders'],
    ['Storage (GB)', 'storageGB'],
];
const lim = (v) => (v === -1 ? 'Unlimited' : Number(v).toLocaleString('en-ZA'));

const sources = [
    ['Claude Haiku 4.5 on OpenRouter: $1 / $5 per million tokens', 'https://openrouter.ai/anthropic/claude-haiku-4-5/pricing'],
    ['Gemini API pricing (Flash, Flash-Lite, Flash Image)', 'https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing'],
    ['OpenRouter image models compared (Nano Banana 2 $0.0672, GPT Image)', 'https://openrouter.ai/blog/insights/image-generation-models-compared/'],
    ['OpenAI image API pricing (GPT Image medium ~$0.053)', 'https://www.modellix.ai/blog/openai-image-generation-api-pricing'],
    ['ElevenLabs API pricing ($0.10 per 1,000 characters, Multilingual)', 'https://developer.puter.com/tutorials/elevenlabs-api-pricing/'],
    ['Perplexity Sonar API pricing ($1/$1 per M tokens + $5 per 1,000 requests)', 'https://developer.puter.com/tutorials/perplexity-api-pricing/'],
    ['Treblo API (credit-based, from ~$11/month; per-track price not published)', 'https://kompozy.io/reviews/treblo'],
    ['Remotion licence (Automators: $0.01 per render, $100/month minimum)', 'https://www.remotion.dev/docs/license/pricing'],
    ['Google Video Intelligence pricing (not used by the app today)', 'https://cloud.google.com/video-intelligence/pricing'],
    ['e2-standard-4 in africa-south1 (~$128/month on demand)', 'https://gcloud-compute.com/e2-standard-4.html'],
    ['Firebase / Cloud Storage pricing', 'https://firebase.google.com/pricing'],
    ['Payfast fees (card 3.2% + R2.00)', 'https://payfast.io/fees'],
    ['USD/ZAR rate (16.38 on 16 Sep 2026; Oct forecast 16.25-17.33)', 'https://longforecast.com/dollar-to-rand-forecast-2017-2018-2019-2020-2021-usd-to-zar'],
];

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>KenganSocial pricing model</title>
<style>
@page { size: A4; margin: 15mm 14mm 16mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", Arial, sans-serif; color: #15171c; font-size: 9.6pt; line-height: 1.45; margin: 0; }
h1 { font-size: 21pt; margin: 0 0 1mm; letter-spacing: -0.01em; }
h2 { font-size: 13pt; margin: 7mm 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid #d4d7dd; break-after: avoid; }
h3 { font-size: 10.5pt; margin: 4mm 0 1.5mm; break-after: avoid; }
p { margin: 0 0 2.2mm; }
.sub { color: #555b66; margin-bottom: 5mm; }
.box { background: #f3f4f6; border-left: 3px solid #15171c; padding: 3mm 4mm; margin: 2mm 0 3mm; }
table { width: 100%; border-collapse: collapse; margin: 1.5mm 0 3mm; break-inside: avoid; font-size: 8.8pt; }
th, td { padding: 1.3mm 2mm; border-bottom: 1px solid #e4e6ea; text-align: right; vertical-align: top; }
th:first-child, td:first-child { text-align: left; }
th { background: #f6f7f9; font-weight: 600; }
td.l, th.l { text-align: left; }
.ok { color: #116b3a; font-weight: 600; } .bad { color: #a3221b; font-weight: 600; }
ul { margin: 0 0 2.5mm; padding-left: 5mm; } li { margin-bottom: 1mm; }
code { font-family: Consolas, monospace; font-size: 8.4pt; background: #f1f2f4; padding: 0 1mm; border-radius: 1mm; }
.small { font-size: 8.2pt; color: #555b66; }
.formula { font-family: Consolas, monospace; font-size: 8.6pt; background: #f6f7f9; padding: 2mm 3mm; border-radius: 1.5mm; margin: 1mm 0 3mm; white-space: pre-wrap; }
a { color: #15171c; }
</style></head><body>

<h1>KenganSocial pricing model</h1>
<p class="sub">Credits, usage limits and prices per plan, worked out from what each service costs per second and per execution. 23 October 2026. Generated from <code>scripts/pricing-model.mjs</code>; re-run it when a provider changes its prices.</p>

<div class="box"><b>Result.</b> With the new allowances every paid plan keeps a gross margin of <b>at least 60%</b> even when a customer uses 100% of every allowance, on the 10%-discounted annual price, after VAT and Payfast fees, with a 20% safety buffer on every third-party price. Prices stay the same (R299, R699, R3,499, R8,999). An automated test (<code>server/tests/security/pricing.test.ts</code>) fails if the app's limits drift from this model or a plan drops below 60%.</div>

<table>
<tr><th>Plan</th><th>Price</th><th>Cost at 100% use</th><th>Margin monthly</th><th>Margin annual</th><th>Lowest price for 60%</th><th>Margin before (annual)</th></tr>
${now.map((p, i) => {
    const b = before.find((x) => x.id === p.id);
    return `<tr><td>${esc(p.name)}</td><td>${R(p.monthly.price, 0)}</td><td>${R(p.variable)}</td><td class="ok">${pct(p.monthly.margin)}</td><td class="ok">${pct(p.annual.margin)}</td><td>${R(p.monthly.minPrice / (1 - ECON.annualDiscount), 0)}</td><td class="${b && b.annual.margin < 0.6 ? 'bad' : ''}">${b ? pct(b.annual.margin) : '—'}</td></tr>`;
}).join('')}
</table>
<p class="small">"Lowest price for 60%" is the list price at which the annual price still reaches 60% at full use. "Before" costs the old allowances with the same unit costs. Enterprise runs on the Agency allowances in the app; extras are quoted from the unit costs below.</p>

<h2>1. How the costs are measured</h2>
<p>Every action is costed three ways and the plan limits are counted in the same units:</p>
<ul>
<li><b>By the second:</b> video work (transcription, analysis, rendering, exporting) is measured in <i>VM-seconds</i>: seconds of one 4-CPU server (e2-standard-4, Johannesburg). The server costs ~US$${COMPUTE.vmUsdMonth}/month; capacity is bought for peaks, so only ${pct(COMPUTE.utilisation)} of every second is counted as useful. One useful VM-second costs <b>${R(VM_SECOND, 5)}</b>.</li>
<li><b>By execution:</b> each call to an outside AI or media API is costed from the provider's price, at its worst case (largest output it is allowed to produce, most expensive model in the fallback chain).</li>
<li><b>By plan limits:</b> a plan's cost is every allowance used in full, times the unit's worst-case cost.</li>
</ul>
<div class="formula">rand cost of an API call = US$ price × R${ECON.usdZar} (exchange) × ${1 + ECON.vat} (VAT on imported services) × ${1 + ECON.buffer} (safety buffer)
net revenue           = list price ÷ 1.15 (treated as VAT-inclusive)
payment fee           = (price × ${pct(ECON.payfastPct)} + R${ECON.payfastFixed.toFixed(2)}) × 1.15
gross margin          = (net revenue − cost at 100% use − payment fee) ÷ net revenue   ≥ 60%</div>

<h3>Compute per second of media (e2-standard-4, VM-seconds per second)</h3>
<table>
<tr><th>Work</th><th>VM-s per media second</th><th>Cost per media minute</th><th class="l">Basis</th></tr>
<tr><td>Transcription, Whisper base (Creator Starter)</td><td>${COMPUTE.whisper.base}</td><td>${R(u.transcriptionMinute.base, 3)}</td><td class="l">faster-whisper int8 on CPU</td></tr>
<tr><td>Transcription, Whisper small (Creator Pro)</td><td>${COMPUTE.whisper.small}</td><td>${R(u.transcriptionMinute.small, 3)}</td><td class="l">≈3× base</td></tr>
<tr><td>Transcription, Whisper medium (Agency, trial)</td><td>${COMPUTE.whisper.medium}</td><td>${R(u.transcriptionMinute.medium, 3)}</td><td class="l">≈9× base</td></tr>
<tr><td>Scene and face analysis of the source</td><td>${COMPUTE.analysis}</td><td>${R(60 * COMPUTE.analysis * VM_SECOND, 3)}</td><td class="l">PySceneDetect, YuNet</td></tr>
<tr><td>Clip render 1080×1920 with face tracking</td><td>${COMPUTE.clipRender}</td><td>${R(60 * COMPUTE.clipRender * VM_SECOND, 3)}</td><td class="l">FFmpeg libx264 veryfast</td></tr>
<tr><td>Editor export</td><td>${COMPUTE.export}</td><td>${R(60 * COMPUTE.export * VM_SECOND, 3)}</td><td class="l">same encoder</td></tr>
<tr><td>Remotion render (launch, tutorial, video ad)</td><td>${COMPUTE.remotion}</td><td>${R(60 * COMPUTE.remotion * VM_SECOND, 3)}</td><td class="l">20-s template took 1-3 min (DEPLOY.md); launch videos 90-274 s</td></tr>
</table>

<h3>Third-party prices used (US$, before buffer)</h3>
<table>
<tr><th>Service</th><th>Price</th><th class="l">Used by</th></tr>
<tr><td>Claude Haiku 4.5 (OpenRouter)</td><td>$${PROVIDER.haikuIn * 1e6} / $${PROVIDER.haikuOut * 1e6} per M tokens</td><td class="l">all text AI, clip finding, storyboards</td></tr>
<tr><td>Claude Opus (lyrics structuring)</td><td>$${PROVIDER.opusIn * 1e6} / $${PROVIDER.opusOut * 1e6} per M tokens</td><td class="l">lyrics analyser</td></tr>
<tr><td>Fast AI image (Nano Banana 2)</td><td>$${PROVIDER.fastImage} each</td><td class="l">carousels, thumbnails, AI Writer images</td></tr>
<tr><td>Best AI image (GPT Image, medium, up to 1536 px)</td><td>$${PROVIDER.bestImage} each</td><td class="l">carousels</td></tr>
<tr><td>ElevenLabs Multilingual v2</td><td>$${(PROVIDER.elevenPerChar * 1000).toFixed(2)} per 1,000 characters</td><td class="l">video ad voiceover</td></tr>
<tr><td>Treblo music</td><td>$${PROVIDER.trebloTrack} per 30-s track (estimate)</td><td class="l">video ads, launch videos</td></tr>
<tr><td>Perplexity Sonar</td><td>$${PROVIDER.sonarQuery} per query</td><td class="l">trending</td></tr>
<tr><td>OpenAI whisper-1</td><td>$${PROVIDER.whisperApiMin} per minute</td><td class="l">lyrics only</td></tr>
<tr><td>Remotion Automators licence</td><td>$${PROVIDER.remotionRender} per render, $100/month minimum</td><td class="l">all Remotion renders</td></tr>
</table>

<h2>2. Cost of each unit a plan counts</h2>
<table>
<tr><th>Unit</th><th>Worst-case cost</th><th class="l">What it covers</th></tr>
<tr><td>AI credit</td><td>${R(u.aiCredit)}</td><td class="l">up to US$${CREDIT_USD} of model use: a Haiku call with 4k tokens in and 1.5k out costs US$0.0115</td></tr>
<tr><td>Scheduled post</td><td>${R(u.post)}</td><td class="l">platform downloads ~50 MB once, plus the publish job</td></tr>
<tr><td>Export unit (5 min of video)</td><td>${R(u.exportUnit)}</td><td class="l">300 s × ${COMPUTE.export} VM-s</td></tr>
<tr><td>Render unit</td><td>${R(u.renderUnit)}</td><td class="l">the dearest of: a 30-s launch video (capture, storyboard with screenshots, music, Remotion), a 25-s video ad (voice, music, Remotion), or 5 min of AI edit</td></tr>
<tr><td>Transcription minute</td><td>${R(u.transcriptionMinute.base, 3)} / ${R(u.transcriptionMinute.small, 3)} / ${R(u.transcriptionMinute.medium, 3)}</td><td class="l">base / small / medium Whisper</td></tr>
<tr><td>AI clip project</td><td>${[30, 60, 120].map((m) => `${R(u.clipProject(m))} (${m} min)`).join(' · ')}</td><td class="l">source analysis + one 8.5k-token chunk per ~20 min of speech (max 8k tokens out) + 10 clips of 60 s rendered; transcription is counted separately</td></tr>
<tr><td>Storage, per GB a month</td><td>${R(u.storageGb)}</td><td class="l">stored and downloaded once</td></tr>
</table>

<h3>AI credits per action</h3>
<table>
<tr><th>Action</th><th>Credits</th><th>Worst-case provider cost</th><th class="l">Change</th></tr>
<tr><td>Text generation (hook, script, repurpose, AI Writer, brand voice, DM draft)</td><td>${CREDIT_PRICES.text}</td><td>≤ $${CREDIT_USD}</td><td class="l">DM drafts were free; AI Writer used a separate 50-credit balance any plan got</td></tr>
<tr><td>Captions</td><td>${CREDIT_PRICES.text} per platform</td><td>≤ $${CREDIT_USD} each</td><td class="l">was 1 for all platforms together</td></tr>
<tr><td>Thumbnail headline ideas</td><td>${CREDIT_PRICES.headlines}</td><td>≤ $${CREDIT_USD}</td><td class="l">was free (without credits: built from the clip's words)</td></tr>
<tr><td>Trending refresh (manual)</td><td>${CREDIT_PRICES.trendingRefresh}</td><td>~$0.019</td><td class="l">was free; refreshing every 5 min could cost ~R3,000/month per workspace</td></tr>
<tr><td>Brand set-up from a website</td><td>${CREDIT_PRICES.websiteSetup}</td><td>~$0.07</td><td class="l">was free on any plan with credits</td></tr>
<tr><td>AI Edit: learn a style</td><td>${CREDIT_PRICES.styleLearn}</td><td>~$0.045</td><td class="l">unchanged</td></tr>
<tr><td>Fast AI image</td><td>${CREDIT_PRICES.fastImage}</td><td>$${PROVIDER.fastImage}</td><td class="l">was 2 (1 for a thumbnail background)</td></tr>
<tr><td>Best AI image</td><td>${CREDIT_PRICES.bestImage}</td><td>$${PROVIDER.bestImage}</td><td class="l">unchanged</td></tr>
<tr><td>Lyrics analysis (6-min song)</td><td>${CREDIT_PRICES.lyrics}</td><td>~$0.25</td><td class="l">was free on every plan, including Free</td></tr>
</table>

<h3>Counted by length (per second, rounded up)</h3>
<ul>
<li><b>Transcription</b> is counted in minutes (was whole hours: a 61-minute video used 2 hours, and the standalone transcribe used 1 hour whatever its length).</li>
<li><b>Editor exports</b> count 1 per started 5 minutes of exported video (was 1 per export of any length).</li>
<li><b>AI edits</b> count 1 render per started 5 minutes of source (was 1 for up to 3 hours of video).</li>
<li><b>Longest clip source</b>: Creator Starter 30 min, Creator Pro 60 min (was 90), Agency 120 min (was 180).</li>
</ul>

<h2>3. Plans: allowances and full-use cost</h2>
<table>
<tr><th>Allowance per month</th>${paid.slice(0, 3).map((p) => `<th>${esc(p.name)}<br><span class="small">before → now</span></th>`).join('')}</tr>
${limitRows.map(([label, key]) => `<tr><td>${label}</td>${paid.slice(0, 3).map((p) => {
    const o = OLD.find((x) => x.id === p.id);
    const a = o.limits[key];
    const b = p.limits[key];
    return `<td>${a === b ? lim(b) : `${lim(a)} → <b>${lim(b)}</b>`}</td>`;
}).join('')}</tr>`).join('')}
<tr><td>Longest clip source</td>${paid.slice(0, 3).map((p) => { const o = OLD.find((x) => x.id === p.id); return `<td>${o.maxSourceMin === p.maxSourceMin ? `${p.maxSourceMin} min` : `${o.maxSourceMin} → <b>${p.maxSourceMin} min</b>`}</td>`; }).join('')}</tr>
</table>
<p class="small">Unchanged: connected accounts (2 / 3 / 6 / 25), DM automation rules (0 / 10 / 50 / unlimited; rules cost nothing to run, AI drafts are paid in credits), client approvals (Creator Pro 5 clients, Agency unlimited). Agency "unlimited posts" becomes 1,000 a month (33 a day).</p>

${now.map((p) => `<h3>${esc(p.name)}: ${R(p.monthly.price, 0)}/month (${R(p.annual.price, 0)}/month billed yearly)</h3>
<table>
<tr><th>Cost line at 100% use</th>${Object.keys(p.lines).map((k) => `<th>${esc(k)}</th>`).join('')}<th>Total</th></tr>
<tr><td>Rand</td>${Object.values(p.lines).map((v) => `<td>${R(v)}</td>`).join('')}<td><b>${R(p.variable)}</b></td></tr>
</table>
<table>
<tr><th>Billing</th><th>Price</th><th>Net of VAT</th><th>Payfast fee</th><th>Cost incl. fee</th><th>Gross profit</th><th>Margin</th></tr>
${['monthly', 'annual'].map((k) => `<tr><td>${k}</td><td>${R(p[k].price, 0)}</td><td>${R(p[k].net)}</td><td>${R(p[k].fee)}</td><td>${R(p[k].cost)}</td><td>${R(p[k].net - p[k].cost)}</td><td class="ok">${pct(p[k].margin)}</td></tr>`).join('')}
</table>`).join('')}

<h2>4. Free plan, trial and free starter clip</h2>
<table>
<tr><th>Who</th><th>Cost per user at full use</th><th class="l">Notes</th></tr>
<tr><td>Free plan</td><td>${R(free.variable)} / month</td><td class="l">no AI, 3 exports, 10 posts, 0.5 GB</td></tr>
<tr><td>7-day trial (now)</td><td>${R(trialNow.variable)} once</td><td class="l">every Agency feature unlocked, Creator Starter quantities (enforced in planGate)</td></tr>
<tr><td>7-day trial (before)</td><td class="bad">${R(trialOld.variable)} once</td><td class="l">full Agency allowances, no card: a fake sign-up could cost about this much</td></tr>
<tr><td>Free starter clip</td><td>~${R(freeClip)} each</td><td class="l">one per email, 2 per network a day; daily cap now 25 (was 100): at most ~${R(freeClip * 25 * 30, 0)} a month</td></tr>
</table>

<h2>5. Fixed costs and break-even</h2>
<table>
<tr><th>Fixed monthly cost</th><th>Rand</th></tr>
${Object.entries(FIXED_MONTHLY).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${R(v, 0)}</td></tr>`).join('')}
<tr><td><b>Total</b></td><td><b>${R(fixed, 0)}</b></td></tr>
</table>
<p>The server itself is costed per VM-second inside each plan (at ${pct(COMPUTE.utilisation)} utilisation); when usage grows, a second server is added and the per-second cost stays the same. Even if every customer used 100% of every allowance, the average paid plan contributes ${R(avgContribution, 0)} a month, so the fixed costs are covered from about <b>${Math.ceil(fixed / Math.min(...contribution))} paying customers</b> on the cheapest plan (${Math.ceil(fixed / avgContribution)} on an even mix). Typical customers use far less than 100%, so real break-even comes sooner.</p>

<h2>6. Sensitivity</h2>
<table>
<tr><th>Scenario</th>${paid.map((p) => `<th>${esc(p.name)}<br><span class="small">annual margin</span></th>`).join('')}</tr>
<tr><td>Base case (R${ECON.usdZar}/$, 20% buffer, prices VAT-inclusive)</td>${now.map((p) => `<td>${pct(p.annual.margin)}</td>`).join('')}</tr>
<tr><td>No safety buffer (prices exactly as published)</td>${realistic.map((p) => `<td>${pct(p.annual.margin)}</td>`).join('')}</tr>
<tr><td>Weaker rand: R20 per US$</td>${weakRand.map((p) => `<td class="${p.annual.margin < 0.6 ? 'bad' : ''}">${pct(p.annual.margin)}</td>`).join('')}</tr>
<tr><td>Not VAT-registered (no VAT taken from the price)</td>${notVatRegistered.map((p) => `<td>${pct(p.annual.margin)}</td>`).join('')}</tr>
</table>
<p class="small">With the 20% buffer kept on, every plan holds 60% up to <b>R${breakFx.toFixed(2)} per US$</b> (equivalent to about R${(breakFx * (1 + ECON.buffer)).toFixed(0)} if providers charge exactly their published prices). If the rand weakens past that, change <code>usdZar</code> in the model and re-run: the pricing test then fails and points at the plan that needs a smaller allowance or a higher price.</p>

<h2>7. What changed in the app</h2>
<ul>
<li><b>Limits</b> (server and client <code>planLimits.ts</code>, pricing page, Billing): new allowances above; transcription counted in minutes.</li>
<li><b>Per-second counting:</b> transcription by the minute everywhere (clips, repurpose, AI edit, standalone transcribe); editor exports and AI edits per 5 minutes of video.</li>
<li><b>Per-execution counting:</b> captions per platform; AI images 5 or 6 credits everywhere (carousels, thumbnails, AI Writer); trending refresh, website set-up, thumbnail headlines, DM drafts and lyrics now cost credits, with refunds when the work fails or is served from cache.</li>
<li><b>AI Writer</b> uses the plan's monthly AI credits; the old never-resetting 50-credit balance is gone. Its legacy video render uses the render allowance.</li>
<li><b>Trial</b> keeps every Agency feature but with Creator Starter quantities.</li>
<li><b>Free starter clip</b> daily cap 25 by default (<code>FREE_CLIP_DAILY_CAP</code>).</li>
<li><b>Guard rail:</b> <code>server/tests/security/pricing.test.ts</code> checks the app's limits, prices and credit costs against this model and fails if any paid plan falls below 60%.</li>
</ul>

<h2>8. Findings still open</h2>
<ul>
<li><b>Prices to confirm with the providers:</b> Treblo's per-track price is not published (estimated at $${PROVIDER.trebloTrack}); the lyrics model is costed at Opus 4.5/4.6 rates; Payfast recurring-card fees; the VM's exact Johannesburg price. Update <code>scripts/pricing-model.mjs</code> and re-run.</li>
<li><b>Measure on the real server:</b> the VM-seconds per media second come from local runs and the deploy notes. Time a 10-minute clip project and a 25-s video ad on the VM and update <code>COMPUTE</code>.</li>
<li><b>Two legacy endpoints are still unmetered:</b> <code>/api/ai/video/analyze</code> (Whisper base on uploads up to 100 MB) and <code>/api/ai/video/edit</code>. Their size cap limits the exposure; meter or retire them next.</li>
<li><b>Advertised but not enforced:</b> the connected-accounts limit (2/3/6/25) and storage (only enforced for the Agency library).</li>
<li><b>Fallbacks are cheaper, not dearer:</b> when a cheaper provider answers (Gemini Flash, Pollinations' free images), real costs are below this model. The worst case is what the margin is guaranteed on.</li>
</ul>

<h2>Sources</h2>
<ul class="small">${sources.map(([t, url]) => `<li>${esc(t)}: <a href="${url}">${url}</a></li>`).join('')}</ul>
<p class="small">Third-party price pages disagree in places; where they did, the higher figure was used and a 20% buffer added on top.</p>
</body></html>`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(root, out)}`);
