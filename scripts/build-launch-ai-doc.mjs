#!/usr/bin/env node
/**
 * 1,000 users with fewer AI features at launch: builds docs/capacity/launch-ai-report.html from
 * scripts/capacity-model.mjs (the PDF is printed from it).
 *   node scripts/build-launch-ai-doc.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_MODES, SCENARIOS, run } from './capacity-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs/capacity/launch-ai-report.html');
const r = run();
const R = (x) => `R${Math.round(x).toLocaleString('en-ZA')}`;
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const AI_LINES = ['AI credits', 'Clip AI (transcript ranking)', 'Voice, music, render licence', 'Cloud transcription'];
const aiSpend = (e) => AI_LINES.reduce((a, k) => a + (e.providers[k] || 0), 0);
const minutes = (s) => `${Math.max(1, Math.round(s / 60))} min`;
const modes = Object.keys(AI_MODES);
const mix = r.aiModes.mix;
const saving = (a, b) => `${Math.round((1 - b / a) * 100)}%`;

const features = [
    ['Lyrics: syncing to the vocals and AI song structure', 'lyricsAi', 'Paste lyrics: built-in timing and structure; Place automatically / Tap along'],
    ['Paid AI images (carousels, thumbnail backgrounds, AI Writer)', 'aiImages', 'Free images (Pollinations) and real video frames'],
    ['AI voiceover in video ads (ElevenLabs)', 'voiceover', 'Ads with music and sound effects, no voice'],
    ['AI-composed music (Treblo)', 'aiMusic', 'Free music library, matched to the mood'],
    ['Cloud transcription for long clip videos', 'cloudTranscription', 'Kept ON at launch (see section 3)'],
    ['Live web search for trending (Perplexity)', 'trendingSearch', 'Trending from YouTube and TikTok data and cached ideas'],
    ['AI reply drafts for DMs and lead outreach', 'dmDrafts', 'Keyword auto-replies; outreach from a template'],
    ['AI Edit learning a style from a reference', 'styleLearning', 'Built-in edit presets'],
    ['AI business profile from a website', 'websiteAi', 'Colours, fonts, logo and copy still read from the site'],
    ['AI thumbnail headline ideas', 'thumbnailHeadlines', 'Headlines built from the clip’s own words'],
    ['AI storyboards for launch and tutorial videos', 'storyboardAi', 'Storyboards built from the site and its pages'],
];

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>1,000 users at launch with fewer AI features</title>
<style>
@page { size: A4; margin: 15mm 14mm 16mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", Arial, sans-serif; color: #15171c; font-size: 9.8pt; line-height: 1.45; margin: 0; }
h1 { font-size: 20pt; margin: 0 0 1mm; }
h2 { font-size: 13pt; margin: 7mm 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid #d4d7dd; break-after: avoid; }
p { margin: 0 0 2.2mm; }
.sub { color: #555b66; margin-bottom: 5mm; }
.box { background: #f3f4f6; border-left: 3px solid #15171c; padding: 3mm 4mm; margin: 2mm 0 3mm; }
table { width: 100%; border-collapse: collapse; margin: 1.5mm 0 3mm; break-inside: avoid; font-size: 9pt; }
th, td { padding: 1.4mm 2mm; border-bottom: 1px solid #e4e6ea; text-align: right; vertical-align: top; }
th:first-child, td:first-child, .l { text-align: left; }
th { background: #f6f7f9; font-weight: 600; }
.good { color: #116b3a; font-weight: 600; } .warn { color: #a3221b; font-weight: 600; }
code { font-family: Consolas, monospace; font-size: 8.6pt; background: #f1f2f4; padding: 0 1mm; border-radius: 1mm; }
ul { margin: 0 0 2.5mm; padding-left: 5mm; } li { margin-bottom: 1mm; }
.small { font-size: 8.4pt; color: #555b66; }
</style></head><body>
<h1>1,000 users at launch with fewer AI features</h1>
<p class="sub">KenganSocial · 26 October 2026 · from <code>scripts/capacity-model.mjs</code> (prices and limits from <code>scripts/pricing-model.mjs</code>). Re-run <code>node scripts/build-launch-ai-doc.mjs</code> after changes.</p>

<div class="box"><b>Recommendation: launch with the core AI plus cloud transcription</b> (<code>LAUNCH_AI_FEATURES=cloudTranscription</code>, also the default when the setting is left out). For 1,000 users at typical use this cuts AI API spend from <b>${R(aiSpend(mix.all.typical))}</b> to <b>${R(aiSpend(mix.launchStt.typical))}</b> a month (${saving(aiSpend(mix.all.typical), aiSpend(mix.launchStt.typical))} less), keeps clips arriving in about ${minutes(mix.launchStt.typical.timeToResult.clips)}, and needs no extra servers. Switching cloud transcription off too saves a further ${R(aiSpend(mix.launchStt.typical) - aiSpend(mix.launch.typical))} but makes long-video clips take ~${minutes(mix.launch.typical.timeToResult.clips)} at the busiest hour and needs ${mix.launch.typical.pools.clips.servers} clip servers instead of ${mix.launchStt.typical.pools.clips.servers}.</div>

<h2>1. The 1,000 users</h2>
<table><tr><th>Plan</th><th>Users</th><th>Price</th></tr>
${r.mix.population.map((p) => `<tr><td>${p.name}</td><td>${p.users}</td><td>${p.price ? R(p.price) : 'Free'}</td></tr>`).join('')}
</table>
<p class="small">"Typical use" = customers use ${Math.round(SCENARIOS.typical * 100)}% of their allowances; "full use" = 100% of every allowance (the worst case). Busiest hour = 2× the average working-hour load.</p>

<h2>2. AI modes compared (realistic mix, per month)</h2>
<table>
<tr><th>Mode</th><th>Use</th><th>AI API spend</th><th>All costs</th><th>Profit</th><th>Margin</th><th>Clip servers at peak</th><th>Clips ready in</th></tr>
${modes.flatMap((m) => Object.keys(SCENARIOS).map((s) => {
    const e = mix[m][s];
    return `<tr><td class="l">${AI_MODES[m].label}</td><td>${s}</td><td>${R(aiSpend(e))}</td><td>${R(e.cost)}</td><td>${R(e.profit)}</td><td>${pct(e.margin)}</td><td>${e.pools.clips.servers}</td><td class="${e.timeToResult.clips > 900 ? 'warn' : ''}">${minutes(e.timeToResult.clips)}</td></tr>`;
})).join('')}
</table>
<p class="small">Revenue is the same in every mode (${R(mix.all.typical.revenue.net)} a month net of VAT): switched-off features have non-AI versions, so plans and prices don't change. "Clips ready in" is processing plus the average wait at the busiest hour.</p>

<h2>3. Where the AI money goes (typical use)</h2>
<table>
<tr><th>Cost line</th>${modes.map((m) => `<th>${AI_MODES[m].label}</th>`).join('')}</tr>
${[...new Set(modes.flatMap((m) => Object.keys(mix[m].typical.providers)))].map((k) => `<tr><td class="l">${k}${AI_LINES.includes(k) ? ' <span class="small">(AI)</span>' : ''}</td>${modes.map((m) => `<td>${R(mix[m].typical.providers[k] || 0)}</td>`).join('')}</tr>`).join('')}
<tr><td class="l">Servers (workers, API, web)</td>${modes.map((m) => `<td>${R(sum(mix[m].typical.compute))}</td>`).join('')}</tr>
<tr><td class="l">Payfast fees</td>${modes.map((m) => `<td>${R(mix[m].typical.revenue.fees)}</td>`).join('')}</tr>
<tr><td class="l">Fixed (licence, backups, domain)</td>${modes.map((m) => `<td>${R(sum(mix[m].typical.fixed))}</td>`).join('')}</tr>
<tr><td class="l"><b>Total</b></td>${modes.map((m) => `<td><b>${R(mix[m].typical.cost)}</b></td>`).join('')}</tr>
</table>
<ul>
<li><b>AI credits</b> cost less per credit in launch mode because credits can only buy text (~$0.006 a credit) instead of images, lyrics and website analysis (~$0.009 a credit on average).</li>
<li><b>Voice, music and render licence</b> drops to the Remotion licence fee alone: no ElevenLabs voice, no Treblo track, no AI storyboard.</li>
<li><b>Clip AI</b> (ranking moments in the transcript) is the core product and stays the same in every mode.</li>
<li><b>Cloud transcription</b> is the one optional feature worth keeping: without it, long videos are transcribed on our own servers, which costs little in money but a lot in waiting time at busy hours.</li>
</ul>

<h2>4. Worst case: every customer uses 100% of their allowance</h2>
<table>
<tr><th>Mode</th><th>AI API spend</th><th>All costs</th><th>Margin</th><th>Servers at peak (short jobs + clips)</th><th>Clips ready in</th></tr>
${modes.map((m) => { const e = mix[m].full; return `<tr><td class="l">${AI_MODES[m].label}</td><td>${R(aiSpend(e))}</td><td>${R(e.cost)}</td><td>${pct(e.margin)}</td><td>${e.pools.short.servers} + ${e.pools.clips.servers}</td><td>${minutes(e.timeToResult.clips)}</td></tr>`; }).join('')}
</table>
<p class="small">At 100% use the AI credits line is the same in every mode: a full allowance can be spent on text alone, and each credit is costed at its worst case. The saving then comes from voice, music, storyboards and cloud transcription.</p>

<h2>5. Per plan: 1,000 users on one plan (typical use)</h2>
<table>
<tr><th>Plan</th>${modes.map((m) => `<th>${AI_MODES[m].label}<br><span class="small">AI spend · margin</span></th>`).join('')}</tr>
${Object.values(r.aiModes.perPlan).map((p) => `<tr><td>${p.name}</td>${modes.map((m) => `<td>${R(aiSpend(p[m]))} · ${pct(p[m].margin)}</td>`).join('')}</tr>`).join('')}
</table>

<h2>6. What is switched off at launch, and what users get instead</h2>
<table>
<tr><th>Feature</th><th class="l">Setting name</th><th class="l">Instead</th></tr>
${features.map(([f, id, alt]) => `<tr><td>${f}</td><td class="l"><code>${id}</code></td><td class="l">${alt}</td></tr>`).join('')}
</table>
<p>Always on: clip finding, captions, hooks, hashtags and the AI Writer's text. Turn a feature back on by adding its name to <code>LAUNCH_AI_FEATURES</code> in <code>server/.env</code> (comma-separated, or <code>all</code>) and restarting the API; the API logs which optional features are on at start-up. Asking for a feature that is off returns "coming soon" with the non-AI way to do it.</p>

<h2>7. Notes</h2>
<ul>
<li>The plan limits and the 60% margin guarantee (pricing model) are unchanged; switching features off only lowers costs.</li>
<li>Typical credit costs are estimates from token sizes; the real figures will come from provider dashboards in the first month. Turn features back on one at a time and watch the spend.</li>
<li>Server numbers come from jobs measured on a laptop and converted to e2-standard-4 workers; time a few real jobs on the VM to confirm.</li>
</ul>
</body></html>`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(root, out)}`);
