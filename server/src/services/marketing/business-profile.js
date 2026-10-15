import { generateJson } from '../gemini-json.js';

/**
 * Business profile: what a business sells, to whom, and why people buy, read from its website
 * the way the launch-video planner (services/brag/plan.js) reads a site: visible copy plus
 * screenshots. Stored on the brand kit and used by carousels, briefs and ad read-outs.
 */

const strings = (v, max = 8, len = 140) =>
    (Array.isArray(v) ? v : [])
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .slice(0, max)
        .map((s) => s.slice(0, len));

/** Normalises a profile from the AI or from the user's edits. */
export function normalizeBusiness(b = {}) {
    return {
        oneLiner: String(b.oneLiner || '').slice(0, 200),
        category: String(b.category || '').slice(0, 80),
        whatYouSell: String(b.whatYouSell || '').slice(0, 400),
        products: (Array.isArray(b.products) ? b.products : [])
            .slice(0, 8)
            .map((p) => ({ name: String(p?.name || '').slice(0, 80), description: String(p?.description || '').slice(0, 200), price: String(p?.price || '').slice(0, 40) }))
            .filter((p) => p.name),
        audience: strings(b.audience, 5, 160),
        painPoints: strings(b.painPoints, 6, 160),
        sellingPoints: strings(b.sellingPoints, 6, 160),
        offers: strings(b.offers, 6, 160),
        proof: strings(b.proof, 6, 160),
        contentPillars: strings(b.contentPillars, 6, 80),
        primaryCta: String(b.primaryCta || '').slice(0, 80),
        location: String(b.location || '').slice(0, 80),
        source: b.source ? String(b.source).slice(0, 300) : null,
        updatedAt: b.updatedAt || null,
    };
}

/**
 * @param {object} site output of extractBrandFromWebsite (copy, screenshots, name, tagline, url)
 */
export async function buildBusinessProfile(site) {
    const c = site.copy || {};
    const copyText = [
        `Site: ${site.url}`,
        `Name: ${site.name}`,
        site.tagline ? `Description: ${site.tagline}` : '',
        c.nav?.length ? `Navigation: ${c.nav.join(' | ')}` : '',
        c.headings?.length ? `Headings:\n- ${c.headings.join('\n- ')}` : '',
        c.paragraphs?.length ? `Paragraphs:\n- ${c.paragraphs.slice(0, 20).join('\n- ')}` : '',
        c.listItems?.length ? `List items:\n- ${c.listItems.slice(0, 20).join('\n- ')}` : '',
        c.ctas?.length ? `Buttons: ${c.ctas.join(' | ')}` : '',
    ]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 14000);

    const parts = (site.screenshots || []).slice(0, 2).map((data) => ({ inlineData: { mimeType: 'image/jpeg', data } }));
    parts.push({
        text: `You are a marketing strategist. Read this business's website (screenshots above, copy below) and describe the business so a content team can market it. Use only what the site shows; leave a field empty rather than guess.

${copyText}

Return JSON:
{
  "oneLiner": "what they do, for whom, in one sentence",
  "category": "e.g. restaurant, e-commerce fashion, B2B SaaS, salon",
  "whatYouSell": "2-3 sentences",
  "products": [{"name": "", "description": "", "price": "as shown, or empty"}],
  "audience": ["who buys, as specific as the site allows"],
  "painPoints": ["problems the customer has that this solves"],
  "sellingPoints": ["why choose them: benefits/differentiators stated on the site"],
  "offers": ["current offers, promos, guarantees, free shipping, trials"],
  "proof": ["social proof: reviews, numbers, awards, press, clients"],
  "contentPillars": ["4-6 recurring content themes this brand could post about"],
  "primaryCta": "the main action they want visitors to take",
  "location": "city/country if stated"
}`,
    });
    return normalizeBusiness({ ...(await generateJson(parts, { temperature: 0.3 })), source: site.url, updatedAt: new Date().toISOString() });
}

/** Website copy as voice samples (paragraph-length lines only). */
export function voiceSamplesFromSite(site) {
    const c = site.copy || {};
    return [...(c.paragraphs || []), ...(c.headings || []).filter((h) => h.length > 30)]
        .filter((t) => t.length >= 40)
        .slice(0, 10);
}
