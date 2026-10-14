import { generateJson } from '../gemini-json.js';

/**
 * Step 2 of the launch-video pipeline: the storyboard.
 * Creative laws and tone presets are adapted from /brag-slim
 * (https://github.com/latent-spaces/brag, MIT, © 2026 Shunit Haviv Hakimi).
 */

export const TONES = {
    default: { feel: 'Punchy, playful, clean', pacing: '4–5 scenes; soft transitions', scenes: [4, 5], transition: 'slide' },
    polished: { feel: 'Serious, elegant, restrained', pacing: '3–4 scenes, long holds; soft fades', scenes: [3, 4], transition: 'fade' },
    'yc-parody': { feel: 'Deadpan startup launch, played straight', pacing: '4–5 scenes, one claim each; hard cuts', scenes: [4, 5], transition: 'cut' },
    chaotic: { feel: 'FAST, LOUD, ALL CAPS', pacing: '6–8 scenes, some under 2s; flash/zoom cuts', scenes: [6, 8], transition: 'flash' },
    deadpan: { feel: 'Calm, dry, nothing is a joke', pacing: '3–4 scenes, big empty space; slow fades', scenes: [3, 4], transition: 'fade' },
    cinematic: { feel: 'Trailer-scale, epic claims', pacing: '4–5 scenes, big type; dramatic wipes', scenes: [4, 5], transition: 'wipe' },
    'app-store': { feel: 'Clean feature cards', pacing: '4–6 scenes; smooth slides', scenes: [4, 6], transition: 'slide' },
};

const SCENE_TYPES = ['hook', 'reveal', 'feature', 'showcase', 'outro'];

const CREATIVE_LAWS = `- Short: the whole video is the target duration.
- Clear to a stranger: after one viewing, someone who has never heard of it knows what it does, who it's for, and how to get it. Lead with that, not with how it's built.
- The hook is everything: the first 2 seconds decide whether anyone keeps watching. Plan it first.
- Show the thing: use the real screenshots, copy and claims from the source. Never invent claims, numbers, customers, or testimonials.
- Specific: it must feel made for this exact product. Use its own copy; no generic SaaS language ("streamline your workflow" is banned).
- Readable: any line meant to be read stays on screen for at least 0.3s per word plus a beat.
- Funny earns its place: humour comes from the product's own absurdity, not from trying.
- Every frame postable.`;

function buildPrompt(source, tone, format, duration, focus) {
    const t = TONES[tone];
    const shots = source.screenshots?.length || 0;
    return `You are directing a short launch video for the product below, in the spirit of /brag: "You built it. Now brag."

PRODUCT SOURCE (${source.url ? `website ${source.url}` : 'described by the user'}):
- Title: ${source.title || source.ogTitle || ''}
- Name: ${source.siteName || source.name || ''}
- Description: ${source.description || ''}
- Headings on the page: ${JSON.stringify((source.headings || []).slice(0, 10))}
- Calls to action: ${JSON.stringify((source.ctas || []).filter(isRealCta).slice(0, 8))}
- Body copy: ${JSON.stringify((source.paragraphs || []).slice(0, 6))}
- Screenshots available: ${shots} (index 0 is the top of the page, then scrolled further down). Use them in "showcase"/"feature" scenes via "screenshot": <index>. Only reference indexes 0..${Math.max(0, shots - 1)}${shots ? '' : ' — none, so use null'}.
${focus ? `- The user wants this video to focus on: ${focus}` : ''}

FORMAT: ${format}, about ${duration} seconds, 30fps.
TONE: ${tone} — ${t.feel}. Pacing: ${t.pacing}.

CREATIVE LAWS:
${CREATIVE_LAWS}

SHAPE: Hook (2–3s) → Reveal (2–4s) → 2–3 sharp highlights → Punchline/outro (2–4s). A starting shape, not a template.

Return ONLY JSON with this exact structure:
{
  "angle": "one sentence: the creative angle",
  "productName": "short product name",
  "shareCopy": "1–3 sentences, postable as-is, specific, matching the tone. Never 'excited to share'.",
  "musicQuery": "2–4 words describing background music that fits the tone, e.g. 'upbeat electronic', 'cinematic orchestral', 'lofi chill'",
  "scenes": [
    {
      "type": "hook | reveal | feature | showcase | outro",
      "duration": seconds (number),
      "eyebrow": "optional tiny label above the headline, or empty",
      "headline": "the main line, max 8 words",
      "subline": "optional supporting line, max 14 words, or empty",
      "screenshot": index or null,
      "cta": "only for outro: a real call to action from the page (e.g. 'Get started', 'Install', 'Try it free'), never an interface label like 'Copy', 'Menu' or 'Close'; or empty"
    }
  ]
}
Use ${t.scenes[0]}–${t.scenes[1]} scenes whose durations add up to about ${duration}. The first scene must be the hook; the last must be the outro. ${tone === 'chaotic' ? 'Write headlines in ALL CAPS.' : ''}`;
}

const clampText = (s, words) => String(s || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, words).join(' ');

/** Interface labels scraped from pages that must never become a call to action. */
const UI_LABELS = /^(copy|copied|menu|close|open|share|tap for sound|play|pause|mute|next|previous|back|more|search|log ?in|sign ?in|skip|ok|×|x)$/i;
export const isRealCta = (s) => !!s && !UI_LABELS.test(String(s).trim());

/** Enforces structure, readability timing and the target duration on any plan. */
export function normalizePlan(raw, source, tone, duration) {
    const shots = source.screenshots?.length || 0;
    let scenes = (Array.isArray(raw?.scenes) ? raw.scenes : [])
        .filter((s) => s && typeof s === 'object')
        .slice(0, 8)
        .map((s) => {
            const type = SCENE_TYPES.includes(s.type) ? s.type : 'feature';
            const shot = Number.isInteger(s.screenshot) && s.screenshot >= 0 && s.screenshot < shots ? s.screenshot : null;
            const scene = {
                type,
                eyebrow: clampText(s.eyebrow, 5),
                headline: clampText(s.headline, 10) || source.title || 'Launch',
                subline: clampText(s.subline, 16),
                screenshot: shot,
                cta: type === 'outro' && isRealCta(s.cta) ? clampText(s.cta, 5) : '',
                duration: Number(s.duration) || 3,
            };
            if (tone === 'chaotic') scene.headline = scene.headline.toUpperCase();
            // Readability: ~0.3s per word of text that must be read, plus time to animate in.
            const words = `${scene.headline} ${scene.subline} ${scene.cta}`.split(' ').filter(Boolean).length;
            scene.minDuration = Math.max(tone === 'chaotic' ? 1.2 : 1.8, words * 0.3 + 0.9);
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

/** A plan built directly from the site's own copy, used when the model is unavailable. */
function fallbackPlan(source, tone, duration) {
    const name = source.siteName || (source.title || '').split(/[|—–-]/)[0].trim() || 'Your product';
    const heads = (source.headings || []).map((h) => h.replace(/\s+/g, ' '));
    const cta = (source.ctas || []).find((c) => c.split(' ').length <= 4 && isRealCta(c)) || '';
    const scenes = [
        { type: 'hook', headline: heads[0] || name, subline: '', duration: 2.5 },
        { type: 'reveal', headline: name, subline: source.description || '', duration: 3.5, screenshot: 0 },
        ...heads.slice(1, 3).map((h, i) => ({ type: 'showcase', headline: h, subline: '', duration: 3, screenshot: Math.min(i + 1, (source.screenshots?.length || 1) - 1) })),
        { type: 'outro', headline: name, subline: source.url ? new URL(source.url).hostname : '', cta, duration: 3 },
    ];
    return normalizePlan(
        { scenes, productName: name, shareCopy: source.description || `${name}.`, musicQuery: tone === 'cinematic' ? 'cinematic trailer' : 'upbeat electronic' },
        source,
        tone,
        duration
    );
}

export async function planVideo(source, { tone, format, duration, focus }) {
    const parts = [{ text: buildPrompt(source, tone, format, duration, focus) }];
    // Let the model see the product, not just read about it.
    for (const shot of (source.screenshots || []).slice(0, 3)) {
        parts.push({ inlineData: { mimeType: 'image/jpeg', data: shot.split(',')[1] } });
    }
    try {
        return { plan: normalizePlan(await generateJson(parts), source, tone, duration), planner: 'gemini' };
    } catch (error) {
        console.warn('[Brag] Planner fell back to site copy:', error.message);
        return { plan: fallbackPlan(source, tone, duration), planner: 'fallback' };
    }
}
