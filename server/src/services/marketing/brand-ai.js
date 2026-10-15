import sharp from 'sharp';
import { aiConfigured, generateJson } from '../gemini-json.js';

/**
 * AI analysis for the brand kit: brand voice from sample posts, tags for reference images,
 * and a style profile learned from the reference folder. All outputs are plain JSON the user
 * can edit; the brand kit's explicit colours/fonts/logo always override the style profile.
 */

export { aiConfigured };

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
const strings = (v, max = 12, len = 80) =>
    (Array.isArray(v) ? v : [])
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .slice(0, max)
        .map((s) => s.slice(0, len));
const HEX = /^#[0-9a-f]{6}$/i;

// ─── Brand voice ─────────────────────────────────────────────────────────────

/** Normalises a voice profile from the AI or from the user's edits. */
export function normalizeVoice(v = {}) {
    return {
        summary: String(v.summary || '').slice(0, 400),
        attributes: (Array.isArray(v.attributes) ? v.attributes : [])
            .slice(0, 5)
            .map((a) => ({ is: String(a?.is || '').slice(0, 40), isNot: String(a?.isNot || '').slice(0, 40) }))
            .filter((a) => a.is),
        tone: {
            casual: clamp(v.tone?.casual),
            funny: clamp(v.tone?.funny),
            irreverent: clamp(v.tone?.irreverent),
            enthusiastic: clamp(v.tone?.enthusiastic),
        },
        wordsToUse: strings(v.wordsToUse, 15, 40),
        wordsToAvoid: strings(v.wordsToAvoid, 15, 40),
        sentenceStyle: String(v.sentenceStyle || '').slice(0, 200),
        emoji: ['none', 'light', 'heavy'].includes(v.emoji) ? v.emoji : 'light',
        hashtags: String(v.hashtags || '').slice(0, 200),
        ctaStyle: String(v.ctaStyle || '').slice(0, 200),
        examples: strings(v.examples, 3, 600),
    };
}

export async function analyzeVoice(samples, { brandName = '', audience = '' } = {}) {
    const text = samples
        .map((s, i) => `Sample ${i + 1}:\n${String(s).trim().slice(0, 2000)}`)
        .join('\n\n');
    const prompt = `You are a brand strategist. From these real posts/copy by ${brandName || 'a business'}${audience ? ` (audience: ${audience})` : ''}, write a brand voice profile that a copywriter could follow exactly.

${text}

Return JSON:
{
  "summary": "2 sentences describing how this brand sounds",
  "attributes": [{"is": "confident", "isNot": "arrogant"}],            // 3-5 pairs
  "tone": {"casual": 0-100, "funny": 0-100, "irreverent": 0-100, "enthusiastic": 0-100},
                                                                          // casual: 0 formal, 100 casual; funny: 0 serious, 100 funny;
                                                                          // irreverent: 0 respectful, 100 irreverent; enthusiastic: 0 matter-of-fact, 100 enthusiastic
  "wordsToUse": ["words or phrases the brand actually uses"],
  "wordsToAvoid": ["words that would sound off-brand"],
  "sentenceStyle": "length, rhythm, person (we/you), punctuation habits",
  "emoji": "none" | "light" | "heavy",
  "hashtags": "how hashtags are used",
  "ctaStyle": "how calls to action are phrased",
  "examples": ["the 2 samples that best represent the voice, verbatim"]
}
Base everything on the samples; do not invent traits they don't show.`;
    return normalizeVoice(await generateJson([{ text: prompt }], { temperature: 0.3 }));
}

// ─── Reference images ────────────────────────────────────────────────────────

async function inlineImage(buffer, size = 512) {
    const jpeg = await sharp(buffer).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    return { inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } };
}

/** Caption and tags for one reference image. */
export async function tagReference(buffer) {
    const result = await generateJson(
        [
            await inlineImage(buffer),
            {
                text: `Describe this marketing reference image for a brand's design library. Return JSON:
{"caption": "one sentence: what it shows and how it is designed",
 "tags": ["6-10 short lowercase tags: subject, layout (e.g. quote card, product hero, list, big number), style (e.g. flat, photographic, 3d, minimal), mood"],
 "hasText": true|false,
 "kind": "photo" | "illustration" | "graphic-design" | "3d" | "mixed"}`,
            },
        ],
        { temperature: 0.2 }
    );
    return {
        caption: String(result.caption || '').slice(0, 240),
        tags: strings(result.tags, 10, 30).map((t) => t.toLowerCase()),
        hasText: !!result.hasText,
        kind: ['photo', 'illustration', 'graphic-design', '3d', 'mixed'].includes(result.kind) ? result.kind : 'mixed',
    };
}

/** Normalises a style profile from the AI or from the user's edits. */
export function normalizeStyle(s = {}) {
    return {
        summary: String(s.summary || '').slice(0, 500),
        palette: (Array.isArray(s.palette) ? s.palette : [])
            .filter((p) => HEX.test(String(p?.hex || '')))
            .slice(0, 8)
            .map((p) => ({ hex: String(p.hex).toLowerCase(), role: String(p.role || '').slice(0, 30) })),
        typography: String(s.typography || '').slice(0, 300),
        composition: String(s.composition || '').slice(0, 300),
        imagery: String(s.imagery || '').slice(0, 300),
        mood: strings(s.mood, 8, 30),
        layoutPatterns: strings(s.layoutPatterns, 10, 60),
        do: strings(s.do, 8, 120),
        dont: strings(s.dont, 8, 120),
        basedOn: Number(s.basedOn) || 0,
        analyzedAt: s.analyzedAt || null,
    };
}

/** Learns a style profile from up to 12 reference images (buffers). */
export async function analyzeStyle(buffers) {
    const parts = [];
    for (const b of buffers.slice(0, 12)) parts.push(await inlineImage(b, 448));
    parts.push({
        text: `These ${parts.length} images are a brand's own marketing references. Learn the visual style they share so new carousels and ads can match it. Return JSON:
{
  "summary": "3 sentences: the overall look and feel",
  "palette": [{"hex": "#rrggbb", "role": "background|primary|accent|text|highlight"}],   // 4-6 colours that recur
  "typography": "type style seen: serif/sans/script, weight, case, size contrast, alignment",
  "composition": "layout habits: text-heavy vs image-led, whitespace, grid, framing",
  "imagery": "photo/illustration/3d/flat, lighting, subjects, treatment",
  "mood": ["4-6 mood words"],
  "layoutPatterns": ["recurring slide/post layouts, e.g. big number hero, quote card, checklist, product on solid background"],
  "do": ["specific things to keep doing"],
  "dont": ["things that would break this style"]
}
Describe only what is visible across the images.`,
    });
    return normalizeStyle({ ...(await generateJson(parts, { temperature: 0.2 })), basedOn: parts.length - 1, analyzedAt: new Date().toISOString() });
}
