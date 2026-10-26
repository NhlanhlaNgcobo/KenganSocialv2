import axios from 'axios';
import { aiFeature } from '../../config/ai-features.ts';

/**
 * AI image generation behind one adapter.
 *
 * Providers:
 *  - OpenRouter Images API (OPENROUTER_API_KEY): POST /api/v1/images, base64 in and out.
 *    "best" = openai/gpt-image-2.5-flare (top of the image leaderboards, Oct 2026).
 *  - Pollinations (POLLINATIONS_API_KEY, free account at enter.pollinations.ai; open source, MIT):
 *    OpenAI-compatible POST /v1/images/generations. Free-credit models include
 *    black-forest-labs/flux.2-klein-4b (Apache-2.0 open weights) and openai/gpt-image-2.
 *
 * Callers ask for a quality tier, not a model. The model per tier is configuration
 * (IMAGE_MODEL_* env vars), so moving to a newer #1 model is a one-line change.
 * Returned images are always raw buffers; callers store them in our own storage.
 */

const OPENROUTER_IMAGES = 'https://openrouter.ai/api/v1/images';
const POLLINATIONS_IMAGES = 'https://gen.pollinations.ai/v1/images/generations';

const MODELS = {
    openrouter: {
        best: process.env.IMAGE_MODEL_BEST || 'openai/gpt-image-2.5-flare',
        fast: process.env.IMAGE_MODEL_FAST || 'google/gemini-nano-banana-2.1',
    },
    pollinations: {
        best: process.env.POLLINATIONS_MODEL_BEST || 'openai/gpt-image-2',
        fast: process.env.POLLINATIONS_MODEL_FAST || 'black-forest-labs/flux.2-klein-4b',
    },
};

export function imageProviders() {
    return {
        // Paid AI images only when switched on (LAUNCH_AI_FEATURES); free Pollinations images stay.
        openrouter: !!process.env.OPENROUTER_API_KEY && aiFeature('aiImages'),
        pollinations: !!process.env.POLLINATIONS_API_KEY,
    };
}

export const imageGenerationAvailable = () => Object.values(imageProviders()).some(Boolean);

/** Provider order for a tier. "free" never uses paid OpenRouter credit. */
function route(tier) {
    const have = imageProviders();
    const order = tier === 'free' ? ['pollinations'] : tier === 'best' ? ['openrouter', 'pollinations'] : ['pollinations', 'openrouter'];
    return order.filter((p) => have[p]).map((provider) => ({ provider, model: MODELS[provider][tier === 'free' ? 'fast' : tier] || MODELS[provider].fast }));
}

const RATIOS = { '4:5': [1024, 1280], '1:1': [1024, 1024], '9:16': [864, 1536], '3:4': [960, 1280], '16:9': [1536, 864] };

async function viaOpenRouter({ model, prompt, aspect, references }) {
    // GPT Image has no 4:5; 3:4 is closest and the renderer crops to the slide.
    const aspectRatio = aspect === '4:5' && model.startsWith('openai/') ? '3:4' : aspect;
    const body = { model, prompt, aspect_ratio: aspectRatio, n: 1 };
    if (model.startsWith('openai/')) body.quality = 'medium';
    if (references.length) body.input_references = references.map((url) => ({ type: 'image_url', image_url: { url } }));
    const { data } = await axios.post(OPENROUTER_IMAGES, body, {
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'KenganSocial' },
        timeout: 180000,
        maxContentLength: 40 * 1024 * 1024,
    });
    const item = data?.data?.[0];
    if (!item?.b64_json) throw new Error('OpenRouter returned no image');
    return { buffer: Buffer.from(item.b64_json, 'base64'), mime: item.media_type || 'image/png', cost: data.usage?.cost ?? null };
}

async function viaPollinations({ model, prompt, aspect, references }) {
    const [w, h] = RATIOS[aspect] || RATIOS['1:1'];
    const body = { model, prompt, size: `${w}x${h}`, response_format: 'b64_json', n: 1 };
    // Pollinations fetches references by URL, so only public https references can be used.
    const publicRefs = references.filter((u) => /^https:\/\//i.test(u) && !/localhost|127\.0\.0\.1/i.test(u));
    if (publicRefs.length) body.image = publicRefs.slice(0, 4);
    const { data } = await axios.post(POLLINATIONS_IMAGES, body, {
        headers: { Authorization: `Bearer ${process.env.POLLINATIONS_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 180000,
        maxContentLength: 40 * 1024 * 1024,
    });
    const item = data?.data?.[0];
    if (item?.b64_json) return { buffer: Buffer.from(item.b64_json, 'base64'), mime: 'image/png', cost: null };
    if (item?.url) {
        const img = await axios.get(item.url, { responseType: 'arraybuffer', timeout: 60000, maxContentLength: 40 * 1024 * 1024 });
        return { buffer: Buffer.from(img.data), mime: String(img.headers['content-type'] || 'image/jpeg'), cost: null };
    }
    throw new Error('Pollinations returned no image');
}

/**
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {'best'|'fast'|'free'} [opts.tier]
 * @param {'4:5'|'1:1'|'9:16'|'3:4'|'16:9'} [opts.aspect]
 * @param {string[]} [opts.references] image URLs or data URLs (style/product references)
 * @returns {Promise<{buffer: Buffer, mime: string, provider: string, model: string, cost: number|null}>}
 */
export async function generateImage({ prompt, tier = 'fast', aspect = '4:5', references = [] }) {
    const attempts = route(tier);
    if (!attempts.length) {
        throw Object.assign(new Error('Image generation is not set up yet. Add POLLINATIONS_API_KEY (free) or OPENROUTER_API_KEY to server/.env.'), { status: 503 });
    }
    let lastError;
    for (const { provider, model } of attempts) {
        try {
            const result = provider === 'openrouter' ? await viaOpenRouter({ model, prompt, aspect, references }) : await viaPollinations({ model, prompt, aspect, references });
            return { ...result, provider, model };
        } catch (error) {
            const detail = error.response?.data?.error?.message || error.response?.data?.error || error.message;
            lastError = new Error(`${provider} (${model}): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
            console.warn('[Images]', lastError.message);
        }
    }
    throw Object.assign(lastError, { status: 502 });
}
