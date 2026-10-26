import { OpenAI } from 'openai';
import { freeFallbackEnabled, POLLINATIONS_MODEL, pollinationsChatClient } from './pollinations-text.js';

/**
 * One OpenAI-compatible chat client for the whole server.
 * Provider order: OpenRouter (OPENROUTER_API_KEY), then OpenAI (OPENAI_API_KEY), then Gemini
 * (GEMINI_API_KEY, through Google's OpenAI-compatible endpoint), then the free Pollinations
 * fallback (open models, rate-limited; see pollinations-text.js) unless AI_FREE_FALLBACK=off. OpenRouter speaks the same API and
 * routes to Anthropic, Google, OpenAI and other models.
 *
 * Call sites use CHAT_MODEL instead of a hard-coded model name so the provider can change
 * without touching them. With no key at all, calls fail with a clear 503 instead of an
 * authentication error from a placeholder key.
 */

function pickProvider() {
    if (process.env.OPENROUTER_API_KEY) {
        return {
            name: 'openrouter',
            model: process.env.AI_TEXT_MODEL || 'anthropic/claude-haiku-4.5',
            client: new OpenAI({
                apiKey: process.env.OPENROUTER_API_KEY,
                baseURL: 'https://openrouter.ai/api/v1',
                defaultHeaders: { 'HTTP-Referer': process.env.CLIENT_URL || 'https://kengansocial.app', 'X-Title': 'KenganSocial' },
            }),
        };
    }
    if (process.env.OPENAI_API_KEY) {
        return { name: 'openai', model: 'gpt-4o-mini', client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) };
    }
    if (process.env.GEMINI_API_KEY) {
        return {
            name: 'gemini',
            model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
            client: new OpenAI({ apiKey: process.env.GEMINI_API_KEY, baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' }),
        };
    }
    if (freeFallbackEnabled()) {
        // Queued and spaced for the free tier's rate limit (see pollinations-text.js).
        return { name: 'pollinations', model: POLLINATIONS_MODEL, client: pollinationsChatClient() };
    }
    return null;
}

const provider = pickProvider();

export const AI_PROVIDER = provider?.name || null;
export const CHAT_MODEL = provider?.model || 'unconfigured';

const notConfigured = {
    chat: {
        completions: {
            create: async () => {
                throw Object.assign(new Error('AI is not set up on the server yet. Add OPENROUTER_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY to server/.env and restart.'), {
                    status: 503,
                    code: 'AI_NOT_CONFIGURED',
                });
            },
        },
    },
};

export const chatClient = provider ? provider.client : notConfigured;

/**
 * JSON from a chat reply. Not every model behind OpenRouter honours response_format: json_object;
 * some wrap the object in a ```json fence or add a sentence around it. Takes the outermost {...}.
 */
export function parseJsonReply(content, fallback = {}) {
    const text = String(content || '').trim();
    if (!text) return fallback;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    return JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
}
