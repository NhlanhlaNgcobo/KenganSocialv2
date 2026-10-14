import { generateJson } from '../gemini-json.js';

/**
 * One source → posts written natively for each platform (in the spirit of Blotato's
 * repurposing). Each platform has its own format, length and conventions.
 */

export const PLATFORMS = {
    linkedin: {
        label: 'LinkedIn',
        schedulable: true,
        spec: 'A LinkedIn post, max 1,300 characters. Open with a bold insight or specific number on line 1. Short paragraphs of 1–2 lines with blank lines between. Practical takeaway. End with a question that invites comments. Up to 3 hashtags on the last line.',
        shape: '{"text": "..."}',
    },
    x: {
        label: 'X thread',
        schedulable: false,
        spec: 'An X (Twitter) thread of 4–7 posts, each max 270 characters. Post 1 is the hook and promises the payoff. One idea per post. The last post sums up and has a soft call to action. No hashtags except at most one in the last post.',
        shape: '{"thread": ["post 1", "post 2"]}',
    },
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
    threads: {
        label: 'Threads',
        schedulable: true,
        spec: 'A Threads post, max 500 characters. Conversational, a clear opinion or hot take from the source. No hashtags.',
        shape: '{"text": "..."}',
    },
    facebook: {
        label: 'Facebook',
        schedulable: false,
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

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v, maxItems, maxLen) => (Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : []);

/** Validates and trims the model output for one platform; returns null when unusable. */
function normalizeDraft(platform, raw) {
    if (!raw || typeof raw !== 'object') return null;
    switch (platform) {
        case 'x': {
            const thread = list(raw.thread, 10, 280);
            return thread.length ? { thread } : null;
        }
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
            const text = str(raw.text, platform === 'threads' ? 500 : 3000);
            return text ? { text } : null;
        }
    }
}

/** The text that gets posted for a draft (used for copy and scheduling). */
export function draftToText(platform, draft) {
    if (!draft) return '';
    switch (platform) {
        case 'x':
            return draft.thread.map((p, i) => `${i + 1}/${draft.thread.length} ${p}`).join('\n\n');
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
