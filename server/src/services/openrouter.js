import axios from 'axios';

/**
 * OpenRouter gateway (OpenAI-compatible chat completions).
 * Used by the lyric analyzer: OPENROUTER_MODEL for text reasoning, and
 * OPENROUTER_AUDIO_MODEL for models that accept `input_audio` content parts.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-opus-5.5';
export const OPENROUTER_AUDIO_MODEL = process.env.OPENROUTER_AUDIO_MODEL || 'google/gemini-3.8-flash';

export const openRouterConfigured = () => Boolean(process.env.OPENROUTER_API_KEY);

/**
 * @param {{ model: string, messages: Array<{ role: 'system' | 'user', content: string | object[] }>, maxTokens: number, reasoningEffort?: 'low' | 'medium' | 'high', temperature?: number }} options
 * @returns {Promise<string>} the assistant text
 */
export async function requestOpenRouterText({ model, messages, maxTokens, reasoningEffort, temperature }) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.');

    try {
        const { data } = await axios.post(
            OPENROUTER_URL,
            {
                model,
                max_tokens: maxTokens,
                ...(temperature !== undefined ? { temperature } : {}),
                ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
                messages,
            },
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    // Attribution shown on the OpenRouter dashboard.
                    'HTTP-Referer': process.env.CLIENT_URL || 'https://kengansocial.app',
                    'X-Title': 'KenganSocial',
                },
                timeout: 120_000,
                maxBodyLength: 60 * 1024 * 1024,
            }
        );

        const choice = data?.choices?.[0];
        const text = choice?.message?.content;
        if (!text) throw new Error(`OpenRouter returned no text (finish_reason: ${choice?.finish_reason ?? 'unknown'}).`);
        return text;
    } catch (error) {
        const detail = error.response?.data?.error?.message || error.message;
        throw new Error(`OpenRouter request failed: ${detail}`);
    }
}

/** Pulls the outermost JSON object out of a reply that may be wrapped in prose or code fences. */
export function extractJsonObject(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}
