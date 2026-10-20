import { generateJson } from '../gemini-json.js';

/**
 * Editing-style profiles for AI Edit.
 *
 * A profile describes how videos are edited: format, pacing (how long pauses may run before a jump
 * cut), punch-in zooms, colour grade, caption look, hook and keyword callouts. It comes from a
 * built-in preset or is measured from a reference video (python-service style_analysis.py), then
 * named and described by the AI when available.
 */

export const RATIOS = ['9:16', '16:9', '1:1'];
export const CAPTION_FONTS = ['Anton', 'Bebas Neue', 'Poppins', 'Inter', 'Arial', 'Impact', 'Georgia'];

/** Built-in styles, usable without a reference. */
export const PRESETS = [
    {
        id: 'preset-podcast',
        name: 'Podcast, long-form YouTube',
        summary: 'Tight but natural cuts that keep the conversation flowing, punch-ins on whoever is speaking every 20 seconds or so, a cold open with the strongest quote, clean sentence-case captions on a dark bar and a natural grade.',
        source: { type: 'preset' },
        format: { ratio: '16:9' },
        pacing: { label: 'medium', maxPauseSec: 0.55, avgShotSec: 9 },
        zooms: { punchIns: true, perMinute: 3, amount: 0.18, slowZoom: false },
        color: { look: 'natural', target: { saturation: 1.05, contrast: 1.06, brightness: 0.01, temperature: 0.05 } },
        captions: { enabled: true, y: 0.86, wordsPerCaption: 6, uppercase: false, font: 'Poppins', size: 0.045, color: '#ffffff', highlight: '#facc15', background: true, outline: false, animation: 'fade' },
        hook: { title: true, coldOpen: true },
        callouts: { enabled: true, perMinute: 0.6 },
    },
    {
        id: 'preset-viral-talking',
        name: 'Viral talking head (TikTok, Reels, Shorts)',
        summary: 'Fast jump cuts with no dead air, a punch-in every few seconds, big two-word uppercase captions with a yellow active word, a bold hook title and punchy colour.',
        source: { type: 'preset' },
        format: { ratio: '9:16' },
        pacing: { label: 'fast', maxPauseSec: 0.18, avgShotSec: 2.5 },
        zooms: { punchIns: true, perMinute: 12, amount: 0.14, slowZoom: false },
        color: { look: 'punchy', target: { saturation: 1.25, contrast: 1.12, brightness: 0.02, temperature: 0.05 } },
        captions: { enabled: true, y: 0.64, wordsPerCaption: 2, uppercase: true, font: 'Anton', size: 0.05, color: '#ffffff', highlight: '#facc15', background: false, outline: true, animation: 'pop' },
        hook: { title: true, coldOpen: false },
        callouts: { enabled: true, perMinute: 4 },
    },
    {
        id: 'preset-clean-vlog',
        name: 'Clean vlog',
        summary: 'Relaxed pacing that trims only long pauses, gentle slow zooms, short sentence-case captions near the bottom and a warm, bright grade.',
        source: { type: 'preset' },
        format: { ratio: '9:16' },
        pacing: { label: 'slow', maxPauseSec: 0.7, avgShotSec: 6 },
        zooms: { punchIns: false, perMinute: 0, amount: 0.08, slowZoom: true },
        color: { look: 'warm', target: { saturation: 1.1, contrast: 1.03, brightness: 0.03, temperature: 0.3 } },
        captions: { enabled: true, y: 0.78, wordsPerCaption: 4, uppercase: false, font: 'Poppins', size: 0.038, color: '#ffffff', highlight: null, background: false, outline: true, animation: 'fade' },
        hook: { title: true, coldOpen: false },
        callouts: { enabled: false, perMinute: 0 },
    },
    {
        id: 'preset-cinematic',
        name: 'Cinematic',
        summary: 'Unhurried cuts, slow push-in zooms, a cool high-contrast grade and minimal captions.',
        source: { type: 'preset' },
        format: { ratio: '16:9' },
        pacing: { label: 'slow', maxPauseSec: 0.9, avgShotSec: 8 },
        zooms: { punchIns: false, perMinute: 0, amount: 0.06, slowZoom: true },
        color: { look: 'cool', target: { saturation: 0.92, contrast: 1.22, brightness: -0.03, temperature: -0.3 } },
        captions: { enabled: false, y: 0.88, wordsPerCaption: 5, uppercase: false, font: 'Inter', size: 0.034, color: '#ffffff', highlight: null, background: false, outline: false, animation: 'fade' },
        hook: { title: false, coldOpen: false },
        callouts: { enabled: false, perMinute: 0 },
    },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function ratioOf(width, height) {
    if (!width || !height) return '9:16';
    const r = height / width;
    return r > 1.3 ? '9:16' : r < 0.8 ? '16:9' : '1:1';
}

function lookOf(c) {
    if (!c || c.saturation == null) return 'natural';
    if (c.saturation < 0.06) return 'mono';
    if (c.saturation > 0.42) return 'punchy';
    if (c.saturation < 0.18) return 'muted';
    if (c.warmth > 0.06) return 'warm';
    if (c.warmth < -0.04) return 'cool';
    if (c.contrast > 0.28) return 'contrasty';
    return 'natural';
}

/** Words spoken per second over the parts with speech, from a transcript in seconds. */
function speechRate(words) {
    if (!words?.length) return null;
    const spoken = words.reduce((sum, w) => sum + Math.max(0, w.end - w.start), 0);
    const span = words[words.length - 1].end - words[0].start;
    return span > 5 ? words.length / Math.max(spoken + words.length * 0.08, span * 0.5) : null;
}

/** Pauses the reference keeps (90th percentile of gaps between words), in seconds. */
function keptPause(words) {
    if (!words || words.length < 30) return null;
    const gaps = [];
    for (let i = 1; i < words.length; i += 1) gaps.push(Math.max(0, words[i].start - words[i - 1].end));
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length * 0.9)];
}

/**
 * Profile from measured reference metrics (python /process/analyze-style) and its transcript.
 * @param {object} m metrics
 * @param {Array<{text,start,end}>} words transcript in seconds (may be empty)
 */
export function profileFromMetrics(m, words = []) {
    const pacing = m.pacing || {};
    const cap = m.captions || {};
    const faces = m.faces || {};
    const avgShot = pacing.avgShotSec || 6;
    const label = avgShot < 2.8 || pacing.cutsPerMinute >= 20 ? 'fast' : avgShot < 6.5 ? 'medium' : 'slow';
    const measuredPause = keptPause(words);
    const maxPauseSec = round(clamp(measuredPause ?? { fast: 0.2, medium: 0.45, slow: 0.75 }[label], 0.12, 1.0));

    // Talking-head edits usually cut between takes of the same shot; most of those cuts are punch-ins.
    const talkingHead = (faces.share || 0) >= 0.6;
    const punchRate = Math.max(pacing.punchInsPerMinute || 0, talkingHead ? (pacing.cutsPerMinute || 0) * 0.45 : 0);
    const zooms = {
        punchIns: punchRate >= 1,
        perMinute: round(clamp(punchRate, 0, 20), 1),
        amount: label === 'fast' ? 0.14 : 0.18,
        slowZoom: (pacing.zoomMotionShare || 0) >= 0.15,
    };

    const rate = speechRate(words);
    let wordsPerCaption = cap.estimatedWordsPerCaption || 3;
    if (cap.present && rate && cap.changesPerSecond > 0.2) wordsPerCaption = Math.round(clamp(rate / cap.changesPerSecond, 1, 7));
    const ratio = ratioOf(m.width, m.height);
    const big = (cap.textHeight || 0) >= 0.032;
    const captions = {
        enabled: !!cap.present,
        y: round(clamp(cap.y ?? (ratio === '16:9' ? 0.86 : 0.7), 0.1, 0.92), 3),
        wordsPerCaption,
        // Pixels cannot tell letter case; short, big captions are almost always uppercase.
        uppercase: !!cap.present && wordsPerCaption <= 3 && big,
        font: cap.background ? 'Poppins' : big ? 'Anton' : 'Poppins',
        size: round(clamp((cap.textHeight || 0.035) * 1.15, 0.025, 0.075), 4),
        color: cap.color || '#ffffff',
        highlight: cap.highlight || null,
        background: !!cap.background,
        outline: cap.outline !== false && !cap.background,
        animation: (cap.changesPerSecond || 0) >= 1.2 ? 'pop' : 'fade',
    };

    return {
        format: { ratio },
        pacing: { label, maxPauseSec, avgShotSec: avgShot, cutsPerMinute: pacing.cutsPerMinute || 0 },
        zooms,
        color: { look: lookOf(m.color), stats: m.color || null },
        captions,
        hook: { title: !!m.hook?.textOverlay, coldOpen: false },
        callouts: { enabled: label === 'fast', perMinute: label === 'fast' ? 3 : 0.8 },
        speech: { wordsPerSecond: rate ? round(rate) : null },
        measured: {
            durationSec: m.durationSec,
            width: m.width,
            height: m.height,
            cutsPerMinute: pacing.cutsPerMinute,
            avgShotSec: pacing.avgShotSec,
            punchInsPerMinute: pacing.punchInsPerMinute,
            captionShare: cap.share,
            faceShare: faces.share,
        },
    };
}

function describe(profile) {
    const p = profile;
    const parts = [
        `${p.pacing.label} pacing (about ${p.pacing.avgShotSec}s per shot, pauses over ${p.pacing.maxPauseSec}s cut)`,
        p.zooms.punchIns ? `punch-in zooms about ${p.zooms.perMinute} times a minute` : p.zooms.slowZoom ? 'slow push-in zooms' : 'no zooms',
        `${p.color.look} colour`,
        p.captions.enabled
            ? `${p.captions.uppercase ? 'uppercase ' : ''}${p.captions.wordsPerCaption}-word captions ${p.captions.y < 0.4 ? 'near the top' : p.captions.y < 0.75 ? 'mid-screen' : 'near the bottom'}${p.captions.highlight ? ' with a coloured active word' : ''}`
            : 'no burned-in captions',
    ];
    return `${parts.join(', ')}.`.replace(/^./, (c) => c.toUpperCase());
}

/**
 * Names the style and fills in what pixels cannot measure (caption case, hook type), using the AI
 * when available. Keyframes go along for vision-capable models; the free fallback reads text only.
 */
export async function enrichProfile(profile, { keyframes = [], transcript = '', title = '' } = {}) {
    const fallbackName = `${profile.pacing.label === 'fast' ? 'Fast' : profile.pacing.label === 'slow' ? 'Relaxed' : 'Steady'} ${profile.format.ratio === '16:9' ? 'long-form' : 'short-form'} style`;
    const base = { ...profile, name: title ? `${title.slice(0, 40)} style` : fallbackName, summary: describe(profile) };
    const parts = [
        {
            text: `You are a senior video editor. Below are measurements of a reference video's editing style${title ? ` ("${title}")` : ''}.
MEASUREMENTS: ${JSON.stringify({ format: profile.format, pacing: profile.pacing, zooms: profile.zooms, color: { look: profile.color.look, stats: profile.color.stats }, captions: profile.captions, hook: profile.hook, measured: profile.measured })}
OPENING LINES SPOKEN: ${JSON.stringify(transcript.slice(0, 500))}
${keyframes.length ? 'Frames from the video are attached.' : ''}
Return ONLY JSON:
{"name":"2–5 word name for this editing style","summary":"two plain sentences describing how it is edited, for a creator choosing a style","uppercaseCaptions":true|false|null,"hookStyle":"question|bold-claim|cold-open|none","calloutsUseful":true|false}`,
        },
        ...keyframes.slice(0, 3).map((k) => ({ inlineData: { mimeType: 'image/jpeg', data: String(k).split(',')[1] || '' } })),
    ];
    try {
        const ai = await generateJson(parts, { temperature: 0.4 });
        const name = String(ai?.name || '').replace(/\s+/g, ' ').trim().slice(0, 48);
        const summary = String(ai?.summary || '').replace(/\s+/g, ' ').trim().slice(0, 400);
        const next = { ...base, name: name || base.name, summary: summary ? `${summary} ${describe(profile)}` : base.summary };
        if (typeof ai?.uppercaseCaptions === 'boolean' && profile.captions.enabled) next.captions = { ...profile.captions, uppercase: ai.uppercaseCaptions };
        if (ai?.hookStyle === 'cold-open') next.hook = { ...profile.hook, coldOpen: true };
        if (ai?.hookStyle === 'question' || ai?.hookStyle === 'bold-claim') next.hook = { ...profile.hook, title: true };
        if (typeof ai?.calloutsUseful === 'boolean') next.callouts = { ...profile.callouts, enabled: ai.calloutsUseful };
        return next;
    } catch (error) {
        console.warn('[AI Edit] Style naming fell back:', error.message);
        return base;
    }
}

/** Accepts a profile edited by the user (from the client) and keeps every field in range. */
export function sanitizeProfile(raw = {}) {
    const preset = PRESETS[0];
    const c = raw.captions || {};
    const hex = (v, fallback) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
    return {
        name: String(raw.name || 'My style').slice(0, 48),
        summary: String(raw.summary || '').slice(0, 600),
        format: { ratio: RATIOS.includes(raw.format?.ratio) ? raw.format.ratio : preset.format.ratio },
        pacing: {
            label: ['fast', 'medium', 'slow'].includes(raw.pacing?.label) ? raw.pacing.label : 'medium',
            maxPauseSec: clamp(Number(raw.pacing?.maxPauseSec) || 0.45, 0.1, 1.5),
            avgShotSec: clamp(Number(raw.pacing?.avgShotSec) || 5, 0.5, 60),
            cutsPerMinute: clamp(Number(raw.pacing?.cutsPerMinute) || 0, 0, 120),
        },
        zooms: {
            punchIns: !!raw.zooms?.punchIns,
            perMinute: clamp(Number(raw.zooms?.perMinute) || 0, 0, 30),
            amount: clamp(Number(raw.zooms?.amount) || 0.15, 0.04, 0.4),
            slowZoom: !!raw.zooms?.slowZoom,
        },
        color: {
            look: String(raw.color?.look || 'natural').slice(0, 20),
            stats: raw.color?.stats && typeof raw.color.stats === 'object' ? Object.fromEntries(Object.entries(raw.color.stats).filter(([, v]) => Number.isFinite(v)).slice(0, 10)) : null,
            target: raw.color?.target && typeof raw.color.target === 'object' ? sanitizeGrade(raw.color.target) : null,
        },
        captions: {
            enabled: c.enabled !== false,
            y: clamp(Number(c.y) || 0.75, 0.05, 0.95),
            wordsPerCaption: Math.round(clamp(Number(c.wordsPerCaption) || 3, 1, 10)),
            uppercase: !!c.uppercase,
            font: CAPTION_FONTS.includes(c.font) ? c.font : 'Poppins',
            size: clamp(Number(c.size) || 0.04, 0.02, 0.09),
            color: hex(c.color, '#ffffff'),
            highlight: c.highlight ? hex(c.highlight, null) : null,
            background: !!c.background,
            outline: !!c.outline,
            animation: ['pop', 'fade', 'none'].includes(c.animation) ? c.animation : 'fade',
        },
        hook: { title: raw.hook?.title !== false, coldOpen: !!raw.hook?.coldOpen },
        callouts: { enabled: !!raw.callouts?.enabled, perMinute: clamp(Number(raw.callouts?.perMinute) || 0, 0, 10) },
        speech: { wordsPerSecond: Number(raw.speech?.wordsPerSecond) || null },
        measured: raw.measured && typeof raw.measured === 'object' ? raw.measured : null,
        source: raw.source && typeof raw.source === 'object' ? { type: String(raw.source.type || 'upload').slice(0, 20), url: raw.source.url ? String(raw.source.url).slice(0, 500) : null, title: raw.source.title ? String(raw.source.title).slice(0, 150) : null } : { type: 'upload' },
    };
}

export function sanitizeGrade(g = {}) {
    return {
        brightness: clamp(Number(g.brightness) || 0, -0.3, 0.3),
        contrast: clamp(Number(g.contrast) || 1, 0.5, 1.8),
        saturation: clamp(Number.isFinite(Number(g.saturation)) ? Number(g.saturation) : 1, 0, 2),
        temperature: clamp(Number(g.temperature) || 0, -1, 1),
    };
}
