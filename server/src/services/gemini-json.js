import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_MODEL } from '../config/ai-models.js';
import { extractJsonObject, requestOpenRouterText } from './openrouter.js';
import { freeFallbackEnabled, requestPollinationsText } from './pollinations-text.js';
import { jsonrepair } from 'jsonrepair';

/**
 * Asks a model for JSON. Used by the clip finder, repurposing and launch storyboards.
 *
 * Provider order: OpenRouter first when OPENROUTER_API_KEY is set (much faster for these
 * prompts), then Gemini. Override with AI_JSON_PROVIDERS="gemini,openrouter".
 * Gemini retries busy models (503/429) and skips retired ones (404).
 *
 * @param {Array} parts prompt parts: { text } and { inlineData: { mimeType, data } }
 */

const OPENROUTER_JSON_MODEL = process.env.AI_JSON_MODEL || 'anthropic/claude-haiku-4.5';

function providerOrder() {
    const configured = (process.env.AI_JSON_PROVIDERS || 'openrouter,gemini')
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean);
    const available = configured.filter((p) => (p === 'openrouter' && process.env.OPENROUTER_API_KEY) || (p === 'gemini' && process.env.GEMINI_API_KEY));
    // Free last resort (text only): keeps AI features working without a paid key.
    return freeFallbackEnabled() ? [...available, 'pollinations'] : available;
}

async function viaOpenRouter(parts, temperature) {
    const content = parts.map((part) =>
        part.inlineData
            ? { type: 'image_url', image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` } }
            : { type: 'text', text: part.text }
    );
    const text = await requestOpenRouterText({
        model: OPENROUTER_JSON_MODEL,
        maxTokens: 8000,
        temperature,
        messages: [
            { role: 'system', content: 'You reply with a single valid JSON object and nothing else.' },
            { role: 'user', content },
        ],
    });
    return JSON.parse(extractJsonObject(text));
}

/**
 * Parses JSON from small open models, which make a few predictable mistakes: an extra "{" opening a
 * sibling key ("},{"next":" instead of "},"next":"), trailing commas, unescaped quotes.
 */
function lenientJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        /* try the repairs below */
    }
    // Drop a stray "{" between sibling keys, then the matching surplus "}" at the end.
    let fixed = text.replace(/\}\s*,\s*\{\s*(?=")/g, () => '},');
    let balance = 0;
    for (const ch of fixed) balance += ch === '{' ? 1 : ch === '}' ? -1 : 0;
    while (balance < 0 && /\}\s*$/.test(fixed)) {
        fixed = fixed.replace(/\}\s*$/, '');
        balance += 1;
    }
    try {
        return JSON.parse(fixed);
    } catch {
        return JSON.parse(jsonrepair(fixed));
    }
}

/** Free fallback: text parts only (the anonymous model has no vision), JSON extracted from the reply. */
async function viaPollinations(parts, temperature) {
    const text = parts.filter((p) => p.text).map((p) => p.text).join('\n\n');
    let lastError;
    // The free model occasionally returns cut-off or invalid JSON; ask again before giving up.
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const reply = await requestPollinationsText({
            temperature,
            json: true,
            messages: [
                { role: 'system', content: 'You reply with a single complete, valid JSON object and nothing else. No markdown fences. Keep string values concise.' },
                { role: 'user', content: text },
            ],
        });
        try {
            return lenientJson(extractJsonObject(reply));
        } catch (error) {
            lastError = error;
            console.warn(`[AI] pollinations reply was not valid JSON (attempt ${attempt + 1}): ${error.message}; reply starts: ${reply.slice(0, 200).replace(/\s+/g, ' ')}`);
        }
    }
    throw lastError;
}

async function viaGemini(parts, temperature) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const models = [...new Set([GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-flash-lite-latest'])];
    let lastError;
    for (const model of models) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const result = await genAI
                    .getGenerativeModel({ model, generationConfig: { responseMimeType: 'application/json', temperature } })
                    .generateContent(parts);
                const text = result.response.text().replace(/^```json\s*|```$/g, '').trim();
                return JSON.parse(text);
            } catch (error) {
                lastError = error;
                if (/\b404\b|no longer available|not found/i.test(error.message)) break;
                if (!/\b(503|429|500)\b|overloaded|high demand|Unexpected token|JSON/i.test(error.message)) throw error;
                await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
            }
        }
    }
    throw lastError;
}

export async function generateJson(parts, { temperature = 0.9 } = {}) {
    const providers = providerOrder();
    if (!providers.length) throw new Error('No AI provider is configured: set OPENROUTER_API_KEY or GEMINI_API_KEY.');
    let lastError;
    for (const provider of providers) {
        try {
            if (provider === 'openrouter') return await viaOpenRouter(parts, temperature);
            if (provider === 'pollinations') return await viaPollinations(parts, temperature);
            return await viaGemini(parts, temperature);
        } catch (error) {
            lastError = error;
            console.warn(`[AI] ${provider} JSON request failed${providers.length > 1 ? ', trying the next provider' : ''}:`, error.message);
        }
    }
    throw lastError;
}

export const aiConfigured = () => providerOrder().length > 0;
