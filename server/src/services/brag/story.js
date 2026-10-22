import { headline as headlineText, shortLine } from './text.js';

/**
 * Copy mining for storyboards written without a model: finds the hook, the feature beats, list
 * items, a real figure and the call to action in a product's own words. Nothing is invented;
 * every line on screen is cut from the site or the user's description.
 */

const FILLER = new Set('a an the and or but of to in on for with your you our we is are be it its this that at by from as into than then so just very more most all every any can will'.split(' '));

/** Collapses whitespace and the doubled text of animated headings ("Fast Fast" → "Fast"). */
export function cleanText(text) {
    const once = (t) => { const w = t.split(' '); for (const k of [2, 3, 4]) { if (w.length < k || w.length % k) continue; const n = w.length / k; const c = w.slice(0, n).join(' '); if (Array.from({ length: k }, (_, i) => w.slice(i * n, (i + 1) * n).join(' ')).every((x) => x === c)) return c; } return t; };
    return once(String(text || '').replace(/\s+/g, ' ').trim());
}

/** Text from the product's interface (sample data, code, chat prompts) rather than marketing copy. */
export function isNoise(text) {
    const s = String(text || '').trim();
    if (!s || s.length < 12) return true;
    if (/^[a-z]/.test(s)) return true; // sentence fragments, sample prompts
    if (/[_{}<>@#|\\]|\b\w+\.(js|ts|py|json|tsx?)\b|https?:\/\//.test(s)) return true;
    if (/\?$/.test(s)) return true;
    if (/cookie|privacy policy|all rights reserved|©|terms of service/i.test(s)) return true;
    return false;
}

export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const words = (s) => String(s || '').split(/\s+/).filter(Boolean);
const stem = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
const endStop = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

export function sentencesOf(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?])\s+(?=[A-Z0-9“"])/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/** Drops the product's name and joining words from the start of a clause. */
export function stripLead(clause, name) {
    let s = String(clause || '').trim().replace(/[.;:,]+$/, '');
    if (name) s = s.replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'s)?\\s+`, 'i'), '');
    s = s.replace(/^(?:(?:and|with|then|so|plus|while|also|which|that|it|you can|lets you|helps you|allows you to)\s+)+/i, '');
    s = s.replace(/^(?:is|are)\s+(?=an?\s|the\s)/i, '');
    return s.trim();
}

/** Splits a sentence into clauses at ", with", ";", dashes and at " and " between two actions. */
export function clausesOf(sentence) {
    const parts = String(sentence || '')
        .replace(/[.!?]+$/, '')
        .split(/,\s+(?=(?:with|so|plus|then|while|and then|all|it|they|we|you)\b)|;\s+|\s+[—–]\s+|\s+-\s+/i);
    const out = [];
    for (const part of parts) {
        // " and " joins two actions ("Schedule everything … and see what performs") unless it
        // closes a list ("TikTok, Reels and Shorts") or joins two short nouns.
        const m = part.match(/^(.*\S)\s+and\s+(\S.*)$/);
        if (m) {
            const [, left, right] = m;
            const inList = /,\s*[^,]{1,30}$/.test(left);
            const first = words(right)[0] || '';
            if (!inList && words(left).length >= 4 && words(right).length >= 2 && /^[a-z]/.test(first) && !FILLER.has(first) && !/^(more|less|other|many|new)$/.test(first)) {
                out.push(left.trim(), right.trim());
                continue;
            }
        }
        out.push(part.trim());
    }
    return out.filter(Boolean);
}

/** "for TikTok, Reels and Shorts" → ['TikTok', 'Reels', 'Shorts'] (2–4 short items). */
export function listItems(text) {
    // Capitalised items ("TikTok, Reels and Shorts"), not counting a sentence's first word.
    const m = String(text || '').match(/(?<!^|[.!?]\s)([A-Z][\w+.&'-]*(?:\s[A-Z][\w+.&'-]*)?(?:,\s+[A-Z][\w+.&'-]*(?:\s[A-Z][\w+.&'-]*)?)*,?\s+(?:and|or|&)\s+[A-Z][\w+.&'-]*(?:\s[A-Z][\w+.&'-]*)?)/);
    if (m) {
        const items = m[1].split(/,\s+|\s+(?:and|or|&)\s+/).map((s) => s.trim()).filter(Boolean);
        if (items.length >= 2 && items.length <= 4) return items;
    }
    // "captions and brand colours added…" → ['Captions', 'Brand colours']
    const pair = String(text || '').match(/^([a-z][a-z-]+(?:\s[a-z-]+)?)\s+and\s+([a-z][a-z-]+(?:\s[a-z-]+)?)\s+(?:added|built|included|done|handled|made|sorted|taken care)/i);
    if (pair) return [cap(pair[1]), cap(pair[2])];
    return [];
}

/** "X turns A into B…" → { from: 'A', to: 'B', rest: '…' } */
export function transformation(text) {
    const m = String(text || '').match(/\b(?:turns?|transforms?|converts?|changes?|makes?|repurposes?)\s+(.{3,45}?)\s+into\s+(.{3,60}?)(?=\s+(?:for|with|in|on|so|that|across|—|–|-)\s|[,.;:!?]|$)/i);
    if (!m) return null;
    const after = String(text).slice(m.index + m[0].length).replace(/^[,\s]+/, '');
    const rest = after.split(/,\s+(?=with|so|plus|then|while)\b|[.;]/i)[0].trim();
    return { from: m[1].trim(), to: m[2].trim(), rest };
}

/** The opening line: the product's promise, in its own words. */
export function findHook(source, name) {
    const pool = [source.description, ...(source.paragraphs || [])].filter((t) => t && !isNoise(t));
    const turn = (text) => {
        const t = transformation(text);
        return t && words(t.from).length <= 5 && words(t.to).length <= 6 ? { text: `${cap(t.from)}.\nInto ${t.to}.`, used: text, transform: t } : null;
    };
    // The product's own summary first, then its hero heading, then deeper copy.
    const fromDescription = turn(source.description);
    if (fromDescription) return fromDescription;
    const hero = cleanText((source.headings || [])[0]);
    if (hero && words(hero).length <= 10 && !isNoise(hero) && hero.toLowerCase() !== String(name).toLowerCase()) return { text: hero, used: hero };
    for (const text of pool) {
        const t = turn(text);
        if (t) return t;
    }
    for (const text of pool) {
        const benefit = text.match(/\b(?:helps?|lets?|allows?|enables?)\s+(?:you|teams|anyone|businesses|creators)\s+(?:to\s+)?([a-z].{6,70}?)(?=[,.;!?]|$)/i);
        if (benefit && words(benefit[1]).length <= 9) return { text: endStop(cap(benefit[1])), used: text };
        const way = text.match(/\b(the\s+(?:fastest|easiest|simplest|best|smartest|quickest)\s+way\s+to\s+.{4,60}?)(?=[,.;!?]|$)/i);
        if (way && words(way[1]).length <= 10) return { text: endStop(cap(way[1])), used: text };
    }
    const first = stripLead(clausesOf(sentencesOf(pool[0] || hero || name)[0] || '')[0] || '', name);
    const line = headlineText(cap(first), 9);
    return { text: line || name, used: pool[0] || '' };
}

/** A real figure from the copy ("20,000+ teams", "10x faster", "99.9% uptime"), or null. */
export function findStat(texts) {
    const re = /(?<![\w$€£.,])((?:[$€£R]\s?)?\d{1,3}(?:[,\s]\d{3})+\+?|(?:[$€£R]\s?)?\d+(?:\.\d+)?\s?(?:%|x|×|k\+?|K\+?|M\+?|B\+?|\+|\s?million|\s?billion))\s+([A-Za-z][A-Za-z'’ -]{2,48})/;
    let best = null;
    for (const raw of texts) {
        const text = cleanText(raw);
        if (!text || isNoise(text)) continue;
        const m = text.match(re);
        if (!m) continue;
        const label = words(m[2].replace(/\b(and|or|with|in|on|at|by|for|of|to|the|a)\s*$/i, '')).slice(0, 5).join(' ').replace(/\s+(and|or|with|in|on|at|by|for|of|to|the|a)$/i, '');
        if (words(label).length < 1 || /^(min|mins|minutes|seconds|days|months|years?)$/i.test(label)) continue;
        const score = /[%x×+]|million|billion|[kKMB]\b/.test(m[1]) ? 2 : 1;
        // "Trusted by" / "Over" before the figure becomes its label above.
        const lead = text.slice(0, m.index).trim().split(' ').slice(-3).join(' ').replace(/^[^A-Z]*(?=[A-Z])/, '');
        if (!best || score > best.score) best = { value: m[1].replace(/\s+/g, ' ').trim(), label, score, lead: /^[A-Z][a-z]+( [a-z]+){0,2}$/.test(lead) && /\b(by|over|than|across)$/i.test(lead) ? lead : '' };
    }
    return best ? { value: best.value, label: best.label, lead: best.lead } : null;
}

/** The paragraph that explains a heading best (shared word stems), among those not used yet. */
export function matchParagraph(heading, paragraphs, used = new Set()) {
    const keys = new Set(words(heading).map(stem).filter((w) => w.length >= 3 && !FILLER.has(w)));
    let best = null;
    let bestScore = 0;
    for (const p of paragraphs) {
        if (used.has(p)) continue;
        const score = words(p).map(stem).filter((w) => keys.has(w)).length;
        if (score > bestScore) {
            best = p;
            bestScore = score;
        }
    }
    return best;
}

const CTA = /^(get started|start\b|try\b|sign ?up|join\b|create\b|book\b|request\b|download\b|install\b|buy\b|subscribe\b|claim\b|get .{1,20} free)/i;
/** Stronger invitations first: "Get started" or "Try it free" beat "Request a demo". */
const ctaRank = (c) => (/get started|sign ?up|free|try\b/i.test(c) ? 3 : /^(start|join|create|download|install)\b/i.test(c) ? 2 : 1);

/** A real call to action from the page, at most 4 words. */
export function findCta(source) {
    const elements = (source.shotElements || []).flat().filter((e) => e.kind === 'button' || e.kind === 'link').map((e) => e.text);
    const all = [...(source.ctas || []), ...elements].map(cleanText).filter((c) => c && words(c).length <= 4);
    return all.filter((c) => CTA.test(c)).sort((a, b) => ctaRank(b) - ctaRank(a))[0] || '';
}

/** Feature beats from the copy: one per clause, with list items as chips. */
export function featureBeats(texts, name, skip = '') {
    const beats = [];
    for (const text of texts) {
        for (const sentence of sentencesOf(text)) {
            if (skip && sentence === skip) continue;
            for (const clause of clausesOf(sentence)) {
                let line = stripLead(clause, name);
                const t = transformation(clause);
                if (t) {
                    // The hook already says "A into B"; what's left ("for TikTok, Reels and Shorts") is its own beat.
                    if (!t.rest) continue;
                    line = /^for\s/i.test(t.rest) ? `Made ${t.rest}` : cap(stripLead(t.rest, name));
                }
                const n = words(line).length;
                if (n < 2 || n > 14 || isNoise(cap(line))) continue;
                if (n <= 3 && beats.length && !beats[beats.length - 1].subline) {
                    beats[beats.length - 1].subline = endStop(cap(line));
                    continue;
                }
                const head = headlineText(cap(line), 8);
                const rest = head.endsWith('…') ? '' : line.slice(head.length).replace(/^[\s,.;:–—-]+/, '');
                beats.push({ headline: head.replace(/…$/, ''), subline: rest && words(rest).length >= 3 ? endStop(cap(shortLine(rest, 12))) : '', points: listItems(line) });
            }
        }
    }
    return beats;
}

export { headlineText, shortLine };
