// Live integration test: repeats an owned project through the authenticated HTTP API.
// Usage: node scripts/check-clips-e2e.mjs <existing-project-id> <token-file>
// Uses real provider calls and writes a new clip project. Never logs credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { probe, run, FFMPEG } from '../server/src/services/ffmpeg-runner.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [sourceId, tokenFile] = process.argv.slice(2);
assert.ok(sourceId && tokenFile, 'Provide source project ID and token file');
let token = tokenFile === '--owner-session' ? null : (await fs.readFile(tokenFile, 'utf8')).trim();
const base = 'http://localhost:5000';
const headers = { 'Content-Type': 'application/json' };
async function api(url, options = {}) {
    const r = await fetch(base + url, { ...options, headers, signal: AbortSignal.timeout(60000) });
    const data = await r.json();
    assert.ok(r.ok, `HTTP ${r.status}: ${JSON.stringify(data)}`);
    return data;
}
// Read the source from Firestore only to resolve its workspace; every test action uses HTTP auth.
process.chdir(path.join(root, 'server'));
const { getFirestore, getAuth } = await import('../server/src/config/firebase.js');
const source = (await getFirestore().collection('clip_projects').doc(sourceId).get()).data();
assert.ok(source?.source?.url, 'Source project must contain a YouTube URL');
if (!token) {
    // Explicit local admin test mode; credentials remain in memory, never in artifacts.
    const { parse } = await import('../server/node_modules/dotenv/lib/main.js');
    const config = parse(await fs.readFile(path.join(root, 'client/.env')));
    const custom = await getAuth().createCustomToken(source.userId);
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${config.VITE_FIREBASE_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }), signal: AbortSignal.timeout(30000),
    });
    assert.ok(response.ok, `Test-session exchange failed (${response.status})`);
    token = (await response.json()).idToken;
}
headers.Authorization = `Bearer ${token}`;
headers['x-workspace-id'] = source.workspaceId;
await api(`/api/clips/${sourceId}`);
const started = Date.now();
const { id } = await api('/api/clips/from-url', { method: 'POST', body: JSON.stringify({ ...source.request, url: source.source.url, rightsConfirmed: true }) });
const out = path.join(root, 'output/clips-e2e', id);
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(root, 'output/clips-e2e/latest.json'), JSON.stringify({ id, out }));
console.log(JSON.stringify({ id, sourceId, url: source.source.url }));
let project, last = '';
const stages = [];
while (Date.now() - started < 30 * 60 * 1000) {
    ({ project } = await api(`/api/clips/${id}`));
    const state = `${project.progress}% ${project.stage}`;
    if (state !== last) { stages.push({ elapsedSeconds: Math.round((Date.now() - started) / 1000), state }); console.log(state); last = state; }
    if (project.status !== 'processing') break;
    await new Promise(r => setTimeout(r, 5000));
}
assert.equal(project.status, 'completed', project.error || 'Project timed out');
assert.equal(project.clips.filter(c => !c.error).length, source.request.count, 'Every requested clip should render');
const clips = [];
for (const [i, clip] of project.clips.entries()) {
    const file = path.join(out, `clip-${i + 1}.mp4`);
    const response = await fetch(base + clip.downloadUrl, { headers, signal: AbortSignal.timeout(120000) });
    assert.equal(response.status, 200);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
    const info = await probe(file);
    assert.ok(info.hasVideo && info.hasAudio, 'Video and audio tracks required');
    assert.equal(info.width, 1080); assert.equal(info.height, 1920);
    assert.ok(info.duration >= 29 && info.duration <= 62, 'Expected medium-length shorts');
    await run(FFMPEG, ['-v', 'error', '-i', file, '-f', 'null', '-']);
    await run(FFMPEG, ['-v', 'error', '-ss', '3', '-i', file, '-frames:v', '1', '-update', '1', path.join(out, `clip-${i + 1}.jpg`)]);
    const anonymous = await fetch(base + clip.downloadUrl, { signal: AbortSignal.timeout(10000) });
    assert.ok([401, 403].includes(anonymous.status), 'Anonymous clip downloads must be denied');
    clips.push({ title: clip.title, file, ...info });
}
const job = (await getFirestore().collection('render_jobs').doc(`clips_${id}`).get()).data();
assert.ok(job.transcription.words.length > 100, 'Full source must have a real transcript');
assert.match(job.transcription.transcriptionProvider, /whisper-api:openrouter/);
const report = { id, sourceId, elapsedSeconds: Math.round((Date.now() - started) / 1000), provider: job.transcription.transcriptionProvider, words: job.transcription.words.length, detectedLanguage: job.transcription.language, finder: project.finder, sourceDuration: project.duration, stages, clips };
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(0);
