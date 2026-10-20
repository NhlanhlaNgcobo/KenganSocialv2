// Isolated browser integration harness. No real account, credentials, or external requests.
// Uses the application's actual components/stores; AuthContext is replaced only in this test bundle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientRequire = createRequire(path.join(root, 'client/package.json'));
const serverRequire = createRequire(path.join(root, 'server/package.json'));
const { build } = clientRequire('esbuild');
const puppeteer = serverRequire('puppeteer-core');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kengan-editor-browser-'));
const file = (relative) => JSON.stringify(path.join(root, relative).replaceAll('\\', '/'));
const fixture = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(dir, 'fixture.mp4')], { encoding: 'utf8', timeout: 60000 });
assert.equal(fixture.status, 0, fixture.stderr);
const entry = `
import React from ${file('client/node_modules/react/index.js')};
import { createRoot } from ${file('client/node_modules/react-dom/client.js')};
import { BrowserRouter } from ${file('client/node_modules/react-router-dom/dist/index.mjs')};
import Editor from ${file('client/src/editor/Editor.tsx')};
import { useProjectStore } from ${file('client/src/editor/stores/project-store.ts')};
import { useTimelineStore } from ${file('client/src/editor/stores/timeline-store.ts')};
import { useMediaStore } from ${file('client/src/editor/stores/media-store.ts')};
import { useAiStore } from ${file('client/src/editor/stores/ai-store.ts')};
import { useUiStore } from ${file('client/src/editor/stores/ui-store.ts')};
import { usePlaybackStore } from ${file('client/src/editor/stores/playback-store.ts')};
import { TEMPLATES, applyTemplate } from ${file('client/src/editor/lib/templates.ts')};
import { arrangeClips } from ${file('client/src/editor/lib/arrange-clips.ts')};
import { scopePoints } from ${file('client/src/editor/lib/color-scopes.ts')};
import { buildRecipe } from ${file('client/src/editor/lib/recipe-plan.ts')};
import { buildEditConfig } from ${file('client/src/editor/lib/export.ts')};
import { CAPTION_TEMPLATES } from ${file('client/src/editor/lib/caption-templates.ts')};
import { musicApi } from ${file('client/src/lib/music-api.ts')};
import ${file('client/src/index.css')};
const projectKey = 'kengan-editor:test-only';
useProjectStore.setState({ projectKey, status: 'ready', ratio: '16:9' });
const blob = await (await fetch('/fixture.mp4')).blob();
const [item] = await useMediaStore.getState().addFiles([new File([blob], 'Test footage.mp4', { type: 'video/mp4' })], projectKey);
useTimelineStore.getState().addMediaAtTime(item, 0);
useTimelineStore.setState({ history: [], future: [] });
useAiStore.getState().setSource(item.id);
window.qa = { arrangeClips, scopePoints, project: useProjectStore, timeline: useTimelineStore, media: useMediaStore, ui: useUiStore, playback: usePlaybackStore, TEMPLATES, CAPTION_TEMPLATES, applyTemplate, buildRecipe, buildEditConfig, musicApi, item };
createRoot(document.getElementById('root')).render(<BrowserRouter><Editor /></BrowserRouter>);
`;
fs.writeFileSync(path.join(dir, 'entry.tsx'), entry);
await build({
    entryPoints: [path.join(dir, 'entry.tsx')], outfile: path.join(dir, 'app.js'),
    bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic',
    external: ['/fonts/*'],
    nodePaths: [path.join(root, 'client/node_modules')], define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'test-auth', setup(builder) {
        builder.onResolve({ filter: /context\/AuthContext/ }, () => ({ path: 'test-auth', namespace: 'test-auth' }));
        builder.onLoad({ filter: /.*/, namespace: 'test-auth' }, () => ({ contents: 'export const useAuth = () => ({user:null, plan:"creator"});', loader: 'js' }));
    } }],
});
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body style="margin:0"><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
const server = http.createServer((req, res) => {
    const name = req.url === '/' ? 'index.html' : (req.url || '').slice(1);
    if (/^fonts\/captions\/[A-Za-z-]+\.ttf$/.test(name)) {
        const font = path.join(root, 'client/public', name);
        if (fs.existsSync(font)) { res.setHeader('Content-Type', 'font/ttf'); fs.createReadStream(font).pipe(res); return; }
    }
    if (!['index.html', 'app.js', 'app.css', 'fixture.mp4'].includes(name)) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ genres: [], vocals: [], licenses: [], sources: [] }));
        return;
    }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.mp4') ? 'video/mp4' : 'text/html');
    fs.createReadStream(path.join(dir, name)).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium', '/usr/bin/google-chrome',
];
const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
assert.ok(executablePath, 'A Chrome/Edge installation is required for browser checks.');
let browser;
try {
    browser = await puppeteer.launch({ executablePath, headless: true, args: ['--mute-audio'], defaultViewport: { width: 1600, height: 1000 } });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        const url = request.url();
        if (url.startsWith(`http://127.0.0.1:${port}/`) || url.startsWith('blob:') || url.startsWith('data:')) request.continue();
        else request.abort();
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.ke-root:not(.ke-loading)');
    assert.deepEqual(await page.evaluate(() => [window.qa.TEMPLATES.length, window.qa.CAPTION_TEMPLATES.length]), [54, 33]);
    await page.click('button[title="Templates"]');
    await page.waitForSelector('.ke-recipe');
    await page.screenshot({ path: path.join(dir, 'templates.png') });
    await page.click('.ke-btn--primary.ke-btn--block');
    await page.waitForFunction(() => window.qa.timeline.getState().tracks.find((t) => t.isMain).elements.length === 6);
    assert.equal(await page.evaluate(() => window.qa.project.getState().ratio), '9:16');
    await page.keyboard.down('Control');
    await page.keyboard.press('z');
    await page.keyboard.up('Control');
    assert.deepEqual(await page.evaluate(() => [window.qa.timeline.getState().tracks.find((t) => t.isMain).elements.length, window.qa.project.getState().ratio]), [1, '16:9']);
    await page.keyboard.down('Control');
    await page.keyboard.down('Shift');
    await page.keyboard.press('z');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');
    assert.deepEqual(await page.evaluate(() => [window.qa.timeline.getState().tracks.find((t) => t.isMain).elements.length, window.qa.project.getState().ratio]), [6, '9:16']);
    console.log('PASS apply / keyboard undo / keyboard redo / canvas settings');

    const plans = await page.evaluate(() => {
        const { TEMPLATES, buildRecipe, item } = window.qa;
        return TEMPLATES.filter((t) => t.recipe).map((t) => {
            const plan = buildRecipe(t, t.recipe.map(() => item), {}, 1);
            const short = buildRecipe(t, [{ ...item, duration: 0.4 }], {}, 2);
            return { id: t.id, count: plan.main.length, expected: t.recipe.length, duration: plan.duration, shortValid: short.main.every((e) => e.trimStart >= 0 && e.trimEnd >= 0 && e.duration - e.trimStart - e.trimEnd > 0), contiguous: plan.main.every((e, i) => i === 0 || Math.abs(e.startTime - (plan.main[i - 1].startTime + (plan.main[i - 1].duration - plan.main[i - 1].trimStart - plan.main[i - 1].trimEnd) / plan.main[i - 1].speed)) < 0.001) };
        });
    });
    assert.equal(plans.length, 40);
    plans.forEach((plan) => { assert.equal(plan.count, plan.expected); assert.ok(plan.duration > 0 && plan.contiguous && plan.shortValid, plan.id); });
    console.log('PASS all 40 recipes / contiguous edits / short sources / pace');
    const arrangement = await page.evaluate(() => {
        const { arrangeClips, item, TEMPLATES, scopePoints } = window.qa;
        const pool = [{ ...item, id: 'lift', name: 'Heavy lift action.mp4' }, { ...item, id: 'chalk', name: 'Chalk detail.mp4' }, { ...item, id: 'wide', name: 'Setup wide.mp4' }];
        const ids = arrangeClips([{ label: 'Chalk detail', seconds: 1 }, { label: 'Heavy lift action', seconds: 2 }, { label: 'Setup wide', seconds: 2 }], pool);
        const black = scopePoints(new Uint8ClampedArray([0, 0, 0, 255]), 1, 'waveform');
        const white = scopePoints(new Uint8ClampedArray([255, 255, 255, 255]), 1, 'waveform');
        return { ids, counts: ['gym', 'lifestyle', 'vlog'].map((c) => TEMPLATES.filter((t) => t.category === c).length), black: black.points[0].y, white: white.points[0].y, empty: arrangeClips([{ label: 'Any', seconds: 1 }], []) };
    });
    assert.deepEqual(arrangement, { ids: ['chalk', 'lift', 'wide'], counts: [10, 10, 10], black: 1, white: 0, empty: [] });
    console.log('PASS role matching / source uniqueness / empty pool / category counts / scope endpoints');

    await page.evaluate(() => {
        const { timeline, playback } = window.qa;
        timeline.getState().addCaptions([{ text: 'Make', start: 0, end: 0.4 }, { text: 'it', start: 0.4, end: 0.7 }, { text: 'count', start: 0.7, end: 1.4 }], 'ks-caption-pulse-word', 1920);
        playback.getState().seek(0.5);
    });
    await page.click('button[title="Captions"]');
    await page.waitForSelector('.ke-cap-card');
    await page.screenshot({ path: path.join(dir, 'captions.png') });
    const captionCheck = await page.evaluate(async () => {
        const { timeline, project } = window.qa;
        const before = JSON.stringify(timeline.getState().tracks);
        await project.getState().save();
        await project.getState().load(project.getState().projectKey);
        return { equal: before === JSON.stringify(timeline.getState().tracks), captions: timeline.getState().tracks.flatMap((t) => t.elements).filter((e) => e.isCaption).map((e) => e.captionWords?.length) };
    });
    assert.equal(captionCheck.equal, true);
    assert.deepEqual(captionCheck.captions, [3]);
    console.log('PASS IndexedDB save / reload / word timestamps');

    const cancelCheck = await page.evaluate(async () => {
        const { timeline, applyTemplate, TEMPLATES, item } = window.qa;
        const before = timeline.getState().tracks;
        const controller = new AbortController();
        controller.abort();
        try { await applyTemplate(TEMPLATES[0], item.id, { allowAi: false, music: null, signal: controller.signal }); }
        catch (error) { return error.message === 'Cancelled' && timeline.getState().tracks === before; }
        return false;
    });
    assert.equal(cancelCheck, true);
    console.log('PASS cancellation leaves timeline unchanged');
    const asyncChecks = await page.evaluate(async () => {
        const { timeline, applyTemplate, TEMPLATES, item, musicApi } = window.qa;
        const original = musicApi.pickSong;
        const results = [];
        try {
            for (const scenario of ['cancel', 'edit']) {
                let release;
                musicApi.pickSong = () => new Promise((resolve) => { release = resolve; });
                const controller = new AbortController();
                const pending = applyTemplate(TEMPLATES[0], item.id, { allowAi: false, music: { genre: 'electronic', vocals: 'any' }, signal: controller.signal }).catch((error) => error.message);
                if (scenario === 'cancel') controller.abort();
                else timeline.getState().addTextAtTime(5, { content: 'Keep my new edit' });
                const expected = timeline.getState().tracks;
                release(null);
                const message = await pending;
                results.push(timeline.getState().tracks === expected && (scenario === 'cancel' ? message === 'Cancelled' : message.includes('project changed')));
            }
        } finally { musicApi.pickSong = original; }
        return results;
    });
    assert.deepEqual(asyncChecks, [true, true]);
    console.log('PASS async cancellation / concurrent user edit preservation');

    await page.click('button[title="Transitions"]');
    await page.waitForSelector('.ke-tr-demo');
    await page.screenshot({ path: path.join(dir, 'transitions.png') });
    await page.click('button[title="Effects"]');
    await page.waitForSelector('.ke-fx-grid');
    await page.screenshot({ path: path.join(dir, 'effects.png') });
    await page.evaluate(() => {
        const track = window.qa.timeline.getState().tracks.find((t) => t.isMain);
        window.qa.timeline.getState().selectElement(track.id, track.elements[0].id);
    });
    await page.click('.ke-fx-card[title="A damped camera jolt at the beginning of the clip."]');
    await page.waitForSelector('.ke-effect-controls button');
    await page.click('.ke-effect-controls button[aria-pressed="true"]');
    assert.equal(await page.evaluate(() => window.qa.timeline.getState().tracks.find((t) => t.isMain).elements[0].effects.find((e) => e.type === 'ks-impact-shake').enabled), false);
    console.log('PASS selected-clip effect application / bypass');
    await page.evaluate(() => {
        const track = window.qa.timeline.getState().tracks.find((t) => t.isMain);
        window.qa.timeline.getState().selectElement(track.id, track.elements[0].id);
    });
    const scopesButton = await page.$('button.ke-lumetri__head');
    assert.ok(scopesButton);
    await scopesButton.click();
    await page.waitForFunction(() => document.querySelector('.ke-scopes')?.textContent.includes('Near black:'));
    await page.select('select[aria-label="Colour scope"]', 'parade');
    await page.screenshot({ path: path.join(dir, 'grading-scopes.png') });
    const sampled = await page.evaluate(() => {
        const c = document.querySelector('canvas[aria-label="Sampled colour frame"]');
        const data = c.getContext('2d').getImageData(0, 0, 160, 90).data;
        return Array.from(data).filter((_, i) => i % 4 !== 3).some((v) => v > 20);
    });
    assert.equal(sampled, true);
    console.log('PASS live sampled grading scopes / non-black graded frame');
    await page.click('button[title="Text"]');
    await page.waitForFunction(() => document.querySelectorAll('.ke-text-card').length === 16);
    await page.click('.ke-text-card');
    await page.waitForFunction(() => window.qa.timeline.getState().tracks.some((t) => t.elements.some((e) => e.captionMotion === 'title-rise')));
    await page.screenshot({ path: path.join(dir, 'title-animations.png') });
    assert.equal(await page.evaluate(() => {
        const { arrangeClips, item } = window.qa;
        const result = arrangeClips([{ label: 'Opening', seconds: 1 }, { label: 'Travel', seconds: 1 }, { label: 'Reprise', seconds: 1, repeatSource: 0 }], [{ ...item, id: 'a' }, { ...item, id: 'b' }]);
        return result[0] === result[2] && result[0] !== result[1];
    }), true);
    console.log('PASS animated title gallery / add title / deliberate opening reprise');
    assert.deepEqual(errors, []);
    console.log(`PASS browser runtime. Screenshots: ${dir}`);
} finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
}
