import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { GEMINI_MODEL } from '../config/ai-models.js';
import { requestOpenRouterText } from './openrouter.js';
import { generateImage, imageGenerationAvailable } from './marketing/image-gen.js';
import { uploadFile } from './storage.service.js';

export const IMAGE_GENERATION_UNAVAILABLE = "Image generation isn't set up yet (add POLLINATIONS_API_KEY, free, or OPENROUTER_API_KEY).";

const OPENROUTER_TEXT_MODEL = process.env.AI_TEXT_MODEL || process.env.AI_JSON_MODEL || 'anthropic/claude-haiku-4.5';

// -------------------------------------------------------
// Provider Initialization
// -------------------------------------------------------

let geminiModel = null;
let openaiClient = null;

function getGemini() {
    if (!geminiModel && process.env.GEMINI_API_KEY) {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        geminiModel = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    }
    return geminiModel;
}

function getOpenAI() {
    if (!openaiClient && process.env.OPENAI_API_KEY) {
        openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openaiClient;
}

// -------------------------------------------------------
// System Prompts
// -------------------------------------------------------

const SYSTEM_PROMPTS = {
    caption: `You are a world-class social media copywriter. Generate an engaging, 
platform-optimised caption. Keep it concise but impactful. Include relevant emojis 
and a clear call-to-action when appropriate. Output ONLY the caption text.`,

    hashtags: `You are a social media growth specialist. Generate 20-30 highly relevant, 
trending hashtags for the given topic. Mix popular broad hashtags with niche-specific ones.
Output ONLY the hashtags, space-separated, each starting with #.`,

    script: `You are a professional video script writer for short-form content (TikTok, 
Instagram Reels, YouTube Shorts). Write a compelling script with:
- Hook (first 2 seconds)
- Body (value delivery)    
- Call to action
Format with clear sections and timing cues. Keep under 60 seconds read time.`,

    hook: `You are a scroll-stopping content strategist. Generate 5 powerful opening 
hooks/lines for social media posts or videos on the given topic. Each hook should be
on its own line, numbered 1-5. Make them curiosity-driven, bold, or controversial.`,

    research: `You are a top-tier digital marketing strategist. 
Based on the provided industry or business description, suggest the 5 best high-converting ad concepts.
For each concept, provide:
1. The Core Angle (Why it works)
2. The Target Audience
3. A Visual/Video Hook idea
Format clearly with 5 distinct sections. Be highly specific and innovative.`,

    nanobanana: `You are a viral content creator specializing in the high-energy "Nanobanana" aesthetic style. 
Your tone is chaotic, fun, intensely engaging, and highly visual. 
Based on the user's topic, write a short, punchy script or caption that perfectly captures the fast-paced Nanobanana aesthetic. Use rapid-fire text, emojis, and a loud personality.`,

    repurpose: `You are a content repurposing expert. Take the provided content and 
adapt it for the specified platform while maintaining the core message. Adjust tone, 
length, and formatting for the target platform.`,
};

// -------------------------------------------------------
// Core Generation Function – OpenRouter, then Gemini, then OpenAI
// -------------------------------------------------------

/**
 * Generate AI content using Gemini with OpenAI fallback.
 * @param {string} type - One of: caption, hashtags, script, hook, repurpose
 * @param {string} userPrompt - The user's input / topic
 * @param {object} options - Additional options (tone, language, platform)
 * @returns {{ result: string, provider: string }}
 */
export async function generateContent(type, userPrompt, options = {}) {
    const systemPrompt = SYSTEM_PROMPTS[type] || SYSTEM_PROMPTS.caption;

    const fullPrompt = buildPrompt(systemPrompt, userPrompt, options);

    // --- OpenRouter first when configured (fastest and most reliable here) ---
    if (process.env.OPENROUTER_API_KEY) {
        try {
            const text = await requestOpenRouterText({
                model: OPENROUTER_TEXT_MODEL,
                maxTokens: 1500,
                temperature: 0.8,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: fullPrompt },
                ],
            });
            if (text && text.trim().length > 0) return { result: text.trim(), provider: 'openrouter' };
        } catch (error) {
            console.warn('[AI Service] OpenRouter failed, trying Gemini:', error.message);
        }
    }

    // --- Then Gemini ---
    const gemini = getGemini();
    if (gemini) {
        try {
            const result = await gemini.generateContent(fullPrompt);
            const text = result.response.text();
            if (text && text.trim().length > 0) {
                return { result: text.trim(), provider: 'gemini' };
            }
        } catch (error) {
            console.warn('[AI Service] Gemini failed, falling back to OpenAI:', error.message);
        }
    }

    // --- Fallback to OpenAI ---
    const openai = getOpenAI();
    if (openai) {
        try {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                max_tokens: 1024,
                temperature: 0.8,
            });
            const text = completion.choices[0]?.message?.content;
            if (text && text.trim().length > 0) {
                return { result: text.trim(), provider: 'openai' };
            }
        } catch (error) {
            console.error('[AI Service] OpenAI also failed:', error.message);
        }
    }

    throw new Error('The AI writer is unavailable right now. Try again in a minute.');
}

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------

function buildPrompt(systemPrompt, userPrompt, options) {
    const parts = [systemPrompt];

    if (options.tone) parts.push(`Tone: ${options.tone}`);
    if (options.language) parts.push(`Language: ${options.language}`);
    if (options.platform) parts.push(`Target Platform: ${options.platform}`);

    parts.push(`\nUser Request:\n${userPrompt}`);
    return parts.join('\n');
}

// -------------------------------------------------------
// Media Generation (DALL-E 3 Storyboard)
// -------------------------------------------------------

/** True when an image provider (Pollinations or OpenRouter) is configured. */
export function mediaGenerationAvailable() {
    return imageGenerationAvailable();
}

/**
 * Generate a real image for a piece of AI-written copy and store it in our own storage.
 * Throws an error with `status` 503 when no image provider is configured.
 * @param {string} prompt - The copy the image should illustrate
 * @param {string} type - Tool type (caption, script, hook, ...)
 * @param {{ workspaceId: string }} options
 * @returns {Promise<{ url: string, type: 'image', provider: string, model: string }>}
 */
export async function generateMedia(prompt, type, { workspaceId } = {}) {
    if (!imageGenerationAvailable()) {
        throw Object.assign(new Error(IMAGE_GENERATION_UNAVAILABLE), { status: 503 });
    }
    if (!workspaceId) throw new Error('A workspace is required to store the image.');

    const copy = String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 900);
    const imagePrompt =
        `A striking, scroll-stopping social media image (${type || 'post'}) that illustrates this post. ` +
        `Photographic or clean illustrated style, strong single subject, no words, letters or logos in the image.

Post: ${copy}`;

    const image = await generateImage({ prompt: imagePrompt, tier: 'fast', aspect: '1:1' });
    const url = await uploadFile(image.buffer, `workspaces/${workspaceId}/ai-images`, image.mime || 'image/png');
    return { url, type: 'image', provider: image.provider, model: image.model };
}
