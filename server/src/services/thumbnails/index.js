import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import sharp from 'sharp';
import { aiConfigured, generateJson } from '../gemini-json.js';
import { generateImage, imageGenerationAvailable } from '../marketing/image-gen.js';

/**
 * Thumbnails for clips and edits (YouTube and TikTok covers):
 *  - candidates(): the video service scores frames (python-service/thumbnail_picker.py) and
 *    returns the most clickable stills; kept here briefly, per user, so render() can use them.
 *  - headlines(): short, punchy headline options about the video's topic (AI when configured,
 *    otherwise built from the clip's own title, hook and words).
 *  - background(): an AI-generated background image instead of a still (when configured).
 */
const PYTHON_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';
const WORK = path.join(os.tmpdir(), 'kengan-renders');
const KEEP_MS = 2 * 60 * 60 * 1000;
const store = new Map(); // id -> { path, face, owner, at }

function remember(entry) {
    const id = crypto.randomUUID();
    store.set(id, { ...entry, at: Date.now() });
    for (const [key, value] of store) if (Date.now() - value.at > KEEP_MS) store.delete(key);
    return id;
}

export function candidate(id, owner) {
    const entry = store.get(id);
    if (!entry || entry.owner !== owner || !fs.existsSync(entry.path)) return null;
    entry.at = Date.now();
    return entry;
}

async function preview(file) {
    const buf = await sharp(file).resize(480, 480, { fit: 'inside' }).jpeg({ quality: 78 }).toBuffer();
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

export async function candidates({ sourcePath, start = 0, end = null, owner }) {
    let data;
    try {
        ({ data } = await axios.post(
            `${PYTHON_URL}/process/thumbnail-candidates`,
            { videoPath: sourcePath, start, end, count: 6, jobId: crypto.randomUUID().slice(0, 12) },
            { timeout: 5 * 60 * 1000 }
        ));
    } catch (error) {
        if (error.code === 'ECONNREFUSED') throw Object.assign(new Error('Thumbnails need the Kengan video service, which is not running.'), { status: 503 });
        throw Object.assign(new Error(error.response?.data?.detail || error.message), { status: error.response?.status || 502 });
    }
    const list = [];
    for (const c of data.candidates || []) {
        list.push({
            id: remember({ path: c.path, face: c.face || null, owner }),
            time: c.time,
            score: c.score,
            faces: c.faces,
            reasons: c.reasons || [],
            preview: await preview(c.path),
        });
    }
    return { candidates: list, hasFaces: Boolean(data.hasFaces) };
}

const STOP = new Set(
    ('a an and are as at be but by for from has have i if in into is it its just me my no not of on or our so that the their them then there they this ' +
        'to too up us was we what when which who why will with you your yeah okay like really know get got going gonna do did dont can cant im youre ' +
        'thats nobody somebody everyone everything something anything tell tells told said says say about would could should been being very much ' +
        'more most also than here where how one two three first last over only even still back every each some any many make made makes')
        .split(' ')
);
const TAIL = /\s+(a|an|and|as|at|by|for|from|in|into|of|on|or|the|to|with|about|that|this|your|our|my)$/i;

/** Short headline options. Each is 2-6 words; the first is the strongest. */
export async function headlines({ title = '', hook = '', caption = '', transcript = '' }) {
    const source = [hook, title, caption].filter(Boolean).join(' | ');
    if (aiConfigured() && (source || transcript)) {
        try {
            const prompt = `You write YouTube and TikTok thumbnail text that gets clicks. From this video, give the topic and 4 thumbnail headlines.
Rules: 2-5 words each, concrete and curiosity-driven, no hashtags, no emojis, no quotes, no clickbait lies; each should name the specific subject. Mark one keyword per headline to highlight.
Video title/hook/caption: ${source.slice(0, 600)}
Transcript excerpt: ${transcript.slice(0, 2500)}
Reply as JSON: {"topic": string, "headlines": [{"text": string, "highlight": string}]}`;
            const out = await generateJson([{ text: prompt }], { temperature: 0.8 });
            const items = (out?.headlines || []).map((h) => ({ text: String(h.text || '').trim().slice(0, 60), highlight: String(h.highlight || '').trim() })).filter((h) => h.text);
            if (items.length) return { topic: String(out.topic || '').slice(0, 80), headlines: items.slice(0, 4), ai: true };
        } catch (error) {
            console.warn('[Thumbnails] AI headlines unavailable:', error.message);
        }
    }
    // Without AI: the clip's own hook and title cut to thumbnail length (never ending on "the",
    // "about"...), plus lines built on the strongest topic word.
    const clean = (s) => String(s || '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
    const shorten = (s, n) => {
        let line = clean(s).split(/[.!?|]/)[0].split(' ').slice(0, n).join(' ').replace(/[,;:\-]+$/, '');
        while (TAIL.test(line)) line = line.replace(TAIL, '');
        return line;
    };
    const words = clean(`${title} ${hook} ${caption} ${transcript}`).toLowerCase().match(/[a-z][a-z']{3,}/g) || [];
    const counts = new Map();
    // Longer words weigh more: they are more likely to be the subject than filler.
    for (const w of words) if (!STOP.has(w)) counts.set(w, (counts.get(w) || 0) + 1 + Math.max(0, w.length - 5) * 0.25);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
    // The line's strongest topic word gets the highlight.
    const keyFor = (line) =>
        line
            .split(' ')
            .map((w) => ({ w, rank: top.indexOf(w.toLowerCase().replace(/[^a-z']/g, '')) }))
            .filter((x) => x.rank >= 0)
            .sort((a, b) => a.rank - b.rank)[0]?.w || '';
    const options = [];
    const add = (text, highlight) => {
        if (text && text.split(' ').length >= 2 && !options.some((o) => o.text.toLowerCase() === text.toLowerCase())) options.push({ text, highlight: highlight ?? keyFor(text) });
    };
    for (const s of [hook, title, caption]) add(shorten(s, 5));
    const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
    if (top[0]) add(`The ${top[0]} secret`, top[0]);
    if (top[0]) add(`${cap(top[0])} changed everything`, top[0]);
    if (!options.length) add('You need to see this', 'see');
    return { topic: top.slice(0, 3).join(', '), headlines: options.slice(0, 4), ai: false };
}

export const backgroundsAvailable = () => imageGenerationAvailable();

/** An AI background for the headline (no text in the image: the headline is added on top). */
export async function background({ prompt, format, owner }) {
    const result = await generateImage({
        prompt: `${prompt}. Bold, high-contrast, eye-catching thumbnail background, cinematic lighting, one clear subject, empty space for a headline, no text, no letters, no watermark.`,
        tier: 'fast',
        aspect: format === 'tiktok' ? '9:16' : '16:9',
    });
    fs.mkdirSync(WORK, { recursive: true });
    const file = path.join(WORK, `kengan-thumbai-${crypto.randomUUID()}.jpg`);
    await sharp(result.buffer).jpeg({ quality: 92 }).toFile(file);
    const id = remember({ path: file, face: null, owner });
    return { id, preview: await preview(file), provider: result.provider };
}
