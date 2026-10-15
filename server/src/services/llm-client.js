import { OpenAI } from 'openai';

/**
 * One OpenAI-compatible chat client for the whole server.
 * OpenRouter (OPENROUTER_API_KEY) is used when configured: it speaks the same API and
 * routes to Anthropic, Google, OpenAI and other models. Otherwise the OpenAI API is used.
 *
 * Call sites use CHAT_MODEL instead of a hard-coded model name so the provider can change
 * without touching them.
 */

const useOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);

export const CHAT_MODEL = useOpenRouter ? process.env.AI_TEXT_MODEL || 'anthropic/claude-haiku-4.5' : 'gpt-4o-mini';

export const chatClient = useOpenRouter
    ? new OpenAI({
          apiKey: process.env.OPENROUTER_API_KEY,
          baseURL: 'https://openrouter.ai/api/v1',
          defaultHeaders: { 'HTTP-Referer': process.env.CLIENT_URL || 'https://kengansocial.app', 'X-Title': 'KenganSocial' },
      })
    : new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-placeholder-key' });
