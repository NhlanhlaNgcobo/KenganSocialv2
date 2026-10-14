import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_MODEL } from '../config/ai-models.js';
import { extractJsonObject, requestOpenRouterText } from './openrouter.js';

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
    return configured.filter((p) => (p === 'openrouter' && process.env.OPENROUTER_API_KEY) || (p === 'gemini' && process.env.GEMINI_API_KEY));
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
            return provider === 'openrouter' ? await viaOpenRouter(parts, temperature) : await viaGemini(parts, temperature);
        } catch (error) {
            lastError = error;
            console.warn(`[AI] ${provider} JSON request failed${providers.length > 1 ? ', trying the next provider' : ''}:`, error.message);
        }
    }
    throw lastError;
}

export const aiConfigured = () => providerOrder().length > 0;
