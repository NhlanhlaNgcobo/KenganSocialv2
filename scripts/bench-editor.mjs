#!/usr/bin/env node
/**
 * Repeatable editor preview benchmark (docs/performance-baseline.md).
 *
 * Signs in a temporary test account, opens the editor with diagnostics on (?perf=1), loads local
 * test media through the editor's own media store, and measures each scenario with
 * window.__kePerf (presented FPS, dropped frames, long tasks, seek latency, React renders, heap).
 * The test account and its workspace are deleted afterwards.
 *
 * Run from server/ (it uses the server's Firebase Admin setup for clean-up):
 *   npx tsx ../scripts/bench-editor.mjs --media <dir with h264_1080p.mp4, h264_4k.mp4, music.m4a>
 *        [--label baseline] [--out results.json] [--preview legacy|v2] [--cpu-throttle 4] [--url http://localhost:5173] [--api http://localhost:5000/api]
 *        [--browser "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"] [--headful]
 *        [--cpu-throttle 4]   (DevTools CPU slowdown, to emulate a mid-range or low-end device)
 *
 * Make test media with FFmpeg (see docs/performance-baseline.md). Headless runs decode video in
 * software; pass --browser and --headful to measure with the machine's GPU decoder.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : acc), [])
);
const APP = args.url || 'http://localhost:5173';
const API = args.api || 'http://localhost:5000/api';
const MEDIA = args.media;
const LABEL = args.label || 'run';
const OUT = args.out || `bench-${LABEL}.json`;
if (!MEDIA) {
    console.error('Usage: npx tsx ../scripts/bench-editor.mjs --media <dir> [--label name] [--out file]');
    process.exit(1);
}
const file = (n) => path.resolve(MEDIA, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const r = createRequire(path.resolve('package.json'));
r('dotenv').config();
const puppeteer = r('puppeteer-core');
const { ensureBrowser } = r('@remotion/renderer');
await import(pathToFileURL(path.resolve('src/config/firebase.js')).href);
const { getAuth } = await import(pathToFileURL(r.resolve('firebase-admin/auth')).href);
const { getFirestore } = await import(pathToFileURL(r.resolve('firebase-admin/firestore')).href);
const env = Object.fromEntries(fs.readFileSync(path.resolve('../client/.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

// ── Temporary account ────────────────────────────────────────────────────────────────────────
const email = `probe-bench-${Date.now()}@example.com`;
const password = 'Probe-pass-12345';
const su = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${env.VITE_FIREBASE_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) })).json();
const auth = { Authorization: `Bearer ${su.idToken}`, 'Content-Type': 'application/json' };
const profile = await (await fetch(`${API}/auth/profile`, { method: 'POST', headers: auth, body: JSON.stringify({ displayName: 'Bench' }) })).json();
await fetch(`${API}/auth/onboarding`, { method: 'POST', headers: auth, body: JSON.stringify({ complete: true, fullName: 'Bench', workspaceName: 'Bench', popiaConsent: true }) });

const executablePath = args.browser || (await ensureBrowser()).path;
const browser = await puppeteer.launch({ executablePath, headless: !args.headful, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--window-size=1440,900'], timeout: 180000, protocolTimeout: 600000 });
const CPU_THROTTLE = Number(args['cpu-throttle']) || 1;
const PREVIEW = args.preview === 'v2' ? 'v2' : 'legacy'; // preview engine under test (?preview=)
const results = { label: LABEL, at: new Date().toISOString(), browser: executablePath.split(/[\\/]/).pop(), headless: !args.headful, cpuThrottle: CPU_THROTTLE, preview: PREVIEW, app: APP, scenarios: {} };

try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(180000);
    await page.setViewport({ width: 1440, height: 900 });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    // Sign in through the real UI.
    await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[type="email"]');
    await page.type('input[type="email"]', email);
    await page.type('input[type="password"]', password);
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(3000);
    if (page.url().includes('/consent')) {
        await page.evaluate(() => document.querySelectorAll('input[type="checkbox"]').forEach((c) => !c.checked && c.click()));
        await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('#consent-accept')]);
        await sleep(2000);
    }

    if (CPU_THROTTLE > 1) {
        const cdp = await page.createCDPSession();
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
    }
    await page.goto(`${APP}/editor?perf=1&preview=${PREVIEW}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__keBench && window.__kePerf && window.__keBench.project.getState().projectKey, { timeout: 180000 });
    await sleep(2000);
    await page.keyboard.press('Escape');

    results.device = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        return {
            userAgent: navigator.userAgent,
            cores: navigator.hardwareConcurrency,
            deviceMemoryGB: navigator.deviceMemory ?? null,
            gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
            webCodecs: typeof window.VideoDecoder === 'function',
            rvfc: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
        };
    });

    // Load the test media through the editor's media store (as an import would).
    await page.evaluate(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.id = 'bench-files';
        input.style.display = 'none';
        document.body.appendChild(input);
    });
    const input = await page.$('#bench-files');
    await input.uploadFile(file('h264_1080p.mp4'), file('h264_4k.mp4'), file('music.m4a'));
    const loaded = await page.evaluate(async () => {
        const B = window.__keBench;
        const files = [...document.getElementById('bench-files').files];
        const items = await B.media.getState().addFiles(files, B.project.getState().projectKey);
        window.__benchItems = Object.fromEntries(items.map((i) => [i.name, i.id]));
        return items.map((i) => ({ name: i.name, type: i.type, duration: i.duration, width: i.width, height: i.height }));
    });
    results.media = loaded;

    const scenario = async (name, setup, run) => {
        await page.evaluate(() => {
            const B = window.__keBench;
            B.playback.getState().pause();
            B.timeline.getState().clearTimeline();
            B.playback.getState().seek(0);
        });
        await page.evaluate(setup);
        await sleep(2500); // media loads, first frame decodes
        const out = await run();
        results.scenarios[name] = out;
        console.log(`${name}:`, JSON.stringify(out));
    };

    const item = (n) => `(() => { const B = window.__keBench; return B.media.getState().items.find((i) => i.id === window.__benchItems['${n}']); })()`;
    const play = (seconds) => async () => {
        await page.evaluate(() => {
            window.__kePerf.reset();
            window.__keBench.playback.getState().play();
        });
        await sleep(seconds * 1000);
        return page.evaluate(() => {
            window.__keBench.playback.getState().pause();
            const s = window.__kePerf.snapshot();
            s.playheadAdvanced = +window.__keBench.playback.getState().currentTime.toFixed(2);
            return s;
        });
    };

    // Warm-up (not recorded): the first playback pays for code loading, JIT and decoder start-up.
    await page.evaluate(new Function(`window.__keBench.timeline.getState().addMediaAtTime(${item('h264_1080p.mp4')}, 0);`));
    await sleep(2500);
    await play(4)();
    console.log('warm-up done');

    // 1. 1080p H.264, single clip, 8 s of playback.
    await scenario('1080p single clip (play 8 s)', new Function(`window.__keBench.timeline.getState().addMediaAtTime(${item('h264_1080p.mp4')}, 0);`), play(8));
    // 2. 4K H.264 scaled into the preview.
    await scenario('4K clip in preview (play 8 s)', new Function(`window.__keBench.timeline.getState().addMediaAtTime(${item('h264_4k.mp4')}, 0);`), play(8));
    // 3. Several tracks: video, music, 4 text layers.
    await scenario(
        'multi-track: video + music + 4 texts (play 8 s)',
        new Function(`const T = window.__keBench.timeline.getState();
            T.addMediaAtTime(${item('h264_1080p.mp4')}, 0);
            T.addMediaAtTime(${item('music.m4a')}, 0);
            for (let i = 0; i < 4; i++) window.__keBench.timeline.getState().addTextAtTime(i * 2, { content: 'Title ' + i });`),
        play(8)
    );
    // 4. Ten consecutive scrubs (paused), each waiting for the frame to show.
    await scenario('10 scrubs (1080p, paused)', new Function(`window.__keBench.timeline.getState().addMediaAtTime(${item('h264_1080p.mp4')}, 0);`), async () => {
        await page.evaluate(() => window.__kePerf.reset());
        const targets = [12.4, 3.1, 27.7, 8.8, 19.2, 0.6, 24.3, 15.5, 5.9, 21.1];
        for (const t of targets) {
            await page.evaluate((time) => window.__keBench.playback.getState().seek(time), t);
            await page.waitForFunction((n) => window.__kePerf.snapshot().seekMs.count >= n, { timeout: 5000 }, targets.indexOf(t) + 1).catch(() => {});
        }
        return page.evaluate(() => window.__kePerf.snapshot());
    });
    // 5. Repeated edits: 60 trims and 60 text changes, paused; heap before/after.
    await scenario(
        'repeated edits: 60 trims + 60 text edits',
        new Function(`const T = window.__keBench.timeline.getState();
            T.addMediaAtTime(${item('h264_1080p.mp4')}, 0);
            T.addTextAtTime(0, { content: 'Edit me' });`),
        async () => {
            const heapBefore = await page.evaluate(() => window.__kePerf.snapshot().heap);
            await page.evaluate(() => window.__kePerf.reset());
            const elapsed = await page.evaluate(async () => {
                const T = () => window.__keBench.timeline.getState();
                const frame = () => new Promise((res) => requestAnimationFrame(() => res()));
                const t0 = performance.now();
                for (let i = 0; i < 60; i++) {
                    const main = T().tracks.find((t) => t.isMain);
                    const clip = main.elements[0];
                    T().updateElementTrim(main.id, clip.id, (i % 10) * 0.2, clip.trimEnd);
                    await frame();
                    const text = T().tracks.find((t) => t.type === 'text');
                    T().updateElement(text.id, text.elements[0].id, { content: `Edit ${i}` });
                    await frame();
                }
                return performance.now() - t0;
            });
            const s = await page.evaluate(() => window.__kePerf.snapshot());
            s.editMsPer = +(elapsed / 120).toFixed(2);
            s.heapBefore = heapBefore;
            return s;
        }
    );
    // 6. Long project: the clip cut into 20 parts plus 300 caption phrases, 8 s of playback.
    await scenario(
        'long project: 20 cuts + 300 captions (play 8 s)',
        new Function(`const T = () => window.__keBench.timeline.getState();
            T().addMediaAtTime(${item('h264_1080p.mp4')}, 0);
            for (let i = 1; i < 20; i++) T().splitAtPlayhead ? (window.__keBench.playback.getState().seek(i * 1.5), T().splitAtPlayhead(i * 1.5)) : null;
            const words = []; for (let i = 0; i < 900; i++) words.push({ text: 'word' + i, start: i * 0.033, end: i * 0.033 + 0.03 });
            T().addCaptions(words, Object.keys({ bold: 1 })[0]);
            window.__keBench.playback.getState().seek(0);`),
        play(8)
    );
    results.pageErrors = [...new Set(pageErrors)];
} finally {
    await browser.close();
    if (profile.workspace?.id) await getFirestore().recursiveDelete(getFirestore().collection('workspaces').doc(profile.workspace.id)).catch(() => {});
    await getFirestore().recursiveDelete(getFirestore().collection('users').doc(su.localId)).catch(() => {});
    await getAuth().deleteUser(su.localId).catch(() => {});
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUT}`);
process.exit(0);
