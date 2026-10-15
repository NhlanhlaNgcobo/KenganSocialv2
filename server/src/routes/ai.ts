import express, { Request, Response, NextFunction } from 'express';
import { CHAT_MODEL, chatClient } from '../services/llm-client.js';
import admin from 'firebase-admin';

const openai = chatClient;

const router = express.Router();

import { withWorkspace } from '../middleware/withWorkspace';
import { checkLimit, planRateLimit } from '../middleware/planGate';

const PLATFORM_PROMPTS: Record<string, string> = {
    INSTAGRAM: `Start with a scroll-stopping first line that hooks the audience (no hashtags in line 1). Use double line breaks between short paragraphs. Tell a vulnerable story or give high educational value. End with a specific Call to Action (CTA). Add a blank line, then 15 hashtags: 5 high-volume (>1M), 5 medium (100k-1M), 5 niche (<100k). Total max 2200 chars.`,
    TIKTOK: `Max 150 characters. Format: [Hook — MUST create intense curiosity or FOMO in exactly the first 3 words] + [A very short value/caption] + [3-5 trending hashtags only].`,
    YOUTUBE: `SEO-optimized title (max 60 chars, FRONT-LOAD the main keyword). Description: The first 2 lines must be the most compelling (appear before 'Show More'). Include a 'Tags:' comma-separated array, a '[Chapter Placeholder]' list, and a subscribe CTA. Max 5000 chars. Return clearly labeled sections: TITLE, DESCRIPTION, TAGS.`,
    LINKEDIN: `Start with a bold insight or a shocking statistic opener. Use very short paragraphs (1-2 lines). Max 5 relevant hashtags at the end. End with a thought-provoking question to drive comments. Max 1300 chars.`,
    PINTEREST: `100-500 characters. Include the main keyword in the very first sentence. Write for high search intent. Embed 5 relevant keywords naturally into the sentences.`,
    THREADS: `Highly conversational, unfiltered, and raw. Present a strong opinion or a 'hot take' related to the transcript. Max 500 characters. DO NOT use hashtags.`
};

async function generateCaption(platform: string, transcript: string | undefined, niche: string | undefined, tone: string) {
    const systemPrompt = PLATFORM_PROMPTS[platform.toUpperCase()];
    if (!systemPrompt) return null;

    const response = await openai.chat.completions.create({
        model: CHAT_MODEL,
        temperature: 0.7,
        messages: [
            { role: 'system', content: `You are an elite social media manager writing in a ${tone} tone for the niche: ${niche || 'general'}. ${systemPrompt}. Return ONLY the final caption/structure requested, no surrounding conversation.` },
            { role: 'user', content: `Base the content off this context/transcript:

${transcript?.substring(0, 3000)}` }
        ],
    });

    const content = response.choices[0]?.message?.content || '';

    // Extract trailing hashtags safely if requested
    let hashtags: string[] = [];
    const hashMatch = content.match(/#[a-zA-Z0-9_]+/g);
    if (hashMatch && platform.toUpperCase() !== 'THREADS') {
        hashtags = hashMatch;
    }

    return { platform, caption: content, hashtags };
}

// POST /api/ai/generate-captions
// Streams one SSE event per platform by default. Send { stream: false } to get a single JSON
// response instead: { success, captions: { [platform]: caption } }.
router.post('/generate-captions', withWorkspace, planRateLimit(), checkLimit('aiCalls'), async (req: Request, res: Response) => {
    const { transcript, platforms = [], niche, tone = 'casual', stream = true } = req.body;
    const platformList: string[] = Array.isArray(platforms) ? platforms.filter((p: unknown) => typeof p === 'string') : [];

    if (stream === false) {
        if (platformList.length === 0) {
            return res.status(400).json({ error: 'PLATFORMS_REQUIRED', message: 'Pick at least one platform.' });
        }
        try {
            const results = await Promise.all(platformList.map((platform) => generateCaption(platform, transcript, niche, tone)));
            const captions: Record<string, string> = {};
            for (const result of results) {
                if (result) captions[result.platform] = result.caption;
            }
            return res.json({ success: true, captions });
        } catch (err: any) {
            console.error('Captions error:', err);
            return res.status(500).json({ error: err.message || 'CAPTION_GENERATION_FAILED' });
        }
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Establish SSE

    try {
        const promises = platformList.map(async (platform: string) => {
            const payload = await generateCaption(platform, transcript, niche, tone);
            if (payload) res.write(`data: ${JSON.stringify(payload)}

`);
        });

        await Promise.allSettled(promises);
        res.write(`data: ${JSON.stringify({ done: true })}

`);
    } catch (err: any) {
        console.error('Captions SSE Error:', err);
        res.write(`data: ${JSON.stringify({ error: err.message })}

`);
    } finally {
        res.end();
    }
});

// POST /api/ai/generate-hooks
router.post('/generate-hooks', withWorkspace, planRateLimit(), checkLimit('aiCalls'), async (req: Request, res: Response) => {
    const { transcript, niche } = req.body;
    try {
        const response = await openai.chat.completions.create({
            model: CHAT_MODEL,
            response_format: { type: "json_object" },
            messages: [
                { role: 'system', content: `You output exactly JSON. Format: { "hooks": [ { "hook": "text", "type": "question|controversy|stat|story", "explanation": "why" } ] }` },
                { role: 'user', content: `Generate 5 viral hooks for the niche: ${niche} based on:\n\n${transcript}` }
            ]
        });

        const data = JSON.parse(response.choices[0]?.message?.content || '{"hooks":[]}');
        res.json({ success: true, hooks: data.hooks });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/ai/hashtag-research
router.post('/hashtag-research', withWorkspace, planRateLimit(), checkLimit('aiCalls'), async (req: Request, res: Response) => {
    const { topic, platform } = req.body;
    try {
        const response = await openai.chat.completions.create({
            model: CHAT_MODEL,
            response_format: { type: "json_object" },
            messages: [
                { role: 'system', content: `Output JSON: { "data": { "high_volume": [], "medium": [], "niche": [], "trending": [] } }` },
                { role: 'user', content: `Research hashtags for topic: ${topic} on platform: ${platform}. Include exactly 5 strictly formatted hashtags per requested array category.` }
            ]
        });

        const data = JSON.parse(response.choices[0]?.message?.content || '{}');
        res.json({ success: true, ...data.data });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/ai/repurpose
router.post('/repurpose', withWorkspace, planRateLimit(), checkLimit('aiCalls'), async (req: Request, res: Response) => {
    const { caption, fromPlatform, toPlatforms = [] } = req.body;
    const results: Record<string, string> = {};

    try {
        await Promise.all(toPlatforms.map(async (platform: string) => {
            const systemPrompt = PLATFORM_PROMPTS[platform.toUpperCase()];
            if (!systemPrompt) return;

            const response = await openai.chat.completions.create({
                model: CHAT_MODEL,
                messages: [
                    { role: 'system', content: `Adapt this existing ${fromPlatform} caption into an optimized ${platform} piece. Do NOT add context. Strictly adhere to these rules: ${systemPrompt}` },
                    { role: 'user', content: caption }
                ]
            });
            results[platform] = response.choices[0]?.message?.content || '';
        }));

        res.json({ success: true, repurposed: results });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
