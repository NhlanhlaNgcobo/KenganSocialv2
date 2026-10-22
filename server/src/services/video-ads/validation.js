export const DURATIONS = [15, 20, 25];
export const FORMATS = ['vertical', 'square', 'landscape'];
export const MOODS = ['upbeat', 'calm', 'cinematic', 'playful', 'luxury'];
export const problem = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
export const clean = (value, max = 500) => typeof value === 'string' ? value.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
export const wordCount = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

export function assertWorkspaceAd(data, workspaceId) {
    if (!workspaceId || !data || data.workspaceId !== workspaceId) throw problem(404, 'Ad not found.');
    return data;
}

export function normalizeSource(body = {}, imageCount = 0) {
    const url = clean(body.url, 1000);
    if (url) {
        let parsed;
        try { parsed = new URL(url); } catch { throw problem(400, 'Enter a complete website URL, including https://.'); }
        if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw problem(400, 'Use a public http or https URL without credentials.');
    }
    const name = clean(body.name, 80);
    const description = clean(body.description, 1500);
    if (!url && !imageCount) throw problem(400, 'Upload product images or enter a website URL.');
    if (!url && (!name || !description)) throw problem(400, 'Add a product name and description for your images.');
    const duration = Number(body.duration || 20);
    const format = body.format || 'vertical';
    if (!DURATIONS.includes(duration)) throw problem(400, 'Choose 15, 20, or 25 seconds.');
    if (!FORMATS.includes(format)) throw problem(400, 'Choose a supported video format.');
    return { url, name, description, duration, format };
}

export function normalizeRender(body, draft) {
    const script = clean(body.script, 1000);
    const maxWords = Math.floor(draft.duration * 2);
    if (!script || wordCount(script) > maxWords) throw problem(400, `Use a narration script of 1–${maxWords} words for this ad.`);
    const voiceId = clean(body.voiceId, 100);
    if (!/^[a-zA-Z0-9_-]{10,100}$/.test(voiceId)) throw problem(400, 'Select a voice.');
    const mood = body.mood || 'upbeat';
    if (!MOODS.includes(mood)) throw problem(400, 'Choose a supported music mood.');
    if (body.confirmed !== true) throw problem(400, 'Review and confirm the product claims before generating.');
    return { script, voiceId, mood, music: body.music !== false, captions: body.captions !== false };
}

export function fitScenes(scenes, seconds) {
    if (!DURATIONS.includes(seconds) || !Array.isArray(scenes) || scenes.length < 2) throw problem(400, 'Invalid ad storyboard.');
    const selected = scenes.length > 4 ? [scenes[0], ...scenes.slice(1, 3), scenes.at(-1)] : scenes;
    const frames = seconds * 30;
    const weights = selected.map((s) => Math.max(1, Math.min(6, Number(s.duration) || 3)));
    const sum = weights.reduce((a, b) => a + b, 0);
    let remaining = frames;
    return selected.map((s, i) => {
        const count = i === selected.length - 1 ? remaining : Math.floor(frames * weights[i] / sum);
        remaining -= count;
        return { ...s, duration: count / 30, headline: clean(s.headline, 100), subline: '', points: [], stat: null };
    });
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
