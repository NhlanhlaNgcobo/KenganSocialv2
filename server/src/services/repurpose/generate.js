import { generateJson } from '../gemini-json.js';

/**
 * One source → posts written natively for each platform (in the spirit of Blotato's
 * repurposing). Each platform has its own format, length and conventions.
 */

export const PLATFORMS = {
    instagram: {
        label: 'Instagram',
        schedulable: false,
        spec: 'An Instagram caption, max 2,200 characters. First line hooks before the "more" cut (under 125 characters, no hashtags). Short paragraphs, emojis only where natural. Clear call to action. Then 8–12 relevant hashtags mixing broad and niche.',
        shape: '{"text": "caption without hashtags", "hashtags": ["#tag"]}',
    },
    tiktok: {
        label: 'TikTok',
        schedulable: false,
        spec: 'A 30–45 second talking-head script for TikTok/Reels/Shorts plus a caption. Script: hook in the first 3 seconds, 3 punchy beats, payoff, call to action; written as spoken lines. Caption max 150 characters with 3–5 hashtags.',
        shape: '{"script": ["line 1", "line 2"], "caption": "..."}',
    },
    facebook: {
        label: 'Facebook',
        schedulable: true,
        spec: 'A Facebook post, 80–250 words. Friendly and story-led, easy to share. End with a question or call to action. At most 2 hashtags.',
        shape: '{"text": "..."}',
    },
    youtube: {
        label: 'YouTube',
        schedulable: false,
        spec: 'YouTube metadata for a video on this topic: title max 60 characters with the main keyword first; description whose first 2 lines are compelling, then a short summary and a subscribe call to action; 8–12 tags.',
        shape: '{"title": "...", "description": "...", "tags": ["tag"]}',
    },
};

export const TONES = ['Professional', 'Friendly', 'Bold', 'Educational', 'Witty'];

// Social platforms show markdown literally, so **bold**, __bold__ and # headings are stripped.
const plain = (t) => t.replace(/\*\*(.+?)\*\*/gs, '$1').replace(/__(.+?)__/gs, '$1').replace(/^#{1,6}\s+/gm, '');
const str = (v, max) => (typeof v === 'string' ? plain(v.trim()).slice(0, max) : '');
const list = (v, maxItems, maxLen) => (Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : []);

/** Validates and trims the model output for one platform; returns null when unusable. */
function normalizeDraft(platform, raw) {
    if (!raw || typeof raw !== 'object') return null;
    switch (platform) {
        case 'instagram': {
            const text = str(raw.text, 2200);
            const hashtags = list(raw.hashtags, 15, 40).map((h) => (h.startsWith('#') ? h : `#${h}`).replace(/\s+/g, ''));
            return text ? { text, hashtags } : null;
        }
        case 'tiktok': {
            const script = list(raw.script, 15, 300);
            const caption = str(raw.caption, 300);
            return script.length || caption ? { script, caption } : null;
        }
        case 'youtube': {
            const title = str(raw.title, 100);
            const description = str(raw.description, 5000);
            return title ? { title, description, tags: list(raw.tags, 15, 40) } : null;
        }
        default: {
            const text = str(raw.text, 3000);
            return text ? { text } : null;
        }
    }
}

/** The text that gets posted for a draft (used for copy and scheduling). */
export function draftToText(platform, draft) {
    if (!draft) return '';
    switch (platform) {
        case 'instagram':
            return `${draft.text}\n\n${draft.hashtags.join(' ')}`.trim();
        case 'tiktok':
            return draft.caption;
        case 'youtube':
            return `${draft.title}\n\n${draft.description}`;
        default:
            return draft.text;
    }
}

/**
 * @param {object} opts
 * @param {string} opts.title       source title (may be empty)
 * @param {string} opts.text        source text (article, transcript or notes)
 * @param {string[]} opts.platforms keys of PLATFORMS
 * @param {string} opts.tone        one of TONES
 * @param {string} [opts.audience]
 * @param {string} [opts.cta]
 */
export async function generateDrafts({ title, text, platforms, tone, audience, cta }) {
    const wanted = platforms.filter((p) => PLATFORMS[p]);
    const prompt = `You are a social media strategist who repurposes one piece of source content into native posts for each platform.

SOURCE${title ? ` — "${title}"` : ''}:
"""
${text}
"""

Voice: ${tone}.${audience ? ` Audience: ${audience}.` : ''}${cta ? ` Call to action to use where it fits: ${cta}.` : ''}

Rules for every platform:
- Use only facts, numbers and claims that appear in the source. Never invent statistics, quotes, customers or results.
- Write natively for each platform; do not paste the same text everywhere.
- Plain language. No clichés such as "game-changer", "unlock", "dive in", "in today's fast-paced world" or "excited to share".
- Write in the same language as the source.
- Plain text only: no markdown (no **bold**, no # headings). Social platforms show those symbols literally.
- Respect the post counts and lengths given for each platform.

Write for these platforms:
${wanted.map((p) => `- "${p}": ${PLATFORMS[p].spec} Shape: ${PLATFORMS[p].shape}`).join('\n')}

Return ONLY JSON: {"angle": "one sentence: the core idea you built every post around", ${wanted.map((p) => `"${p}": ${PLATFORMS[p].shape}`).join(', ')}}`;

    const raw = await generateJson([{ text: prompt }], { temperature: 0.7 });
    const drafts = {};
    for (const platform of wanted) {
        const draft = normalizeDraft(platform, raw?.[platform]);
        if (draft) drafts[platform] = { ...draft, postText: draftToText(platform, draft) };
    }
    if (!Object.keys(drafts).length) throw new Error('The writer returned nothing usable. Try again.');
    return { angle: str(raw?.angle, 300), drafts };
}
