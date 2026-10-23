import { AD_MOODS, CATEGORIES, PRESETS } from './catalog.js';

export const DURATIONS = [10, 15, 20, 25];
export const FORMATS = ['vertical', 'square', 'landscape'];
export const MOODS = ['auto', ...Object.keys(AD_MOODS)];
export const problem = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
export const clean = (value, max = 500) => typeof value === 'string' ? value.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
export const wordCount = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;
/** Narration has to finish before the ad does: about two words a second. */
export const maxWords = (seconds) => Math.floor(seconds * 2);

export function assertWorkspaceAd(data, workspaceId) {
    if (!workspaceId || !data || data.workspaceId !== workspaceId) throw problem(404, 'Ad not found.');
    return data;
}

/** Selling points arrive as a JSON array or one per line (multipart forms carry strings only). */
function listOf(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [value];
    } catch {
        return value.split(/\n+/);
    }
}

/** A product ad's details. The product photos are required: they are what the 3D scene shows. */
export function normalizeSource(body = {}, imageCount = 0) {
    if (!imageCount) throw problem(400, 'Upload at least one product photo.');
    const name = clean(body.name, 60);
    if (!name) throw problem(400, 'Add the product or service name.');
    const duration = Number(body.duration || 15);
    const format = body.format || 'vertical';
    const preset = body.preset || 'turntable';
    const category = body.category || 'retail';
    if (!DURATIONS.includes(duration)) throw problem(400, `Choose ${DURATIONS.slice(0, -1).join(', ')} or ${DURATIONS.at(-1)} seconds.`);
    if (!FORMATS.includes(format)) throw problem(400, 'Choose a supported video format.');
    if (!PRESETS[preset]) throw problem(400, 'Choose one of the 3D styles.');
    if (!CATEGORIES[category]) throw problem(400, 'Choose what you are advertising.');
    return {
        name,
        tagline: clean(body.tagline, 90),
        points: listOf(body.points).map((p) => clean(p, 48)).filter(Boolean).slice(0, 3),
        offer: clean(body.offer, 40),
        cta: clean(body.cta, 30) || 'Shop now',
        website: clean(body.website, 60).replace(/^https?:\/\//i, '').replace(/\/$/, ''),
        category,
        preset,
        duration,
        format,
    };
}

export function normalizeRender(body, draft) {
    // Voiceover is optional: without it the ad is music (and sound effects) only.
    const voiceover = body.voiceover !== false;
    let script = '';
    let voiceId = '';
    if (voiceover) {
        script = clean(body.script, 1000);
        const limit = maxWords(draft.duration);
        if (!script || wordCount(script) > limit) throw problem(400, `Use a narration script of 1–${limit} words for this ad.`);
        voiceId = clean(body.voiceId, 100);
        if (!/^[a-zA-Z0-9_-]{10,100}$/.test(voiceId)) throw problem(400, 'Select a voice.');
    }
    const mood = body.mood || 'auto';
    if (!MOODS.includes(mood)) throw problem(400, 'Choose a supported music mood.');
    if (!voiceover && body.music === false && body.sfx === false) throw problem(400, 'Turn on music, sound effects or a voiceover so the ad has sound.');
    if (body.confirmed !== true) throw problem(400, 'Review and confirm the product claims before generating.');
    return { voiceover, script, voiceId, mood, music: body.music !== false, captions: voiceover && body.captions !== false, sfx: body.sfx !== false };
}

export function captionsFromAlignment(alignment) {
    if (!alignment?.characters?.length) return [];
    const captions = [];
    let text = '', start = 0, end = 0;
    alignment.characters.forEach((char, i) => {
        const a = Number(alignment.character_start_times_seconds?.[i]);
        const b = Number(alignment.character_end_times_seconds?.[i]);
        if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < a) return;
        if (!text) start = a;
        text += char;
        end = b;
        if ((/\s/.test(char) && wordCount(text) >= 5) || i === alignment.characters.length - 1) {
            if (text.trim()) captions.push({ text: text.trim(), start, end });
            text = '';
        }
    });
    return captions;
}
