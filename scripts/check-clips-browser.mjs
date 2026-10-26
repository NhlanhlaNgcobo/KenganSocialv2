// Verify an existing test project in the real local app; uses a transient owner session.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'server/package.json'));
const puppeteer = require('puppeteer-core');
process.chdir(path.join(root, 'server'));
const { getFirestore, getAuth } = await import('../server/src/config/firebase.js');
const { id, out } = JSON.parse(await fs.readFile(path.join(root, 'output/clips-e2e/latest.json'), 'utf8'));
const project = (await getFirestore().collection('clip_projects').doc(id).get()).data();
const customToken = await getAuth().createCustomToken(project.userId);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--mute-audio'], defaultViewport: { width: 1440, height: 1000 } });
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle2' });
    await page.evaluate(async ({ customToken, workspaceId }) => {
        localStorage.setItem('kengan_current_workspace_id', workspaceId);
        const source = await (await fetch('/src/lib/firebase.js')).text();
        const authModule = source.match(/from\s+["']([^"']*firebase_auth[^"']*)["']/)?.[1];
        if (!authModule) throw new Error('Firebase auth module was not found in the dev bundle');
        const { signInWithCustomToken } = await import(authModule);
        const { auth } = await import('/src/lib/firebase.js');
        await signInWithCustomToken(auth, customToken);
    }, { customToken, workspaceId: project.workspaceId });
    await page.goto(`http://localhost:5173/dashboard/clips?project=${id}`, { waitUntil: 'networkidle2' });
    console.log('Signed in; waiting for five completed clip cards.');
    await page.waitForFunction(() => document.querySelectorAll('.clip-card').length === 5 && !document.querySelector('.clips-progress'), { timeout: 60000 });
    await page.screenshot({ path: path.join(out, 'browser-clips.png'), fullPage: true });
    await page.click('.clip-card__poster');
    await page.waitForFunction(() => { const v = document.querySelector('.clip-card video'); return v && v.readyState >= 2 && v.currentTime > 0; }, { timeout: 60000 });
    const playback = await page.$eval('.clip-card video', v => ({ width: v.videoWidth, height: v.videoHeight, duration: v.duration, currentTime: v.currentTime }));
    assert.equal(playback.width, 1080); assert.equal(playback.height, 1920);
    await page.screenshot({ path: path.join(out, 'browser-playback.png'), fullPage: false });
    assert.deepEqual(errors, []);
    const report = { id, playback, browserErrors: errors };
    await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
process.exit(0);
