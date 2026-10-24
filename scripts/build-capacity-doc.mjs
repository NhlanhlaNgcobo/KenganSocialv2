#!/usr/bin/env node
/**
 * Builds the 1,000-user readiness report from scripts/capacity-model.mjs and prints it to PDF.
 *   node scripts/build-capacity-doc.mjs
 * Output: docs/capacity/capacity-report.html and docs/capacity/KenganSocial_1000_Users_Readiness.pdf
 * PDF printing uses Chrome (CHROME_PATH, or the default Windows/Linux locations).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from './capacity-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs/capacity');
const htmlPath = path.join(outDir, 'capacity-report.html');
const pdfPath = path.join(outDir, 'KenganSocial_1000_Users_Readiness.pdf');

const r = run();
const R = (x) => `R${Math.round(x).toLocaleString('en-ZA').replace(/,/g, ' ')}`;
const pct = (x) => (x == null ? '–' : `${(x * 100).toFixed(1)}%`);
const min = (s) => (s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${(s / 60).toFixed(0)} min` : `${(s / 3600).toFixed(1)} h`);
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const plans = ['starter', 'creator_starter', 'creator_pro', 'agency', 'enterprise'];
const mixTyp = r.mix.typical;
const loadShort = (mixTyp.lambdaPerHour.short * mixTyp.serviceSec.short) / 3600;
const loadClips = (mixTyp.lambdaPerHour.clips * mixTyp.serviceSec.clips) / 3600;

function planTable(scenario) {
    const rows = plans.map((id) => {
        const p = r.perPlan[id];
        const e = p[scenario];
        const c = p[`${scenario}CloudStt`];
        const provider = sum(e.providers);
        const infra = sum(e.compute) + sum(e.fixed);
        return `<tr>
            <th>${esc(p.name)}<small>${p.price ? `${R(p.price)}/month` : 'free'}</small></th>
            <td>${R(e.revenue.net)}</td>
            <td>${R(e.revenue.fees)}</td>
            <td>${R(provider)}</td>
            <td>${R(infra)}</td>
            <td class="${e.profit < 0 ? 'neg' : 'pos'}">${R(e.profit)}</td>
            <td>${pct(e.margin)}</td>
            <td>${e.pools.short.servers} + ${e.pools.clips.servers}<small>${c.pools.clips.servers < e.pools.clips.servers ? `STT: ${e.pools.short.servers} + ${c.pools.clips.servers}` : ''}</small></td>
            <td>${min(e.timeToResult.short)} / ${e.pools.clips.servers ? min(e.timeToResult.clips) : '–'}<small>${e.pools.clips.servers ? `STT: ${min(c.timeToResult.clips)}` : ''}</small></td>
            <td>${e.storageTb.toFixed(1)} TB</td>
        </tr>`;
    });
    return `<table class="data">
        <thead><tr><th>Plan (1,000 users)</th><th>Revenue<small>ex VAT</small></th><th>Payfast fees</th><th>Providers<small>AI, voice, music, storage</small></th><th>Servers + fixed</th><th>Profit / month</th><th>Margin</th><th>Peak workers<small>renders + clips</small></th><th>Time to result<small>render / clip project</small></th><th>Storage</th></tr></thead>
        <tbody>${rows.join('')}</tbody></table>`;
}

function mixTable() {
    const rows = [
        ['Typical use (35%)', r.mix.typical],
        ['Typical, spot workers', r.mix.typicalSpot],
        ['Typical, cloud transcription', r.mix.typicalCloudStt],
        ['Full use (100%)', r.mix.full],
        ['Full, spot workers', r.mix.fullSpot],
        ['Full, cloud transcription', r.mix.fullCloudStt],
    ].map(([label, e]) => `<tr><th>${label}</th><td>${R(e.revenue.net)}</td><td>${R(e.revenue.fees + sum(e.providers))}</td><td>${R(sum(e.compute))}</td><td>${R(sum(e.fixed))}</td><td class="pos">${R(e.profit)}</td><td>${pct(e.margin)}</td><td>${e.pools.short.servers} + ${e.pools.clips.servers}</td><td>${min(e.timeToResult.short)} / ${min(e.timeToResult.clips)}</td></tr>`);
    return `<table class="data"><thead><tr><th>Mixed 1,000 users</th><th>Revenue<small>ex VAT</small></th><th>Fees + providers</th><th>Servers</th><th>Fixed</th><th>Profit / month</th><th>Margin</th><th>Peak workers</th><th>Time to result</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function costLines(e) {
    const lines = { 'Payfast fees': e.revenue.fees, ...e.providers, ...e.compute, ...e.fixed };
    return `<table class="data narrow"><tbody>${Object.entries(lines)
        .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${R(v)}</td></tr>`)
        .join('')}<tr class="total"><th>Total cost</th><td>${R(e.cost)}</td></tr><tr><th>Revenue (ex VAT)</th><td>${R(e.revenue.net)}</td></tr><tr class="total"><th>Profit</th><td>${R(e.profit)}</td></tr></tbody></table>`;
}

const check = (level, text, detail = '') => `<li><span class="box"></span><span class="lvl ${level.toLowerCase()}">${level}</span><div>${text}${detail ? `<small>${detail}</small>` : ''}</div></li>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>KenganSocial: ready for 1,000 users?</title>
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
.cover { padding: 8mm 0 4mm; border-bottom: 1px solid var(--line); margin-bottom: 10pt; }
.kicker { text-transform: uppercase; letter-spacing: .12em; font-size: 8pt; color: var(--accent); font-weight: 700; }
.verdict { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8pt; margin: 12pt 0; }
.verdict div { border: 1px solid var(--line); border-radius: 6pt; padding: 8pt 10pt; }
.verdict b { display: block; font-size: 15pt; line-height: 1.2; }
.verdict .no b { color: var(--bad); } .verdict .yes b { color: var(--good); }
table.data { width: 100%; border-collapse: collapse; margin: 6pt 0 10pt; font-size: 8.4pt; break-inside: avoid; }
table.data th, table.data td { border-bottom: 1px solid var(--line); padding: 4pt 5pt; text-align: right; vertical-align: top; }
table.data thead th { font-size: 7.6pt; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); border-bottom: 1.5px solid var(--ink); }
table.data th:first-child, table.data td:first-child { text-align: left; }
table.data tbody th { font-weight: 600; }
table.data.narrow { width: 62%; }
table.data tr.total th, table.data tr.total td { border-top: 1.5px solid var(--ink); font-weight: 700; }
td.pos { color: var(--good); font-weight: 600; } td.neg { color: var(--bad); font-weight: 600; }
.note { background: var(--soft); border-left: 3px solid var(--accent); padding: 7pt 10pt; margin: 8pt 0; break-inside: avoid; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12pt; }
ul.findings { padding-left: 14pt; margin: 4pt 0 8pt; } ul.findings li { margin-bottom: 4pt; }
code { font-family: Consolas, monospace; font-size: 8.4pt; background: var(--soft); padding: 0 2pt; border-radius: 2pt; }
ol.checklist { list-style: none; padding: 0; margin: 4pt 0 10pt; }
ol.checklist li { display: grid; grid-template-columns: 12pt 46pt 1fr; gap: 6pt; align-items: start; padding: 4pt 0; border-bottom: 1px solid var(--line); break-inside: avoid; }
.box { width: 10pt; height: 10pt; border: 1.2px solid var(--ink); border-radius: 2pt; margin-top: 2pt; }
.lvl { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; border-radius: 3pt; padding: 1pt 4pt; text-align: center; margin-top: 1pt; }
.lvl.must { background: #fde8e6; color: var(--bad); } .lvl.scale { background: #fff1e0; color: #a3530a; } .lvl.soon { background: #e8f1ff; color: #1f4f99; }
.pagebreak { break-before: page; }
footer { margin-top: 18pt; font-size: 8pt; color: var(--muted); border-top: 1px solid var(--line); padding-top: 6pt; }
</style></head><body>

<section class="cover">
  <div class="kicker">KenganSocial · MiraiStack · Readiness report</div>
  <h1>Ready for 1,000 users?</h1>
  <p>End-to-end test, capacity model for 1,000 users on each plan and on a realistic mix, the cost to run it and the profit, and the deployment checklist. Prepared 23 October 2026 from commit <code>3304938</code> plus local changes.</p>
  <div class="verdict">
    <div class="no"><b>Not yet</b>Today one server renders one video and one clip project at a time. At 1,000 users the queues grow faster than they empty during busy hours.</div>
    <div class="yes"><b>${R(r.mix.typical.profit)}/month</b>profit for a typical mix of 1,000 users (${pct(r.mix.typical.margin)} margin); ${R(r.mix.full.profit)} if everyone uses 100% of their plan.</div>
    <div class="yes"><b>~${r.breakEven.paidUsers} paying users</b>cover the fixed and base server costs (${R(r.breakEven.fixedBase)}/month) at the mix below.</div>
  </div>
  <p><b>What it takes:</b> move clip projects and video renders off the API into a pool of worker machines that grows and shrinks with demand (about ${r.mix.typical.pools.short.servers + r.mix.typical.pools.clips.servers} workers at the busiest hour for a typical mix, up to ${r.mix.full.pools.short.servers + r.mix.full.pools.clips.servers} at full use), keep files in Cloud Storage instead of on the server's disk, and transcribe long videos with a speech API or GPU. The API itself already handles 1,000 users with room to spare. The remaining security, payment and approval items are in the checklist.</p>
</section>

<h2>1. What was tested end to end</h2>
<table class="data">
<thead><tr><th>Test (this laptop: i5-12500H, 16 threads)</th><th>Result</th><th>On one 4-vCPU cloud worker</th></tr></thead>
<tbody>
<tr><th>Clip project: 8-minute podcast → transcribe, find moments with AI, render 5 captioned shorts</th><td>${r.MEASURED.clip8min.wall} s, ${r.MEASURED.clip8min.cpu} CPU-seconds</td><td>≈ ${min(r.CLIP_CALIBRATION.measured)} (model predicted ${min(r.CLIP_CALIBRATION.modelled)})</td></tr>
<tr><th>3D product ad, 15 s vertical, voiceover + effects</th><td>${r.MEASURED.productAd15.wall} s, ${r.MEASURED.productAd15.cpu} CPU-s</td><td>≈ ${min(Math.max(r.MEASURED.productAd15.wall, (r.MEASURED.productAd15.cpu * 1.2) / 4))}</td></tr>
<tr><th>3D product ad, 25 s landscape</th><td>${r.MEASURED.productAd25.wall} s, ${r.MEASURED.productAd25.cpu} CPU-s</td><td>≈ ${min(r.SERVICE.render.typical)}</td></tr>
<tr><th>Launch video, 20 s (first render in a process)</th><td>${r.MEASURED.launch20.wall} s, ${r.MEASURED.launch20.cpu} CPU-s</td><td>includes ~35 s render-bundle build and an AI provider failing over</td></tr>
<tr><th>YouTube link → video file (yt-dlp)</th><td>Pass</td><td>19 s test video downloaded</td></tr>
<tr><th>API load: dashboard requests, 50 users at once</th><td>${r.MEASURED.apiDashboardRps} requests/s, p95 441 ms, 0 errors</td><td>1,000 users need ~${r.mix.typical.apiLoad.peakRps} requests/s at peak</td></tr>
<tr><th>API load: 100 users at once</th><td>196 requests/s, p95 ${r.MEASURED.apiDashboardP95At100} ms, 0 errors</td><td>Slower but correct; add a second API only after the scheduler is split out</td></tr>
<tr><th>API load: light endpoint, 200 users at once</th><td>6,018 requests/s, p95 48 ms</td><td>Express itself is not the limit; Firestore round trips are</td></tr>
<tr><th>Automated tests (video ads, security, client lint)</th><td>Pass</td><td>Video ads 13 + routes 1; client lint clean</td></tr>
</tbody></table>
<p class="note"><b>Not tested here</b> (needs the real servers): Payfast checkout and renewals, posting to live social accounts, a full restore from backup, and a load test with real separate users from many locations. These are in the checklist.</p>

<h2>2. Can it house 1,000 users today?</h2>
<div class="grid2">
<div>
<h3>What already scales</h3>
<ul class="findings">
<li><b>API:</b> one process served ${r.MEASURED.apiDashboardRps} dashboard requests per second; 1,000 users need about ${r.mix.typical.apiLoad.peakRps} (20% online at peak, one request every 5 s). About 5× headroom.</li>
<li><b>Database:</b> Firestore scales on its own; costs are per read and write (counted in the model).</li>
<li><b>Accounts and workspaces:</b> every request is scoped to a workspace; 1,000 workspaces are not a storage problem.</li>
<li><b>Pricing:</b> every paid plan stays above 60% margin at full use (this report confirms 67–85% with a real fleet).</li>
</ul>
</div>
<div>
<h3>What breaks at 1,000 users</h3>
<ul class="findings">
<li><b>One clip project at a time</b> for the whole app (<code>server/src/routes/clips.ts:72</code>). A typical mix sends ${loadClips.toFixed(1)}× more clip work in the busiest hour than one queue can finish.</li>
<li><b>One video render at a time</b> (launch, tutorial, product ads, carousels: <code>chrome-queue.js</code>, <code>routes/brag.ts:20</code>). Peak load ${loadShort.toFixed(1)}× one worker.</li>
<li><b>Video service fixed at 3 jobs</b> (<code>python-service/main.py:63</code>) and shares a folder on the same machine with the API.</li>
<li><b>Long Agency videos on CPU:</b> a 120-minute source with the medium speech model takes over 2 hours on one worker.</li>
</ul>
</div>
</div>
<h3>Other gaps found during the test</h3>
<ul class="findings">
<li><b>Files on the server's disk:</b> render scratch files, the video-ad cache (<code>server/.cache/video-ads</code>) and the upload registry live on the VM. Workers on other machines need Cloud Storage. At full use 1,000 Agency users could store ${r.perPlan.agency.full.storageTb.toFixed(0)} TB.</li>
<li><b>Rate limit per IP address</b> (fixed 24 October): now per signed-in user in Redis, with a higher per-IP ceiling.</li>
<li><b>Render bundle built on first use:</b> the first video after a restart waits ~35 s longer. Build it into the Docker image.</li>
<li><b>AI providers:</b> the OpenRouter key is empty on this machine and a Gemini request failed during the launch-video test before another provider took over. Production needs two working AI providers and an alert when one fails.</li>
<li><b>Scheduler inside the API:</b> posting, webhooks and workers run in the one API process, so a second API copy would double-post. Fine for 1,000 users, but it is a single point of failure: split the scheduler into its own process first.</li>
<li><b>Voice and music accounts:</b> ElevenLabs is on the free tier (10,000 characters, about 27 ads). A typical mix needs ~${Math.round(r.mix.typical.elevenChars / 1000).toLocaleString('en-ZA')}k characters and ~${Math.round(r.mix.typical.trebloTracks).toLocaleString('en-ZA')} Treblo tracks a month.</li>
</ul>

<h2 class="pagebreak">3. 1,000 users on each plan</h2>
<p>Each row is a separate test: 1,000 customers all on that plan. <b>Typical</b> means they use 35% of every allowance; <b>full</b> means 100% (the worst case the prices are built for). Revenue is the monthly list price without VAT; costs include Payfast fees, AI, voice, music, transcription, storage, Firestore, the worker fleet sized for the busiest hour, the API server, hosting, backups and licences. Exchange rate R${r.ECON.usdZar}/US$, with VAT on imported services and a 20% buffer on provider prices.</p>
<h3>Typical use (35% of allowances)</h3>
${planTable('typical')}
<h3>Full use (100% of allowances)</h3>
${planTable('full')}
<p class="note"><b>Reading the table:</b> “STT” shows the same plan with cloud transcription (speech API) for clip projects. “Peak workers” is the number of 4-vCPU worker machines needed in the busiest hour so that 95% of renders start within ${r.TARGETS.short.seconds} s and 90% of clip projects start within ${r.TARGETS.clips.seconds / 60} min. Workers shut down when idle; the cost column pays for busy time (60% average utilisation) with at least one worker per queue always on. Free users cost ${R(r.perPlan.starter.typical.cost / 1000)}–${R(r.perPlan.starter.full.cost / 1000)} each per month including the base servers. Enterprise is priced from the Agency allowances.</p>

<h2>4. A realistic mix of 1,000 users</h2>
<p>Assumed mix: ${r.mix.population.map((p) => `${p.users} ${esc(p.name)}`).join(', ')}.</p>
${mixTable()}
<div class="grid2">
<div><h3>Monthly cost, typical use</h3>${costLines(r.mix.typical)}</div>
<div><h3>Monthly cost, full use</h3>${costLines(r.mix.full)}</div>
</div>
<p class="note"><b>Cloud transcription</b> (a speech API at US$0.006/min instead of Whisper on the worker's CPU) costs slightly more but cuts clip workers at peak from ${r.mix.typical.pools.clips.servers} to ${r.mix.typicalCloudStt.pools.clips.servers} (typical) and Agency clip projects from ${min(r.perPlan.agency.typical.timeToResult.clips)} to ${min(r.perPlan.agency.typicalCloudStt.timeToResult.clips)}. Recommended for Creator Pro and Agency. <b>Spot workers</b> (interruptible VMs, ~35% of the price; check availability in Johannesburg) save ${R(r.mix.full.cost - r.mix.fullSpot.cost)} a month at full use.</p>

<h2 class="pagebreak">5. Target setup for 1,000 users</h2>
<table class="data">
<thead><tr><th>Part</th><th>Today</th><th>For 1,000 users</th></tr></thead>
<tbody>
<tr><th>API</th><td>One container on one VM, also runs the scheduler, webhooks and renders</td><td>One API VM (e2-standard-4) serving requests only; scheduler in its own single process</td></tr>
<tr><th>Clip projects</th><td>One at a time, in the API</td><td>Durable job queue (BullMQ on Redis, already used for posts and AI edits) and a clip worker pool, ${r.mix.typical.pools.clips.servers}–${r.mix.full.pools.clips.servers} at peak, scaling to zero spare</td></tr>
<tr><th>Video renders</th><td>One at a time per API process</td><td>Render worker pool, ${r.mix.typical.pools.short.servers}–${r.mix.full.pools.short.servers} at peak; render bundle built into the image</td></tr>
<tr><th>Transcription</th><td>Whisper on CPU in the video service</td><td>Speech API (or a GPU worker) for sources over 20 minutes; CPU Whisper for short ones</td></tr>
<tr><th>Files</th><td>Shared folder on the VM's disk</td><td>Cloud Storage (Firebase bucket) for uploads, sources and outputs; workers keep only scratch files; lifecycle rules delete expired renders</td></tr>
<tr><th>Rate limits</th><td>Per IP, in memory</td><td>Per user, in Redis</td></tr>
<tr><th>Monitoring</th><td>Container logs</td><td>Uptime check on <code>/api/health/ready</code>, queue length and wait-time alerts, error tracking</td></tr>
</tbody></table>

<h2>6. Deployment checklist</h2>
<p><span class="lvl must">Must</span> blocks launch to paying users. <span class="lvl scale">Scale</span> is needed before ~100 active users (single queues get slow). <span class="lvl soon">Soon</span> can follow in the first weeks.</p>

<h3>A. Code changes for 1,000 users</h3>
<ol class="checklist">
${check('Scale', 'Run clip projects through a durable queue (BullMQ) with separate worker processes; remove the one-at-a-time queue in <code>routes/clips.ts</code>.', 'Acceptance: 20 clip projects submitted at once finish in parallel across workers; a restarted worker resumes or fails the job cleanly with a refund.')}
${check('Scale', 'Move launch/tutorial videos, product ads and carousels to render workers; keep Chrome off the API process.', 'Acceptance: the API stays under 500 ms p95 while 10 renders run.')}
${check('Scale', '<s>Make the video service concurrency configurable</s> Done 24 Oct: <code>MAX_CONCURRENT_JOBS</code> (set 1 on a dedicated worker VM).')}
${check('Scale', 'Store uploads, clip sources and outputs in Cloud Storage; workers download to scratch disk and upload results. Move the video-ad cache and upload registry off the VM disk.')}
${check('Scale', 'Transcribe long sources with a speech API or GPU worker; keep CPU Whisper for short videos.', 'Agency 120-minute sources drop from ~2.4 h to ~25 min end to end.')}
${check('Scale', 'Split posting, webhooks and token refresh into one scheduler process, so the API can run more than one copy.')}
${check('Scale', '<s>Rate-limit per signed-in user in Redis</s> Done 24 Oct: per user (1,000 per 15 min) plus a per-IP ceiling (10,000), shared through Redis.')}
${check('Soon', 'Build the Remotion bundle and the Whisper model into the Docker images.')}
${check('Soon', 'Render the 10 clips of a project in parallel across workers (full-use clip projects are mostly render time).')}
</ol>

<h3>B. Security and billing (from the 23 October evaluation, still open)</h3>
<ol class="checklist">
${check('Must', 'Private media: stop serving uploads anonymously by URL; use signed, expiring links.', 'Listed as the remaining security blocker in DEPLOYMENT_FIX_PROGRESS.')}
${check('Must', 'Payfast sandbox on the live server: subscribe, renew, failed payment, cancel; then one real payment and refund.')}
${check('Must', 'Replace the Firebase service-account key that was pasted in chat; rotate the ElevenLabs and Treblo keys pasted in chat today.')}
${check('Must', 'Production settings: <code>NODE_ENV=production</code>, no <code>DEV_PLAN_OVERRIDE</code>, real <code>SERVER_URL</code>/<code>CLIENT_URL</code>, <code>TOKEN_ENCRYPTION_KEY</code>, <code>FREE_CLIP_SECRET</code>, Meta webhook secrets.')}
${check('Soon', 'Run the containers as a non-root user; set memory limits per container.')}
</ol>

<h3>C. Servers and accounts</h3>
<ol class="checklist">
${check('Must', 'Re-open Google Cloud billing for <code>kengansocialv2</code>; create the API VM and point <code>api.kengansocial.co.za</code> at it.')}
${check('Must', 'Web app hosting for <code>kengansocial.co.za</code> (new Vercel project or served from the VM).')}
${check('Must', 'Deploy Firestore rules and indexes and Storage rules; Firestore on the pay-as-you-go plan.')}
${check('Scale', `Worker instance template + autoscaling group (e2-standard-4, 150 GB disk) for clip and render queues; start with ${r.mix.typical.pools.short.servers + r.mix.typical.pools.clips.servers} max and raise with demand. Check spot VM availability in africa-south1.`)}
${check('Must', `AI: two working providers (OpenRouter and Gemini) with billing; budget ~${R(r.mix.typical.providers['AI credits'])}/month for a typical mix.`)}
${check('Must', `ElevenLabs paid plan sized for ~${Math.round(r.mix.typical.elevenChars / 1000).toLocaleString('en-ZA')}k–${Math.round(r.mix.full.elevenChars / 1000).toLocaleString('en-ZA')}k characters/month; Treblo credits for ~${Math.round(r.mix.typical.trebloTracks).toLocaleString('en-ZA')}–${Math.round(r.mix.full.trebloTracks).toLocaleString('en-ZA')} tracks/month.`)}
${check('Must', 'Remotion company licence (rendering is a commercial use).')}
${check('Must', 'Mailboxes: billing@, support@, privacy@kengansocial.co.za receive mail.')}
</ol>

<h3>D. Platforms and legal</h3>
<ol class="checklist">
${check('Must', 'Meta app review (Advanced Access, business verification); webhooks subscribed; Business Suite auto-replies off.')}
${check('Must', 'TikTok and YouTube app approval. The YouTube-link import is on: keep the ownership confirmation, and consider switching it off during the reviews.')}
${check('Must', 'POPIA: register the Information Officer; review the Privacy Policy and Terms (Payfast, renewal) with someone qualified.')}
</ol>

<h3>E. Prove it on staging before inviting users</h3>
<ol class="checklist">
${check('Must', 'Run <code>node scripts/check-deploy.mjs</code> against the real domains; sign up two workspaces and test cross-workspace denial.')}
${check('Must', 'Load test on staging: 1,000 simulated users (k6 or autocannon from several machines), plus 50 clip projects and 50 renders submitted in one hour. Target: dashboard p95 under 1 s, render wait p95 under 60 s, clip wait p90 under 5 min.')}
${check('Must', 'Backups: scheduled Firestore exports and disk snapshots; restore into a separate project and time it.')}
${check('Must', 'Monitoring: uptime on <code>/api/health/ready</code>, alerts on queue wait, failed jobs, AI provider errors and disk space.')}
${check('Soon', 'Measure job times on the real workers and update <code>scripts/capacity-model.mjs</code> and <code>scripts/pricing-model.mjs</code>; rebuild this report.')}
</ol>

<h2>7. How the numbers were made</h2>
<ul class="findings">
<li>Job times were measured on this laptop on 23 October 2026 and converted to a 4-vCPU worker: the larger of the measured time and CPU-seconds × 1.2 ÷ 4. The clip-project formula in the pricing model matched the measurement within 10%.</li>
<li>Typical use = 35% of each allowance; full use = 100%. Typical clip sources are half the plan's maximum length; full use takes the maximum, 10 clips of 60 s.</li>
<li>Busiest hour = 2× the average working hour (22 days × 10 hours). Worker counts use a standard queueing formula (Erlang C) for the wait targets above.</li>
<li>Prices: monthly list prices including VAT; Payfast 3.2% + R2 plus VAT on the fee; provider prices from <code>scripts/pricing-model.mjs</code> with VAT on imported services and a 20% buffer; e2-standard-4 at US$140/month; spot at 35% of that (estimate).</li>
<li>Annual billing (10% off) lowers revenue by 10%; every paid plan stays above 60% margin on annual prices at full use (pricing model).</li>
<li>Re-run: <code>node scripts/capacity-model.mjs</code> and <code>node scripts/build-capacity-doc.mjs</code>.</li>
</ul>
<footer>KenganSocial is operated by MiraiStack (registration K2025971590). Figures are estimates for planning; confirm provider prices and measure on the real servers before relying on them.</footer>
</body></html>`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(htmlPath, html);
console.log('wrote', path.relative(root, htmlPath));

const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
if (chrome) {
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdfPath}`, `file:///${htmlPath.replace(/\\/g, '/')}`], { stdio: 'ignore' });
    console.log('wrote', path.relative(root, pdfPath));
} else {
    console.log('Chrome not found: open the HTML file and print it to PDF.');
}
