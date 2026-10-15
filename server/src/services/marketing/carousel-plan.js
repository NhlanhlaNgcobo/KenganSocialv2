import { generateJson } from '../gemini-json.js';
import { LAYOUTS } from './carousel-templates.js';

/**
 * Carousel planner: the AI writes the slides (copy + layout + optional image prompts) in the
 * brand's voice, from a website, a topic or pasted text. Same idea as the launch-video
 * storyboard planner (services/brag/plan.js), with slides instead of scenes.
 */

export const GOALS = {
    educate: 'Teach something useful that positions the brand as the expert',
    promote: 'Sell a product, offer or service with a clear reason to buy now',
    engage: 'Start a conversation: relatable, opinion or question-led',
    launch: 'Announce something new and build excitement',
    proof: 'Show results: testimonials, case study, before/after',
};

const cut = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const list = (v, max, len) =>
    (Array.isArray(v) ? v : [])
        .map((x) => cut(x, len))
        .filter(Boolean)
        .slice(0, max);

/** Normalises one slide from the AI or from the user's edits. */
export function normalizeSlide(s = {}) {
    const layout = LAYOUTS[s.layout] ? s.layout : 'statement';
    return {
        layout,
        kicker: cut(s.kicker, 40),
        headline: cut(s.headline, 120),
        body: cut(s.body, 260),
        bullets: list(s.bullets, 5, 110),
        stat: s.stat ? { value: cut(s.stat.value, 12), label: cut(s.stat.label, 80) } : null,
        quote: s.quote ? { text: cut(s.quote.text, 260), author: cut(s.quote.author, 60) } : null,
        compare: s.compare
            ? { leftTitle: cut(s.compare.leftTitle, 30), left: list(s.compare.left, 4, 70), rightTitle: cut(s.compare.rightTitle, 30), right: list(s.compare.right, 4, 70) }
            : null,
        cta: cut(s.cta, 40),
        imagePrompt: s.imagePrompt ? cut(s.imagePrompt, 600) : null,
    };
}

function voiceBlock(voice) {
    if (!voice?.summary) return 'No saved brand voice: write clearly and warmly, short sentences.';
    return [
        `Voice: ${voice.summary}`,
        voice.attributes?.length ? `Traits: ${voice.attributes.map((a) => `${a.is}${a.isNot ? ` (not ${a.isNot})` : ''}`).join(', ')}` : '',
        voice.wordsToUse?.length ? `Use words like: ${voice.wordsToUse.join(', ')}` : '',
        voice.wordsToAvoid?.length ? `Never use: ${voice.wordsToAvoid.join(', ')}` : '',
        voice.sentenceStyle ? `Sentences: ${voice.sentenceStyle}` : '',
        `Emoji: ${voice.emoji || 'light'}`,
        voice.ctaStyle ? `CTA style: ${voice.ctaStyle}` : '',
        voice.hashtags ? `Hashtags: ${voice.hashtags}` : '',
    ]
        .filter(Boolean)
        .join('\n');
}

function businessBlock(b) {
    if (!b?.oneLiner && !b?.whatYouSell) return '';
    return [
        `Business: ${b.oneLiner || b.whatYouSell}`,
        b.products?.length ? `Products: ${b.products.map((p) => `${p.name}${p.price ? ` (${p.price})` : ''}${p.description ? `: ${p.description}` : ''}`).join('; ')}` : '',
        b.audience?.length ? `Audience: ${b.audience.join('; ')}` : '',
        b.painPoints?.length ? `Pain points: ${b.painPoints.join('; ')}` : '',
        b.sellingPoints?.length ? `Selling points: ${b.sellingPoints.join('; ')}` : '',
        b.offers?.length ? `Offers: ${b.offers.join('; ')}` : '',
        b.proof?.length ? `Proof: ${b.proof.join('; ')}` : '',
        b.primaryCta ? `Main CTA: ${b.primaryCta}` : '',
    ]
        .filter(Boolean)
        .join('\n');
}

/**
 * @param {object} p
 * @param {object} p.kit brand kit (name, voice, style, business)
 * @param {string} p.source source material (website copy, topic or pasted text)
 * @param {string} p.goal key of GOALS
 * @param {number} p.slideCount 4-10
 * @param {number} p.imageSlots how many slides may request an AI image (0-3)
 * @param {string} [p.extra] user's extra instructions
 */
export async function planCarousel({ kit, source, goal = 'educate', slideCount = 7, imageSlots = 0, extra = '' }) {
    const layouts = Object.entries(LAYOUTS)
        .map(([id, d]) => `- ${id}: ${d}`)
        .join('\n');
    const style = kit.style?.summary ? `Visual style learned from the brand's references: ${kit.style.summary}${kit.style.layoutPatterns?.length ? ` Layouts they use: ${kit.style.layoutPatterns.join(', ')}.` : ''}` : '';
    const prompt = `You are a social media strategist and copywriter for ${kit.name || 'a business'}. Plan an Instagram/LinkedIn carousel.

Goal: ${GOALS[goal] || GOALS.educate}
Slides: exactly ${slideCount}
${businessBlock(kit.business)}

${voiceBlock(kit.voice)}
${style}

Source material (use facts from here; do not invent prices, numbers, claims or testimonials that are not in it):
"""
${String(source).slice(0, 12000)}
"""
${extra ? `\nExtra instructions from the user: ${extra}` : ''}

Layouts available:
${layouts}

Rules:
- Slide 1 is "cover" with a scroll-stopping hook headline (max 8 words). The last slide is "cta".
- One idea per slide. Headlines max 10 words; body max 30 words; bullets max 12 words each.
- Vary layouts; only use "stat" when the source gives a real number, "quote" only for a real quote/testimonial from the source.
- ${imageSlots > 0 ? `Up to ${imageSlots} slides (cover and/or "image" layout) may have an "imagePrompt": a vivid, text-free scene that fits the brand style (no words, letters or logos in the image).` : 'Set "imagePrompt" to null on every slide.'}
- Write in the brand voice. Use South African English spelling if the business is in South Africa.

Return JSON:
{
  "title": "internal name for this carousel",
  "caption": "post caption in the brand voice, 2-4 short paragraphs, ending with the CTA",
  "hashtags": ["5-8 relevant hashtags without #"],
  "slides": [
    {"layout": "cover", "kicker": "", "headline": "", "body": "", "bullets": [], "stat": null, "quote": null,
     "compare": null, "cta": "", "imagePrompt": null}
  ]
}
For "stat": {"value": "87%", "label": "..."}. For "quote": {"text": "...", "author": "..."}. For "comparison": {"leftTitle": "", "left": [], "rightTitle": "", "right": []}.`;

    const raw = await generateJson([{ text: prompt }], { temperature: 0.7 });
    let slides = (Array.isArray(raw.slides) ? raw.slides : []).map(normalizeSlide).filter((s) => s.headline || s.quote?.text || s.stat?.value || s.bullets.length);
    if (slides.length < 3) throw Object.assign(new Error('The AI did not return a usable carousel. Try again.'), { status: 502 });
    slides = slides.slice(0, 10);
    // Respect the image budget even if the model ignores it.
    let left = imageSlots;
    slides = slides.map((s) => {
        if (s.imagePrompt && left > 0 && (s.layout === 'cover' || s.layout === 'image')) {
            left -= 1;
            return s;
        }
        // No image for this slide: an "image" layout without one becomes a statement.
        return { ...s, imagePrompt: null, layout: s.layout === 'image' ? 'statement' : s.layout };
    });
    return {
        title: cut(raw.title, 80) || 'Carousel',
        caption: String(raw.caption || '').trim().slice(0, 2200),
        hashtags: list(raw.hashtags, 10, 40).map((h) => h.replace(/^#/, '').replace(/\s+/g, '')),
        slides,
    };
}

/** Builds the source material for a website-based carousel from the site read. */
export function sourceFromSite(site) {
    const c = site.copy || {};
    return [
        `${site.name}: ${site.tagline || ''}`,
        c.headings?.length ? `Headings:\n- ${c.headings.join('\n- ')}` : '',
        c.paragraphs?.length ? `Copy:\n- ${c.paragraphs.join('\n- ')}` : '',
        c.listItems?.length ? `Lists:\n- ${c.listItems.join('\n- ')}` : '',
        c.ctas?.length ? `Buttons: ${c.ctas.join(' | ')}` : '',
    ]
        .filter(Boolean)
        .join('\n\n');
}
