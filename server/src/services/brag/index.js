import { exploreApp } from './explore.js';
import { FORMATS, inspectWebsite } from './inspect.js';
import { planVideo, TONES } from './plan.js';
import { renderLaunchVideo } from './render.js';
import { getSfx } from './sfx.js';
import { chooseSoundtrack, MOODS, syncScenesToBeats, TONE_MOOD } from './soundtrack.js';
import { planTutorial } from './tutorial-plan.js';

/**
 * Launch videos, after /brag (github.com/latent-spaces/brag, MIT):
 * inspect the product → plan a storyboard → pick a soundtrack and cut on its beat → render
 * with sound effects → share copy + poster.
 *
 * Tutorial videos: explore a web app page by page → plan steps on the real screens →
 * render a guided walkthrough (cursor, clicks, typing, zoom, captions).
 */

export { FORMATS, MOODS, TONE_MOOD, TONES };
export const KINDS = ['launch', 'tutorial'];

export function normalizeLaunchRequest(body = {}) {
    const kind = KINDS.includes(body.kind) ? body.kind : 'launch';
    const url = typeof body.url === 'string' ? body.url.trim().slice(0, 500) : '';
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 1500) : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (kind === 'tutorial' && !url) throw Object.assign(new Error('Paste the web app’s address to make a tutorial.'), { status: 400 });
    if (!url && !description) throw Object.assign(new Error('Add a website address or describe the product.'), { status: 400 });
    const tone = kind === 'tutorial' ? 'tutorial' : TONES[body.tone] ? body.tone : 'default';
    return {
        kind,
        url,
        description,
        name,
        focus: typeof body.focus === 'string' ? body.focus.trim().slice(0, 200) : '',
        tone,
        format: FORMATS[body.format] ? body.format : 'landscape',
        duration: Math.min(30, Math.max(12, Number(body.duration) || 20)),
        music: body.music !== false,
        mood: MOODS[body.mood] ? body.mood : TONE_MOOD[tone] || 'upbeat',
        musicTrackId: typeof body.musicTrackId === 'string' && /^(ccm-\d{1,9}|ov-[0-9a-f-]{36})$/.test(body.musicTrackId) ? body.musicTrackId : '',
    };
}

/** Screenshots stay out of the stored storyboard (Firestore documents are capped at 1 MB). */
function storable(plan) {
    return {
        ...plan,
        scenes: plan.scenes.map(({ screenshotData, nextShotData, target, ...s }) => ({ ...s, target: target ? { kind: target.kind, text: target.text } : null })),
    };
}

async function planLaunch(request, onStage) {
    const { url, description, name, focus, tone, format, duration } = request;
    onStage('Inspecting', 5);
    const source = url
        ? await inspectWebsite(url, format, (stage) => onStage(stage, 10))
        : { name, title: name, siteName: name, description, headings: [], ctas: [], paragraphs: [description], screenshots: [], shotElements: [], colors: {} };
    if (url && name) source.siteName = name;
    if (url && description) source.paragraphs = [description, ...(source.paragraphs || [])];
    onStage('Writing the storyboard', 25);
    const { plan, planner } = await planVideo(source, { tone, format, duration, focus });
    return { source, plan, planner };
}

async function planGuide(request, onStage) {
    onStage('Exploring the app', 5);
    const app = await exploreApp(request.url, request.format, (stage) => onStage(stage, 12));
    if (request.name) app.name = request.name;
    if (request.description) app.description = request.description;
    onStage('Writing the steps', 25);
    const { plan, planner } = await planTutorial(app, { focus: request.focus });
    // The renderer reads identity the same way for both kinds.
    const [iconData, logoData] = await Promise.all([fetchIcon(app.iconUrl), fetchIcon(app.colors?.logoUrl)]);
    return { source: { url: app.url, colors: app.colors, fonts: app.fonts, iconData, logoData }, plan, planner };
}

async function fetchIcon(url) {
    if (!url) return null;
    try {
        const { safeGet } = await import('../../utils/safe-fetch.js');
        const { data, headers } = await safeGet(url, { responseType: 'arraybuffer', maxBytes: 2 * 1024 * 1024 });
        const type = String(headers['content-type'] || '').split(';')[0];
        return /^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(type) ? `data:${type};base64,${Buffer.from(data).toString('base64')}` : null;
    } catch {
        return null;
    }
}

export async function createLaunchVideo(request, { onStage = () => {}, onProgress = () => {} } = {}) {
    const { source, plan, planner } = request.kind === 'tutorial' ? await planGuide(request, onStage) : await planLaunch(request, onStage);
    const total = plan.scenes.reduce((sum, s) => sum + s.duration, 0);

    onStage('Choosing music', 32);
    let music = null;
    if (request.music) {
        try {
            music = await chooseSoundtrack({ mood: request.mood, length: total, trackId: request.musicTrackId });
        } catch (error) {
            console.warn('[Brag] Soundtrack failed:', error.message);
        }
    }
    // Cut on the beat (launch videos; tutorials keep reading time).
    if (music?.beats?.length && request.kind === 'launch') plan.scenes = syncScenesToBeats(plan.scenes, music.beats);

    onStage('Rendering', 40);
    const sfx = await getSfx().catch(() => ({}));
    const video = await renderLaunchVideo({
        plan,
        source,
        format: request.format,
        music,
        sfx,
        kind: request.kind,
        onProgress: (p) => onProgress(40 + Math.round(p * 58)),
    });

    const shareCopy = [plan.shareCopy, music?.credit ? `Music: ${music.credit}` : ''].filter(Boolean).join('\n\n');
    return {
        ...video,
        plan: storable(plan),
        planner,
        shareCopy,
        musicCredit: music?.credit || null,
        musicTrackId: music?.trackId || null,
        musicMood: music?.mood || null,
        musicBpm: music?.bpm || null,
    };
}
