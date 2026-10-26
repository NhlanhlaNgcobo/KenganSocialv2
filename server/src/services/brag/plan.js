import { generateJson } from '../gemini-json.js';
import { cleanText, featureBeats, findCta, findHook, findStat, isNoise, listItems, matchParagraph } from './story.js';
import { headline as headlineText, shortLine, sublineText } from './text.js';
import { aiFeature } from '../../config/ai-features.ts';

/**
 * Step 2 of the launch-video pipeline: the storyboard.
 * Creative laws and tone presets are adapted from /brag-slim
 * (https://github.com/latent-spaces/brag, MIT, © 2026 Shunit Haviv Hakimi).
 *
 * Scene types: hook → reveal → feature/showcase beats (each on a real screenshot when there is
 * one, zooming on `focus`) → proof (a real figure from the copy) → outro (call to action).
 */

export const TONES = {
    default: { feel: 'Punchy, playful, clean', pacing: '5–6 scenes; varied transitions', scenes: [4, 7], transition: 'slide' },
    polished: { feel: 'Serious, elegant, restrained', pacing: '4–5 scenes, long holds; soft fades', scenes: [3, 6], transition: 'fade' },
    'yc-parody': { feel: 'Deadpan startup launch, played straight', pacing: '4–6 scenes, one claim each; hard cuts', scenes: [4, 6], transition: 'cut' },
    chaotic: { feel: 'FAST, LOUD, ALL CAPS', pacing: '6–8 scenes, some under 2s; flash/zoom cuts', scenes: [6, 8], transition: 'flash' },
    deadpan: { feel: 'Calm, dry, nothing is a joke', pacing: '3–5 scenes, big empty space; slow fades', scenes: [3, 5], transition: 'fade' },
    cinematic: { feel: 'Trailer-scale, epic claims', pacing: '4–6 scenes, big type; dramatic wipes', scenes: [4, 6], transition: 'wipe' },
    'app-store': { feel: 'Clean feature cards', pacing: '5–7 scenes; smooth slides', scenes: [4, 7], transition: 'slide' },
};

const SCENE_TYPES = ['hook', 'reveal', 'feature', 'showcase', 'proof', 'outro'];

const CREATIVE_LAWS = `- Short: the whole video is the target duration.
- Clear to a stranger: after one viewing, someone who has never heard of it knows what it does, who it's for, and how to get it. Lead with that, not with how it's built.
- The hook is everything: the first 2 seconds decide whether anyone keeps watching. Open on the problem it removes or the result it gives, in the product's own words. Plan it first.
- Show the thing: every feature beat sits on a real screenshot when one exists, zoomed on the element that proves it. Never invent claims, numbers, customers, or testimonials.
- Specific: it must feel made for this exact product. Use its own copy; no generic SaaS language ("streamline your workflow" is banned).
- Readable: any line meant to be read stays on screen for at least 0.3s per word plus a beat.
- Funny earns its place: humour comes from the product's own absurdity, not from trying.
- Every frame postable.`;

/** Words of the product's own copy, for checking that figures and list items are real. */
function corpusOf(source) {
    return [source.title, source.description, ...(source.headings || []), ...(source.paragraphs || []), ...(source.sections || []).flatMap((s) => [s.heading, s.text]), ...(source.ctas || [])]
        .filter(Boolean)
        .join(' \n ')
        .toLowerCase();
}

function shotsForPrompt(source) {
    return (source.screenshots || []).map((_, i) => {
        const section = (source.sections || []).find((s) => s.shot === i);
        const elements = (source.shotElements?.[i] || []).filter((e) => e.kind !== 'link' || e.priority > 0).slice(0, 8).map((e) => `${e.kind}: "${e.text}"`);
        return `  ${i}: ${i === 0 ? 'top of the page' : section ? `section "${section.heading}"${section.text ? ` — ${section.text.slice(0, 160)}` : ''}` : 'further down the page'}; elements: ${elements.join(', ') || 'none'}`;
    });
}

function buildPrompt(source, tone, format, duration, focus) {
    const t = TONES[tone];
    const shots = source.screenshots?.length || 0;
    return `You are directing a short launch video for the product below. It is published by the product's own team, so every line speaks for that product (never mention video tools, "bragging" or the making of the video).

PRODUCT SOURCE (${source.url ? `website ${source.url}` : 'described by the user'}):
- Title: ${source.title || source.ogTitle || ''}
- Name: ${source.siteName || source.name || ''}
- Description: ${source.description || ''}
- Headings on the page: ${JSON.stringify((source.headings || []).slice(0, 10))}
- Calls to action: ${JSON.stringify((source.ctas || []).filter(isRealCta).slice(0, 8))}
- Body copy: ${JSON.stringify((source.paragraphs || []).filter((p) => !isNoise(p)).slice(0, 8))}
- Screenshots (${shots}${shots ? '' : ' — none, so use null'}):
${shotsForPrompt(source).join('\n')}
${focus ? `- The user wants this video to focus on: ${focus}` : ''}

FORMAT: ${format}, about ${duration} seconds, 30fps.
TONE: ${tone} — ${t.feel}. Pacing: ${t.pacing}.

CREATIVE LAWS:
${CREATIVE_LAWS}

SHAPE: Hook (2–3s, the promise or the pain, can be two short beats split by "\\n", e.g. "One long video.\\nInto a week of clips.") → Reveal (product name, 2–3s) → 2–4 feature beats, each on its own screenshot with "focus" set to the exact text of an element listed for that screenshot (the camera zooms there) → optional "proof" beat ONLY if the copy states a real figure → outro with a real call to action. A starting shape, not a template.

Return ONLY JSON with this exact structure:
{
  "angle": "one sentence: the creative angle",
  "productName": "short product name",
  "shareCopy": "1–3 sentences, postable as-is, specific, matching the tone. Never 'excited to share'.",
  "musicQuery": "2–4 words describing background music that fits the tone, e.g. 'upbeat electronic', 'cinematic orchestral', 'lofi chill'",
  "scenes": [
    {
      "type": "hook | reveal | feature | showcase | proof | outro",
      "duration": seconds (number),
      "eyebrow": "optional tiny label above the headline (2–3 words), or empty",
      "headline": "the main line, max 8 words",
      "subline": "optional supporting line, max 14 words, or empty",
      "screenshot": index or null,
      "focus": "for a scene with a screenshot: the exact text of one element listed for that screenshot, or empty",
      "points": ["optional: 2–3 items of at most 3 words each, copied from the source (platforms, integrations, outputs)"],
      "stat": "proof only: { \\"value\\": \\"20,000+\\", \\"label\\": \\"teams ship with it\\" } using a figure that appears in the source, else omit",
      "cta": "only for outro: a real call to action from the page (e.g. 'Get started', 'Install', 'Try it free'), never an interface label like 'Copy', 'Menu' or 'Close'; or empty"
    }
  ]
}
Use ${t.scenes[0]}–${t.scenes[1]} scenes whose durations add up to about ${duration}. The first scene must be the hook; the last must be the outro. Use each screenshot at most once. ${tone === 'chaotic' ? 'Write headlines in ALL CAPS.' : ''}`;
}

const clampText = (s, words) => String(s || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, words).join(' ');

/** A headline that may hold one forced line break ("One long video.\nInto a week of clips."). */
function headlineLines(text, max) {
    const lines = String(text || '').split(/\n|\\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 2);
    if (lines.length < 2) return headlineText(lines[0] || '', max);
    const first = headlineText(lines[0], Math.max(2, max - 3));
    const rest = headlineText(lines[1], Math.max(2, max - first.split(' ').length));
    return `${first}\n${rest}`;
}

/** Interface labels scraped from pages that must never become a call to action. */
const UI_LABELS = /^(copy|copied|menu|close|open|share|tap for sound|play|pause|mute|next|previous|back|more|search|log ?in|sign ?in|skip|ok|×|x|product|products|resources|pricing|features|solutions|company|docs|blog)$/i;
export const isRealCta = (s) => !!s && !UI_LABELS.test(String(s).trim());

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Enforces structure, readability timing, real figures and the target duration on any plan. */
export function normalizePlan(raw, source, tone, duration) {
    const shots = source.screenshots?.length || 0;
    const corpus = corpusOf(source);
    let scenes = (Array.isArray(raw?.scenes) ? raw.scenes : [])
        .filter((s) => s && typeof s === 'object')
        .slice(0, 8)
        .map((s) => {
            let type = SCENE_TYPES.includes(s.type) ? s.type : 'feature';
            const shot = Number.isInteger(s.screenshot) && s.screenshot >= 0 && s.screenshot < shots ? s.screenshot : null;
            // The camera target must be an element really captured on that screenshot.
            const elements = shot != null ? source.shotElements?.[shot] || [] : [];
            const focusText = norm(s.focus);
            const focus = focusText && elements.some((e) => norm(e.text) === focusText || (focusText.length > 6 && norm(e.text).startsWith(focusText.slice(0, 40)))) ? clampText(s.focus, 16) : '';
            // A figure must appear in the product's own copy.
            const value = String(s.stat?.value || '').trim().slice(0, 14);
            const figure = value.match(/\d[\d,. ]*/)?.[0].trim();
            const stat = type === 'proof' && figure && corpus.includes(figure.toLowerCase()) ? { value, label: headlineText(s.stat?.label || s.headline, 7) } : null;
            if (type === 'proof' && !stat) type = 'feature';
            const points = (Array.isArray(s.points) ? s.points : [])
                .map((p) => clampText(p, 4))
                .filter((p) => p && p.split(' ').every((w) => corpus.includes(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))))
                .slice(0, 4);
            const scene = {
                type,
                eyebrow: clampText(s.eyebrow, 4),
                headline: headlineLines(s.headline, 10) || source.title || 'Launch',
                subline: sublineText(s.subline, 16),
                screenshot: shot,
                focus,
                points: points.length >= 2 ? points : [],
                stat,
                cta: type === 'outro' && isRealCta(s.cta) ? clampText(s.cta, 5) : '',
                duration: Number(s.duration) || 3,
            };
            // A subline that only repeats the headline adds nothing.
            const flat = (t) => norm(t).replace(/[^\p{L}\p{N} ]/gu, '');
            if (scene.subline && flat(scene.headline).includes(flat(scene.subline))) scene.subline = '';
            if (tone === 'chaotic') scene.headline = scene.headline.toUpperCase();
            // Readability: ~0.3s per word of text that must be read, plus time to animate in.
            const count = (t) => String(t || '').split(/\s+/).filter(Boolean).length;
            // Headlines are read word by word; a subline or chips are skimmed.
            const read = count(`${scene.headline} ${scene.cta} ${stat ? stat.label : ''}`) * 0.3 + count(`${scene.subline} ${scene.points.join(' ')}`) * 0.2 + 0.9;
            // Scenes with a screen need time for the camera move; the outro needs time for the click.
            const floor = tone === 'chaotic' ? 1.2 : type === 'outro' ? 3 : scene.screenshot != null && type !== 'hook' ? 3 : type === 'reveal' ? 2.4 : 1.8;
            scene.minDuration = Math.max(floor, Math.min(5, read));
            scene.duration = Math.max(scene.duration, scene.minDuration);
            return scene;
        });

    if (!scenes.length) throw new Error('empty plan');
    if (scenes[0].type !== 'hook') scenes[0].type = 'hook';
    if (scenes[scenes.length - 1].type !== 'outro') scenes[scenes.length - 1].type = 'outro';

    // Fit the target duration: shrink scenes that have slack, never below their reading time.
    let total = scenes.reduce((sum, s) => sum + s.duration, 0);
    if (total > duration) {
        let excess = total - duration;
        for (const s of [...scenes].sort((a, b) => b.duration - b.minDuration - (a.duration - a.minDuration))) {
            const cut = Math.min(excess, s.duration - s.minDuration);
            s.duration -= cut;
            excess -= cut;
            if (excess <= 0) break;
        }
    } else if (total < duration * 0.85) {
        const stretch = (duration - total) / scenes.length;
        scenes.forEach((s) => (s.duration += stretch));
    }
    scenes = scenes.map(({ minDuration, ...s }) => ({ ...s, duration: Math.round(s.duration * 30) / 30 }));

    return {
        angle: clampText(raw?.angle, 30),
        productName: clampText(raw?.productName, 5) || source.siteName || source.title || 'Your product',
        shareCopy: String(raw?.shareCopy || '').trim().slice(0, 400),
        musicQuery: clampText(raw?.musicQuery, 4) || 'upbeat electronic',
        tone,
        scenes,
    };
}

function productName(source) {
    const fromTitle = (source.title || source.ogTitle || '').split(/\s[|—–-]\s|[|—–]/)[0].trim();
    return cleanText(source.siteName || source.name || (fromTitle.split(' ').length <= 3 ? fromTitle : '') || (source.url ? new URL(source.url).hostname.replace(/^www\./, '').split('.')[0] : '') || 'Your product');
}

/** Feature beats tied to the page's own sections, each on the screenshot that shows it. */
function sectionBeats(source, paragraphs, hookText) {
    const used = new Set();
    const beats = [];
    for (const section of source.sections || []) {
        const heading = cleanText(section.heading);
        if (!heading || norm(heading) === norm(hookText) || isNoise(heading)) continue;
        const own = cleanText(section.text);
        const para = own && !isNoise(own) ? own : matchParagraph(heading, paragraphs, used);
        if (para) used.add(para);
        const head = headlineText(heading, 8);
        beats.push({
            headline: head.endsWith('…') ? headlineText(heading.split(/[.:!?]/)[0], 8) : head,
            subline: para && norm(para) !== norm(heading) ? shortLine(para, 14) : '',
            points: listItems(para || ''),
            screenshot: section.shot,
            focus: heading,
        });
    }
    return beats;
}

/** Feature beats from headings and copy when the page has no section captures. */
function headingBeats(source, paragraphs, hookText) {
    const used = new Set();
    const shots = source.screenshots?.length || 0;
    return (source.headings || [])
        .map(cleanText)
        .slice(1)
        .filter((h) => h && h.split(' ').length <= 12 && norm(h) !== norm(hookText) && !isNoise(h))
        .map((heading, i) => {
            const para = matchParagraph(heading, paragraphs, used);
            if (para) used.add(para);
            const shot = i + 1 < shots ? i + 1 : null;
            const el = shot != null ? (source.shotElements?.[shot] || []).find((e) => e.kind === 'heading' && norm(e.text).startsWith(norm(heading).slice(0, 24))) : null;
            return { headline: headlineText(heading, 8), subline: para ? shortLine(para, 14) : '', points: listItems(para || ''), screenshot: shot, focus: el?.text || '' };
        });
}

/** A plan built directly from the site's own copy, used when the model is unavailable. */
export function fallbackPlan(source, tone, duration) {
    const name = productName(source);
    const host = source.url ? new URL(source.url).hostname.replace(/^www\./, '') : '';
    const paragraphs = (source.paragraphs || []).map(cleanText).filter((p) => !isNoise(p));
    const shots = source.screenshots?.length || 0;
    const hook = findHook({ ...source, paragraphs }, name);
    const hookFlat = hook.text.replace(/\n/g, ' ');

    const description = cleanText(source.description);
    const tagline = description && description !== hook.used && norm(description) !== norm(hookFlat) ? shortLine(description, 14) : '';
    const maxFeatures = duration >= 26 ? 4 : duration >= 17 ? 3 : 2;

    let beats = sectionBeats(source, paragraphs, hookFlat);
    if (beats.length < 2) beats = [...beats, ...headingBeats(source, paragraphs, hookFlat).filter((b) => !beats.some((x) => norm(x.headline) === norm(b.headline)))];
    if (beats.length < 2) {
        const texts = source.url ? paragraphs : [description, ...paragraphs.filter((p) => p !== description)];
        beats = [...beats, ...featureBeats(texts, name).filter((b) => norm(b.headline) !== norm(hookFlat) && !beats.some((x) => norm(x.headline) === norm(b.headline)))];
    }
    const stat = duration >= 15 ? findStat([...(source.headings || []), ...paragraphs, description, ...(source.sections || []).map((s) => s.text)]) : null;
    // The figure gets its own beat; a feature that only restates it would repeat it.
    if (stat) beats = beats.filter((b) => !`${b.headline} ${b.subline}`.includes(stat.value));
    beats = beats.slice(0, maxFeatures);
    const cta = [findCta(source), ...(source.ctas || []).map(cleanText)].find((c) => c && c.split(' ').length <= 4 && isRealCta(c) && /\b(start|try|sign|join|get|book|download|install|create|buy|subscribe)\b/i.test(c)) || 'Get started';

    const scenes = [
        { type: 'hook', headline: hook.text, subline: '', screenshot: shots ? 0 : null, duration: 2.6 },
        { type: 'reveal', eyebrow: 'Introducing', headline: name, subline: tagline, screenshot: shots ? 0 : null, duration: 3.2 },
        ...beats.map((b) => ({ type: 'feature', ...b, duration: b.screenshot != null ? 3.8 : 3.2 })),
        ...(stat ? [{ type: 'proof', eyebrow: stat.lead, headline: stat.label, stat: { value: stat.value, label: stat.label }, subline: '', duration: 2.8 }] : []),
        { type: 'outro', headline: name, subline: hookFlat.split(' ').length <= 10 && norm(hookFlat) !== norm(name) ? hookFlat : tagline, cta, duration: 3.4 },
    ];
    return normalizePlan(
        {
            scenes,
            productName: name,
            shareCopy: [hookFlat, tagline, host].filter(Boolean).join(' ').slice(0, 400) || `${name}.`,
            musicQuery: tone === 'cinematic' ? 'cinematic trailer' : 'upbeat electronic',
        },
        source,
        tone,
        duration
    );
}

export async function planVideo(source, { tone, format, duration, focus }) {
    const parts = [{ text: buildPrompt(source, tone, format, duration, focus) }];
    // Let the model see the product, not just read about it.
    for (const shot of (source.screenshots || []).slice(0, 4)) {
        parts.push({ inlineData: { mimeType: 'image/jpeg', data: shot.split(',')[1] } });
    }
    if (!aiFeature('storyboardAi')) return { plan: fallbackPlan(source, tone, duration), planner: 'fallback' };
    try {
        return { plan: normalizePlan(await generateJson(parts), source, tone, duration), planner: 'ai' };
    } catch (error) {
        console.warn('[Brag] Planner fell back to site copy:', error.message);
        return { plan: fallbackPlan(source, tone, duration), planner: 'fallback' };
    }
}
