import sharp from 'sharp';
import { generateJson } from '../gemini-json.js';
import { AD_LAYOUTS, VISUAL_LAYOUTS } from './ad-templates.js';
import { businessBlock, voiceBlock } from './carousel-plan.js';

/**
 * Image-ad planner: writes N distinct ad concepts (copy, layout, backdrop prompt and the text for
 * the ad platform's own fields) in the brand voice. Also reads a reference ad's structure for
 * "Recreate", so a competitor's winning format can be rebuilt with this brand's own words,
 * colours and product. Only the structure carries over, never their brand, copy or images.
 */

export const AD_GOALS = {
    sales: 'Sell the product now: a clear reason to buy and a direct call to action',
    leads: 'Get enquiries or sign-ups: low-commitment call to action',
    traffic: 'Get clicks to the website or shop: curiosity and a clear next step',
    awareness: 'Make people remember the brand: bold, simple, memorable',
    launch: 'Announce something new and create urgency',
};

/** Angles the variations rotate through, so a set tests genuinely different messages. */
const ANGLES = ['benefit', 'pain point', 'social proof', 'offer or urgency', 'curiosity', 'how it works', 'comparison', 'identity'];

const cut = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
/** Short labels end on a whole word, never mid-word ("Free delivery in Durba"). */
const cutWords = (s, n) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    if (t.length <= n) return t;
    const head = t.slice(0, n + 1);
    return head.slice(0, Math.max(head.lastIndexOf(' '), 0)).trim();
};

const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9']{3,}/g) || [];

/** True when at least 60% of the quote's words appear in one saved proof entry. */
export function quoteFromProof(quote, proof = []) {
    const q = words(quote);
    if (q.length < 3) return false;
    return (Array.isArray(proof) ? proof : []).some((entry) => {
        const have = new Set(words(entry));
        return q.filter((w) => have.has(w)).length / q.length >= 0.6;
    });
}

/** Normalises one ad concept from the AI or from the user's edits. */
export function normalizeAd(a = {}) {
    return {
        layout: AD_LAYOUTS[a.layout] ? a.layout : 'bold',
        // Keep the label to the angle's name ("Pain point: project chaos" → "pain point").
        angle: ANGLES.find((x) => String(a.angle || '').toLowerCase().startsWith(x.split(' ')[0])) || cut(String(a.angle || '').split(/[:—-]/)[0], 24),
        badge: cutWords(a.badge, 22),
        headline: cut(a.headline, 90),
        subhead: cut(a.subhead, 140),
        offer: cut(a.offer, 18),
        cta: cutWords(a.cta, 24),
        quote: a.quote?.text ? { text: cut(a.quote.text, 160), author: cut(a.quote.author, 40) } : null,
        imagePrompt: a.imagePrompt ? cut(a.imagePrompt, 600) : null,
        // The ad platform's own text fields (Meta: primary text, headline, description).
        primaryText: String(a.primaryText || '').trim().slice(0, 600),
        adHeadline: cut(a.adHeadline, 40),
        description: cut(a.description, 30),
    };
}

function structureBlock(s) {
    if (!s) return '';
    return `Rebuild the structure of a reference ad the user likes (copy its format and persuasion pattern, not its brand, words, claims or images):
- Format: ${s.format}
- Hook type: ${s.hookType}
- Text blocks: ${s.textBlocks.join(' | ')}
- Visual: ${s.visual}
- Closest layout: ${s.layout}
Use the "${s.layout}" layout for most concepts and keep the same hook type and text hierarchy.`;
}

/**
 * @param {object} p
 * @param {object} p.kit brand kit
 * @param {object} p.product { name, description, hasPhoto, cutout }
 * @param {string} p.idea what the ad is about / the offer, in the user's words
 * @param {string} p.goal key of AD_GOALS
 * @param {number} p.count concepts to write (1-6)
 * @param {boolean} p.withImages whether each concept should get an AI backdrop prompt
 * @param {object} [p.structure] from analyzeAdStructure (Recreate)
 * @param {object[]} [p.avoid] existing concepts to differ from (More variations)
 */
export async function planAds({ kit, product = {}, idea = '', goal = 'sales', count = 3, withImages = false, structure = null, avoid = [] }) {
    const layouts = Object.entries(AD_LAYOUTS)
        .map(([id, d]) => `- ${id}: ${d}`)
        .join('\n');
    // A testimonial ad needs a real one: without customer proof in the business profile the layout
    // isn't offered at all, so no model (small local ones especially) can invent a quote.
    const hasProof = (kit.business?.proof || []).some((p) => String(p || '').trim().length > 10);
    const usable = (product.hasPhoto ? Object.keys(AD_LAYOUTS) : withImages ? Object.keys(AD_LAYOUTS).filter((l) => l !== 'product') : ['bold', 'offer', 'testimonial']).filter(
        (l) => l !== 'testimonial' || hasProof
    );
    // More variations: prefer angles the set hasn't tried yet.
    const tried = new Set(avoid.map((a) => a.angle));
    const untried = ANGLES.filter((a) => !tried.has(a));
    const angles = (untried.length >= count ? untried : ANGLES).slice(0, Math.max(count, 3)).join(', ');
    const style = kit.style?.summary ? `Visual style learned from the brand's references: ${kit.style.summary}` : '';
    // What the ad is FOR comes first and wins: the business profile is background (voice, audience,
    // proof), and may describe other products that must not leak into this ad.
    const subject = product.name
        ? `THE AD IS FOR THIS PRODUCT ONLY: ${product.name}${product.description ? ` — ${product.description}` : ''}. Every concept advertises this product. Do not mention or promote any other product or service, even if the business info below lists them.`
        : product.hasPhoto
          ? 'THE AD IS FOR THE PRODUCT IN THE USER\'S PHOTO. Describe it only in terms the user gave; do not guess its name.'
          : 'No specific product: advertise the business.';
    const prompt = `You are a performance-marketing creative director and copywriter for ${kit.name || 'a business'}. Write ${count} single-image ad concept${count > 1 ? 's' : ''} for Meta (Facebook/Instagram) and TikTok.

${subject}
${idea ? `THE USER'S MESSAGE (true; build every concept around it, and use its offer/price word for word where it fits): ${idea}` : ''}
Goal: ${AD_GOALS[goal] || AD_GOALS.sales}

Background about the business (for voice, audience and proof only):
${businessBlock(kit.business)}

${voiceBlock(kit.voice)}
${style}
${structureBlock(structure)}
${avoid.length ? `\nThese concepts already exist; make each new one clearly different in angle and headline:\n${avoid.map((a) => `- [${a.angle}] ${a.headline}`).join('\n')}` : ''}

Layouts (only use these: ${usable.join(', ')}):
${layouts}

Rules:
- Each concept uses a different angle, and "angle" is exactly one of: ${angles}. Where it fits, use a different layout too.
- If the user's message contains an offer or price, at least one concept uses the "offer" layout with it.
- headline: max 8 words, scroll-stopping, no clickbait. subhead: max 16 words, optional.
- cta: 1-3 words that name the action (e.g. "Shop now", "Book a call"). badge: optional 1-3 words ("New", "Free delivery").
- offer: only for the "offer" layout, and only a real offer/price from the user or business info (e.g. "30% off", "R299"). In that layout the headline must not repeat the offer; it says what the offer is on or why to act now.
- quote: only for "testimonial", and only a real testimonial from the business info; otherwise do not use that layout.
- Never invent prices, discounts, numbers, awards or testimonials that were not given.
- ${withImages ? `imagePrompt: a vivid, photographic, text-free backdrop scene that suits the brand${product.hasPhoto ? ' with an empty, well-lit surface or space in the centre where the real product photo will be placed (do not draw the product itself)' : ''}. No words, letters, logos or people's faces in close-up.` : 'imagePrompt: null.'}
- primaryText: the ad's main post text in the brand voice, 1-3 short sentences, ending with the CTA. adHeadline: max 40 characters. description: max 30 characters.
- South African English spelling if the business is in South Africa.

Return JSON:
{ "ads": [ { "angle": "", "layout": "", "badge": "", "headline": "", "subhead": "", "offer": "", "cta": "",
    "quote": null, "imagePrompt": null, "primaryText": "", "adHeadline": "", "description": "" } ] }
For "quote": {"text": "...", "author": "..."}.`;

    const raw = await generateJson([{ text: prompt }], { temperature: 0.8 });
    const ads = (Array.isArray(raw.ads) ? raw.ads : [])
        .map(normalizeAd)
        .filter((a) => a.headline || a.quote?.text)
        .slice(0, count)
        .map((a) => {
            let layout = usable.includes(a.layout) ? a.layout : usable[0];
            // A quote must come from the saved proof, not the model: most of its words have to
            // appear in one proof entry, otherwise it is dropped and the ad becomes text-only.
            if (layout === 'testimonial' && !quoteFromProof(a.quote?.text, kit.business?.proof)) {
                a = { ...a, quote: null };
                layout = usable.includes('bold') ? 'bold' : usable.find((l) => l !== 'testimonial');
            }
            if (layout === 'offer' && !a.offer) layout = product.hasPhoto ? 'product' : 'bold';
            const needsImage = withImages && (VISUAL_LAYOUTS.includes(layout) || layout === 'offer');
            return { ...a, layout, imagePrompt: needsImage ? a.imagePrompt : null };
        });
    if (!ads.length) throw Object.assign(new Error('The AI did not return usable ad concepts. Try again.'), { status: 502 });
    return ads;
}

/**
 * Reads the structure of a reference ad (a screenshot) so it can be rebuilt for this brand.
 * @param {Buffer} buffer
 */
export async function analyzeAdStructure(buffer) {
    const jpeg = await sharp(buffer).rotate().resize(768, 768, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    const raw = await generateJson(
        [
            { inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } },
            {
                text: `This is an advertisement someone wants to learn from. Describe its STRUCTURE only, so a different brand can use the same format with its own words and product. Do not copy its brand name, wording or claims.
Return JSON:
{
  "format": "one sentence: what kind of ad this is and how it is laid out",
  "hookType": "how the headline grabs attention, e.g. question, bold claim, big number, before/after, testimonial, offer",
  "textBlocks": ["the text elements in order of size, described generically, e.g. 'big 4-word benefit headline', 'small price line', 'button CTA'"],
  "visual": "what the picture shows and how: product on solid colour, lifestyle scene, person using it, flat lay, etc.",
  "layout": "the closest of: ${Object.keys(AD_LAYOUTS).join(', ')}",
  "why": "one sentence: why this format works"
}`,
            },
        ],
        { temperature: 0.2 }
    );
    const list = Array.isArray(raw.textBlocks) ? raw.textBlocks.map((t) => cut(t, 80)).filter(Boolean).slice(0, 6) : [];
    return {
        format: cut(raw.format, 200),
        hookType: cut(raw.hookType, 80),
        textBlocks: list,
        visual: cut(raw.visual, 200),
        layout: AD_LAYOUTS[raw.layout] ? raw.layout : 'scene',
        why: cut(raw.why, 200),
    };
}
