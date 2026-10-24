#!/usr/bin/env node
/**
 * Builds the South African launch forecast (December 2026 – February 2027) from
 * scripts/launch-forecast.mjs and prints it to PDF.
 *   node scripts/build-forecast-doc.mjs
 * Output: docs/forecast/launch-forecast.html and docs/forecast/KenganSocial_SA_Launch_Forecast.pdf
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from './launch-forecast.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs/forecast');
const htmlPath = path.join(outDir, 'launch-forecast.html');
const pdfPath = path.join(outDir, 'KenganSocial_SA_Launch_Forecast.pdf');

const r = run();
const R = (x) => `${x < 0 ? '−' : ''}R${Math.abs(Math.round(x)).toLocaleString('en-ZA').replace(/,/g, ' ')}`;
const n = (x) => Math.round(x).toLocaleString('en-ZA').replace(/,/g, ' ');
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const sc = r.scenarios;
const keys = ['conservative', 'base', 'optimistic'];
const cls = (x) => (x < 0 ? 'neg' : 'pos');

function monthTable(key) {
    const s = sc[key];
    const rows = s.months
        .map(
            (m) => `<tr><th>${m.name}</th><td>${n(m.signups)}</td><td>${n(m.payingUsers)}<small>${m.paid.creator_starter} / ${m.paid.creator_pro} / ${m.paid.agency} / ${m.paid.enterprise}</small></td><td>${n(m.totalAccounts)}</td><td>${R(m.mrr)}</td><td>${R(m.revenue.net)}</td><td>${R(m.cost - m.marketing)}</td><td>${R(m.marketing)}</td><td class="${cls(m.profit)}">${R(m.profit)}</td><td class="${cls(m.cumulative)}">${R(m.cumulative)}</td></tr>`
        )
        .join('');
    const t = s.totals;
    return `<table class="data"><thead><tr><th>Month</th><th>Sign-ups</th><th>Paying<small>Starter / Pro / Agency / Ent.</small></th><th>Accounts<small>free + paying</small></th><th>MRR<small>incl. VAT</small></th><th>Revenue<small>ex VAT</small></th><th>Running costs</th><th>Marketing</th><th>Profit</th><th>Cumulative<small>after pre-launch</small></th></tr></thead>
    <tbody>${rows}<tr class="total"><th>3 months</th><td>${n(t.signups)}</td><td>${n(t.endPaying)}</td><td>${n(t.endAccounts)}</td><td>${R(t.endMrr)}</td><td>${R(t.revenue)}</td><td colspan="2">${R(t.cost)} incl. pre-launch</td><td class="${cls(t.profit)}" colspan="2">${R(t.profit)}</td></tr></tbody></table>`;
}

function costTable(m) {
    const lines = { 'Payfast fees': m.revenue.fees, ...m.providers, ...m.servers, ...m.fixed, 'Provider minimum plans': m.minimums, Marketing: m.marketing };
    return `<table class="data narrow"><tbody>${Object.entries(lines)
        .map(([k, v]) => `<tr><th>${k}</th><td>${R(v)}</td></tr>`)
        .join('')}<tr class="total"><th>Total cost</th><td>${R(m.cost)}</td></tr><tr><th>Revenue (ex VAT)</th><td>${R(m.revenue.net)}</td></tr><tr class="total"><th>Profit</th><td class="${cls(m.profit)}">${R(m.profit)}</td></tr></tbody></table>`;
}

const plansEnd = keys
    .map((k) => {
        const m = sc[k].months.at(-1);
        return `<tr><th>${sc[k].label}</th><td>${n(m.freeAccounts)}</td><td>${n(m.paid.creator_starter)}</td><td>${n(m.paid.creator_pro)}</td><td>${n(m.paid.agency)}</td><td>${n(m.paid.enterprise)}</td><td>${n(m.totalAccounts)}</td><td>${((m.payingUsers / r.market.sam) * 100).toFixed(2)}%</td></tr>`;
    })
    .join('');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>KenganSocial: South African launch forecast</title>
<style>
@page { size: A4; margin: 16mm 14mm 18mm; }
:root { --ink:#16161a; --muted:#5d5d66; --line:#dcdce2; --accent:#c4512c; --good:#1f7a4d; --bad:#b42318; --soft:#f5f4f1; }
* { box-sizing: border-box; }
body { font: 10pt/1.5 "Segoe UI", Inter, Arial, sans-serif; color: var(--ink); margin: 0; }
h1 { font-size: 24pt; line-height: 1.1; margin: 0 0 6pt; letter-spacing: -0.02em; }
h2 { font-size: 15pt; margin: 22pt 0 8pt; padding-top: 6pt; border-top: 2px solid var(--ink); break-after: avoid; }
h3 { font-size: 11.5pt; margin: 14pt 0 5pt; break-after: avoid; }
p { margin: 0 0 7pt; }
small { display: block; color: var(--muted); font-size: 8pt; font-weight: 400; }
a { color: var(--ink); }
.kicker { text-transform: uppercase; letter-spacing: .12em; font-size: 8pt; color: var(--accent); font-weight: 700; }
.cover { padding: 8mm 0 4mm; border-bottom: 1px solid var(--line); margin-bottom: 10pt; }
.kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8pt; margin: 12pt 0; }
.kpis div { border: 1px solid var(--line); border-radius: 6pt; padding: 8pt 10pt; }
.kpis .label { font-size: 8pt; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 700; }
.kpis b { display: block; font-size: 15pt; line-height: 1.25; margin: 2pt 0; }
.kpis .base { border-color: var(--ink); border-width: 1.5px; }
table.data { width: 100%; border-collapse: collapse; margin: 6pt 0 10pt; font-size: 8.4pt; break-inside: avoid; }
table.data th, table.data td { border-bottom: 1px solid var(--line); padding: 4pt 5pt; text-align: right; vertical-align: top; }
table.data thead th { font-size: 7.6pt; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); border-bottom: 1.5px solid var(--ink); }
table.data th:first-child, table.data td:first-child { text-align: left; }
table.data tbody th { font-weight: 600; }
table.data.narrow { width: 64%; }
table.data tr.total th, table.data tr.total td { border-top: 1.5px solid var(--ink); font-weight: 700; }
td.pos { color: var(--good); font-weight: 600; } td.neg { color: var(--bad); font-weight: 600; }
.note { background: var(--soft); border-left: 3px solid var(--accent); padding: 7pt 10pt; margin: 8pt 0; break-inside: avoid; }
ul.findings { padding-left: 14pt; margin: 4pt 0 8pt; } ul.findings li { margin-bottom: 4pt; }
code { font-family: Consolas, monospace; font-size: 8.4pt; background: var(--soft); padding: 0 2pt; border-radius: 2pt; }
.pagebreak { break-before: page; }
footer { margin-top: 18pt; font-size: 8pt; color: var(--muted); border-top: 1px solid var(--line); padding-top: 6pt; }
</style></head><body>

<section class="cover">
  <div class="kicker">KenganSocial · MiraiStack · Launch forecast</div>
  <h1>South Africa: launch on 30 November, first three months</h1>
  <p>How many South African customers KenganSocial can reach, how they split across the plans, and the profit month by month from December 2026 to February 2027 in three scenarios. Costs per month come from the capacity model (servers sized for that month’s users, AI, voice, music, storage, Payfast, fixed costs) plus marketing.</p>
  <div class="kpis">
    ${keys
        .map((k) => {
            const t = sc[k].totals;
            return `<div class="${k === 'base' ? 'base' : ''}"><span class="label">${sc[k].label}</span><b>${n(t.endPaying)} paying</b>${n(t.endAccounts)} accounts by 28 Feb · MRR ${R(t.endMrr)}<br>3-month profit <b style="display:inline;font-size:11pt" class="${cls(t.profit)}">${R(t.profit)}</b><small>First profitable month: ${t.breakEvenMonth}. Launch costs paid back: ${t.paybackMonth}.</small></div>`;
        })
        .join('')}
  </div>
  <p><b>In short:</b> the base case (paid ads, a handful of creator partnerships, R35 000 a month on marketing) reaches about ${n(sc.base.totals.endPaying)} paying customers and ${R(sc.base.totals.endMrr)} in monthly subscriptions by the end of February, turns a monthly profit in January despite the festive shutdown, and has paid back its launch costs by February. Trial clip projects are now limited to 30-minute videos (changed 24 October); with the old 2-hour trial limit the base 3-month profit would be ${R(r.agencyTrial.base.totals.profit)}. Salaries are not included.</p>
</section>

<h2>1. How big is the South African market?</h2>
<table class="data">
<thead><tr><th>Segment</th><th>Serviceable customers</th><th>Plans they buy</th><th>Realistic 3-year share</th><th>Customers</th></tr></thead>
<tbody>${r.market.segments.map((s) => `<tr><th>${s.name}</th><td>${n(s.sam)}</td><td>${s.plans}</td><td>${(s.som3y * 100).toFixed(0)}%</td><td>${n(s.sam * s.som3y)}</td></tr>`).join('')}
<tr class="total"><th>Total</th><td>${n(r.market.sam)}</td><td></td><td></td><td>${n(r.market.segments.reduce((a, s) => a + s.sam * s.som3y, 0))}</td></tr></tbody></table>
<ul class="findings">
<li><b>Small businesses:</b> about ${n(r.MARKET.smmes)} SMMEs, roughly a third formal (SEDA, Absa Small Business Growth Index 2025). We count the ${(r.MARKET.smmesPostingShare * 100).toFixed(0)}% of formal businesses assumed to market on social media.</li>
<li><b>Creators:</b> one South African creator network alone counts over ${n(r.MARKET.creators)} creators (theSalt); we count the ${(r.MARKET.seriousCreatorShare * 100).toFixed(0)}% assumed to post weekly and want to grow or earn.</li>
<li><b>Agencies:</b> ${n(r.MARKET.agencies)}–37 000 registered advertising and marketing firms (CIPC data via CompanyData and InfobelPRO); we count the ${(r.MARKET.socialAgencyShare * 100).toFixed(0)}% assumed to run clients’ social media.</li>
<li><b>Audience:</b> almost 41 million South Africans are active on social media (Ornico / World Wide Worx 2026), so the people these customers market to are there.</li>
</ul>
<p class="note">The serviceable market is about ${n(r.market.sam)} potential customers. Even the optimistic scenario ends February with ${((sc.optimistic.totals.endPaying / r.market.sam) * 100).toFixed(2)}% of it paying, so the forecast is limited by marketing reach and conversion, not by market size. Long-term, a ${n(r.market.segments.reduce((a, s) => a + s.sam * s.som3y, 0))}-customer base at today’s plan mix is the 3-year ceiling these shares imply.</p>

<h2>2. How the launch is simulated</h2>
<table class="data">
<thead><tr><th>Assumption</th>${keys.map((k) => `<th>${sc[k].label}</th>`).join('')}</tr></thead>
<tbody>
<tr><th>What happens</th>${keys.map((k) => `<td style="text-align:left">${sc[k].story}</td>`).join('')}</tr>
<tr><th>Sign-ups a month before seasonality</th>${keys.map((k) => `<td>${n(sc[k].baseSignups)}</td>`).join('')}</tr>
<tr><th>Growth per month (word of mouth)</th>${keys.map((k) => `<td>${sc[k].growth * 100}%</td>`).join('')}</tr>
<tr><th>Trial → paid (7-day trial, no card)</th>${keys.map((k) => `<td>${sc[k].trialToPaid * 100}%</td>`).join('')}</tr>
<tr><th>Free → paid per month</th>${keys.map((k) => `<td>${sc[k].freeToPaid * 100}%</td>`).join('')}</tr>
<tr><th>Enterprise deals (Dec / Jan / Feb)</th>${keys.map((k) => `<td>${sc[k].enterpriseDeals.join(' / ')}</td>`).join('')}</tr>
<tr><th>Marketing per month</th>${keys.map((k) => `<td>${R(sc[k].marketing)}</td>`).join('')}</tr>
</tbody></table>
<ul class="findings">
<li><b>Festive season:</b> sign-ups at ${r.MONTHS.map((m) => `${(m.seasonality * 100).toFixed(0)}% in ${m.name.split(' ')[0]}`).join(', ')} of a normal month. Many businesses close from mid-December to mid-January; creators keep posting, which softens the dip.</li>
<li><b>Everyone starts with the 7-day trial.</b> Those who don’t buy drop to the Free plan; ${r.FREE_ACTIVE * 100}% of free accounts stay active and some upgrade later.</li>
<li><b>New paying customers split</b> ${Object.entries(r.PAID_SPLIT).map(([k, v]) => `${(v * 100).toFixed(0)}% ${{ creator_starter: 'Creator Starter', creator_pro: 'Creator Pro', agency: 'Agency' }[k]}`).join(', ')}; ${r.CHURN * 100}% of paying customers cancel each month; customers use ${r.USE * 100}% of their allowances.</li>
<li><b>Benchmarks:</b> no-card trials convert 4–6% (good) to 9% (strong); self-serve freemium 3–8% overall. Prices are the current monthly list prices (R299, R699, R3 499, R8 999 incl. VAT).</li>
<li><b>Pre-launch spend in November:</b> ${Object.entries(r.PRELAUNCH).map(([k, v]) => `${k} ${R(v)}`).join('; ')}.</li>
</ul>

<h2 class="pagebreak">3. Month by month</h2>
${keys.map((k) => `<h3>${sc[k].label}</h3>${monthTable(k)}`).join('')}
<p class="note"><b>Running costs</b> include Payfast fees, AI, voice, music, transcription, storage, Firestore, the worker fleet and API server, hosting, backups, licences and the provider minimum plans. <b>MRR</b> is monthly subscriptions at list price including VAT; revenue is after VAT.</p>

<h2>4. Customers on each plan by 28 February</h2>
<table class="data"><thead><tr><th>Scenario</th><th>Free (active + inactive)</th><th>Creator Starter</th><th>Creator Pro</th><th>Agency</th><th>Enterprise</th><th>All accounts</th><th>Paying share of market</th></tr></thead><tbody>${plansEnd}</tbody></table>

<h2>5. Where the money goes: base case, February</h2>
${costTable(sc.base.months.at(-1))}

<h2 class="pagebreak">6. What this means</h2>
<ul class="findings">
<li><b>Marketing drives everything.</b> Organic-only (conservative) loses about ${R(-sc.conservative.totals.profit)} over the three months and reaches only ${n(sc.conservative.totals.endPaying)} paying customers. Spending R35 000 a month (base) is profitable from January.</li>
<li><b>December will lose money in every scenario</b> (launch costs plus the festive slowdown). Plan cash for about ${R(-Math.min(...keys.map((k) => sc[k].months[0].cumulative)))} before revenue catches up.</li>
<li><b>Trial clip projects are limited (done).</b> Since 24 October a trial turns videos of up to 30 minutes into clips with the fast speech model, like Creator Starter, instead of Agency’s 2 hours. With the old limit the 3-month result would have been ${keys.map((k) => `${R(r.agencyTrial[k].totals.profit)} (${sc[k].label.toLowerCase()})`).join(', ')}, and clip work at the busiest hour about five times higher.</li>
<li><b>The servers must scale before launch.</b> At the busiest hour in December the base case already sends ${sc.base.months[0].singleQueueLoad.renders.toFixed(1)}× more render work and ${sc.base.months[0].singleQueueLoad.clips.toFixed(0)}× more clip work than today’s one-at-a-time queues can finish (${r.agencyTrial.base.months[0].singleQueueLoad.clips.toFixed(0)}× with the old 2-hour trial). The worker pool in the readiness report (<code>docs/capacity/KenganSocial_1000_Users_Readiness.pdf</code>) is a launch requirement, not a later improvement. By February the base case needs about ${sc.base.months.at(-1).peakWorkers} workers at peak (already included in the costs above).</li>
<li><b>Agency customers carry the profit.</b> In the base case Agency is ~10% of new paying customers but about ${Math.round((sc.base.months.at(-1).paid.agency * 3499) / sc.base.months.at(-1).mrr * 100)}% of February’s MRR. Direct outreach to agencies is the highest-value marketing.</li>
<li><b>Not included:</b> salaries and contractors, office costs, income tax, annual-plan cash paid upfront (it would improve cash flow), and any price changes. Exchange rate R17.50/US$.</li>
</ul>

<h3>Launch timeline</h3>
<table class="data"><thead><tr><th>When</th><th>What</th></tr></thead><tbody>
<tr><th>1–15 November</th><td style="text-align:left">Worker pool and Cloud Storage live; trial clip limit; Payfast live tested; Meta, TikTok and YouTube approvals submitted; staging load test (readiness report checklist).</td></tr>
<tr><th>16–29 November</th><td style="text-align:left">Creator partners signed and briefed; launch video and ads ready; agency outreach list; support inbox staffed.</td></tr>
<tr><th>30 November</th><td style="text-align:left">Launch. Watch queue wait times, sign-ups, trial conversions and AI/voice/music spend daily.</td></tr>
<tr><th>December</th><td style="text-align:left">Lean into creators (festive content), keep ads running at a lower budget during the shutdown weeks.</td></tr>
<tr><th>January</th><td style="text-align:left">Back-to-work campaign from the second week; agency outreach; first annual-plan offer.</td></tr>
<tr><th>February</th><td style="text-align:left">Scale what converted; review churn and plan mix; update this forecast with real numbers.</td></tr>
</tbody></table>

<h2>7. Sources</h2>
<ul class="findings">
<li>Social media users: <a href="https://www.citizen.co.za/news-south-africa/which-social-media-platforms-most-used-south-africa/">The Citizen, citing Ornico / World Wide Worx 2026</a></li>
<li>SMMEs: <a href="https://www.absa.co.za/business/absa-small-business-growth-index-2025/">Absa Small Business Growth Index 2025</a>; <a href="https://businessreport.co.za/economy/2024-06-27-smmes-need-enabling-economic-environment-to-thrive">Business Report, citing SEDA</a></li>
<li>Creators: <a href="https://thesalt.co.za/showcase/insights/half-a-million-creators-strong">theSalt: half a million creators</a></li>
<li>Agencies: <a href="https://companydata.com/south-africa/marketing-companies/">CompanyData</a>; <a href="https://www.infobelpro.com/companies/south-africa/advertising-and-marketing-agencies">InfobelPRO</a></li>
<li>Conversion benchmarks: <a href="https://www.crazyegg.com/blog/free-to-paid-conversion-rate/">CrazyEgg</a>; <a href="https://userpilot.com/blog/freemium-saas/">Userpilot</a></li>
<li>Festive shutdown: <a href="https://businesstech.co.za/news/business/289578/the-cost-of-the-december-shutdown-to-business-in-south-africa/">BusinessTech</a>; <a href="https://www.yoco.com/za/blog/seasonal-spend-report-part-3/">Yoco seasonal spend report</a></li>
<li>Costs: <code>scripts/capacity-model.mjs</code> and <code>scripts/pricing-model.mjs</code>. Re-run with <code>node scripts/launch-forecast.mjs</code> and <code>node scripts/build-forecast-doc.mjs</code>.</li>
</ul>
<footer>KenganSocial is operated by MiraiStack (registration K2025971590). A forecast built on stated assumptions and public estimates, not a promise of results; update it with real sign-up and conversion data after launch.</footer>
</body></html>`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(htmlPath, html);
console.log('wrote', path.relative(root, htmlPath));
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
if (chrome) {
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdfPath}`, `file:///${htmlPath.replace(/\\/g, '/')}`], { stdio: 'ignore' });
    console.log('wrote', path.relative(root, pdfPath));
} else console.log('Chrome not found: open the HTML file and print it to PDF.');
