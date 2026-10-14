import { FORMATS, inspectWebsite } from './inspect.js';
import { findMusic, TONE_MUSIC } from './music.js';
import { planVideo, TONES } from './plan.js';
import { renderLaunchVideo } from './render.js';

/**
 * Launch videos, after /brag (github.com/latent-spaces/brag, MIT):
 * inspect the product → plan a storyboard → render with music → share copy + poster.
 */

export { FORMATS, TONES, TONE_MUSIC };

export function normalizeLaunchRequest(body = {}) {
    const url = typeof body.url === 'string' ? body.url.trim().slice(0, 500) : '';
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 1500) : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (!url && !description) throw Object.assign(new Error('Add a website address or describe the product.'), { status: 400 });
    return {
        url,
        description,
        name,
        focus: typeof body.focus === 'string' ? body.focus.trim().slice(0, 200) : '',
        tone: TONES[body.tone] ? body.tone : 'default',
        format: FORMATS[body.format] ? body.format : 'landscape',
        duration: Math.min(30, Math.max(12, Number(body.duration) || 20)),
        music: body.music !== false,
        // Optional library choices; empty means "match the tone".
        musicGenre: typeof body.musicGenre === 'string' ? body.musicGenre.trim().slice(0, 40) : '',
        musicMood: typeof body.musicMood === 'string' ? body.musicMood.trim().slice(0, 40) : '',
        musicTrackId: typeof body.musicTrackId === 'string' && /^[0-9a-f]{16}$/.test(body.musicTrackId) ? body.musicTrackId : '',
    };
}

export async function createLaunchVideo(request, { onStage = () => {}, onProgress = () => {} } = {}) {
    const { url, description, name, focus, tone, format, duration } = request;

    onStage('Inspecting', 5);
    const source = url
        ? await inspectWebsite(url, format, (stage) => onStage(stage, 10))
        : { name, title: name, siteName: name, description, headings: [], ctas: [], paragraphs: [description], screenshots: [], colors: {} };
    if (url && name) source.siteName = name;
    if (url && description) source.paragraphs = [description, ...(source.paragraphs || [])];

    onStage('Writing the storyboard', 25);
    const { plan, planner } = await planVideo(source, { tone, format, duration, focus });
    const total = plan.scenes.reduce((sum, s) => sum + s.duration, 0);

    onStage('Choosing music', 35);
    const music = request.music
        ? await findMusic({ trackId: request.musicTrackId, genre: request.musicGenre, mood: request.musicMood, tone, query: plan.musicQuery }, total)
        : null;

    onStage('Rendering', 40);
    const video = await renderLaunchVideo({ plan, source, format, music, onProgress: (p) => onProgress(40 + Math.round(p * 58)) });

    const shareCopy = [plan.shareCopy, music?.credit ? `Music: ${music.credit}` : ''].filter(Boolean).join('\n\n');
    return { ...video, plan, planner, shareCopy, musicCredit: music?.credit || null, musicTrackId: music?.trackId || null };
}
