import axios from 'axios';
import { db } from '../../utils/firestore';
import admin from 'firebase-admin';
import { CHAT_MODEL, chatClient } from '../llm-client.js';

const openai = chatClient;

// Assuming valid API keys are mapped
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const TIKTOK_ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '';
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';

export interface TrendCard {
    id: string;
    hook: string;
    videoIdea: string;
    captionPreview: string;
    hashtags: string[];
    platform: string;
    viralityScore: number;
    difficulty: 'easy' | 'medium' | 'hard';
    source: string;
}

function buildFallbackCards(niche: string, rawData: Array<{ source: string; text: string }>): TrendCard[] {
    const normalizedNiche = niche.trim() || 'general';
    const primarySource = rawData[0]?.source || 'fallback';

    return [
        {
            id: `trend_${normalizedNiche}_hook`,
            hook: `3 ${normalizedNiche} mistakes killing your growth`,
            videoIdea: `Record a fast-paced breakdown of the top mistakes ${normalizedNiche} creators or brands make and how to fix each one.`,
            captionPreview: `If your ${normalizedNiche} content is stalling, start with these 3 fixes today.`,
            hashtags: [`#${normalizedNiche.replace(/\s+/g, '')}`, '#southafrica', '#contentstrategy'],
            platform: 'tiktok',
            viralityScore: 8,
            difficulty: 'easy',
            source: primarySource,
        },
        {
            id: `trend_${normalizedNiche}_story`,
            hook: `What happened when I changed one ${normalizedNiche} habit`,
            videoIdea: `Share a before-and-after style story showing one tactical change and the result it created over a week.`,
            captionPreview: `Small shifts compound fast. This is the ${normalizedNiche} move I would repeat again.`,
            hashtags: [`#${normalizedNiche.replace(/\s+/g, '')}tips`, '#growth', '#learnontiktok'],
            platform: 'instagram',
            viralityScore: 7,
            difficulty: 'medium',
            source: primarySource,
        },
        {
            id: `trend_${normalizedNiche}_list`,
            hook: `5 ${normalizedNiche} ideas you can film today`,
            videoIdea: `Create a list-format short that gives five simple content prompts someone in this niche can shoot immediately.`,
            captionPreview: `No more blank-page energy. Here are 5 ${normalizedNiche} ideas to post this week.`,
            hashtags: [`#${normalizedNiche.replace(/\s+/g, '')}creator`, '#videomarketing', '#sacreators'],
            platform: 'youtube',
            viralityScore: 7,
            difficulty: 'easy',
            source: primarySource,
        },
    ];
}

// Map textual niches to YouTube Category IDs (approximate)
function mapNicheToCategory(niche: string) {
    const n = niche.toLowerCase();
    if (n.includes('fitness') || n.includes('sport')) return 17; // Sports
    if (n.includes('gaming')) return 20; // Gaming
    if (n.includes('music')) return 10; // Music
    if (n.includes('comedy') || n.includes('funny')) return 23; // Comedy
    if (n.includes('tech') || n.includes('science')) return 28; // Science & Tech
    if (n.includes('education')) return 27; // Education
    return 24; // Entertainment fallback
}

export async function fetchTrendingByNiche(niche: string, plan: string = 'starter'): Promise<TrendCard[]> {
    const firestoreKey = niche.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const cacheDoc = db.collection('trending_cache').doc(firestoreKey);

    // 1. Check cache (2 hours TTL)
    const cached = await cacheDoc.get();
    if (cached.exists) {
        const data = cached.data();
        const ageHours = (Date.now() - data?.timestamp?.toMillis()) / (1000 * 60 * 60);

        // Return cache instantly if less than 2 hours old
        if (ageHours < 2 && data?.cards?.length > 0) {
            // Nano+ plan can access all cached cards, Starter might be filtered or just return the cached
            // Since cost-sharing says same cache served to all, Starter gets access if nano ran it?
            // Actually prompt says "Starter plan: YouTube data only (no Perplexity call)" when fetching fresh.
            // If fetching from cache, filter by 'source' if needed or just return all? We'll filter source for Starter.
            if (plan === 'starter') {
                return data.cards.filter((c: TrendCard) => c.source === 'youtube' || c.source === 'tiktok');
            }
            return data.cards;
        }
    }

    // 2. Fetch Fresh Data (Parallel Sources)
    const rawData = [];

    // Source A: YouTube Most Popular
    if (YOUTUBE_API_KEY) {
        try {
            const ytCat = mapNicheToCategory(niche);
            const ytRes = await axios.get(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&videoCategoryId=${ytCat}&maxResults=10&regionCode=ZA&key=${YOUTUBE_API_KEY}`);
            if (ytRes.data?.items) {
                const titles = ytRes.data.items.map((i: any) => i.snippet.title).join(' | ');
                rawData.push({ source: 'youtube', text: titles });
            }
        } catch (err: any) {
            console.error('YouTube Trend Fetch Error:', err.message);
        }
    }

    // Source B: TikTok Hashtag Research API (Mock if no token for now standard API approach)
    if (TIKTOK_ACCESS_TOKEN) {
        try {
            const tkRes = await axios.get(`https://open.tiktokapis.com/v2/research/adv/hashtag/suggest?keyword=${encodeURIComponent(niche)}&country_code=ZA`, {
                headers: { 'Authorization': `Bearer ${TIKTOK_ACCESS_TOKEN}` }
            });
            if (tkRes.data?.data) {
                const tkTags = tkRes.data.data.map((i: any) => `#${i.hashtag_name} (${i.view_count} views)`).join(', ');
                rawData.push({ source: 'tiktok', text: tkTags });
            }
        } catch (err: any) {
            console.error('TikTok Trend Fetch Error:', err.message);
        }
    }

    // Source C: Perplexity AI (Only for nano, creator, agency plans)
    if (plan !== 'starter' && PERPLEXITY_API_KEY) {
        try {
            const pxRes = await axios.post('https://api.perplexity.ai/chat/completions', {
                model: 'llama-3.1-sonar-large-128k-online',
                messages: [{
                    role: 'user',
                    content: `What content is trending on social media for ${niche} creators this week in South Africa? Return 5 specific content ideas with hooks.`
                }]
            }, { headers: { 'Authorization': `Bearer ${PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' } });

            const pxData = pxRes.data.choices[0]?.message?.content || '';
            rawData.push({ source: 'perplexity', text: pxData });
        } catch (err: any) {
            console.error('Perplexity Trend Fetch Error:', err.message);
        }
    }

    // If all failed or no keys setup, provide fallback baseline to prevent crashes
    if (rawData.length === 0) {
        rawData.push({ source: 'youtube', text: `Generic ${niche} content ideas and engaging tips.` });
    }

    // 3. Centralized GPT-4o-mini mapping
    // We pass all raw text arrays to OpenAI to formalize strictly into [ { hook, videoIdea, ... } ]
    const combinedContext = rawData.map(r => `[SOURCE: ${r.source}] Data: ${r.text}`).join('\n\n');

    let generatedCards: TrendCard[] = [];
    try {
        const gptRes = await openai.chat.completions.create({
            model: CHAT_MODEL,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: `You are a social media trend analyst. Turn the raw trend data into beautifully formatted distinct video hooks. Output exactly JSON: { "cards": [ { "id": "card_XYZ123", "hook": "...", "videoIdea": "...", "captionPreview": "...", "hashtags": ["#tag1", "#tag2"], "platform": "tiktok|instagram|youtube", "viralityScore": 1-10 int, "difficulty": "easy|medium|hard", "source": "origin source" } ] }` },
                { role: 'user', content: `Niche: ${niche}.\nRaw Trend Data:\n${combinedContext}` }
            ]
        });

        const parsed = JSON.parse(gptRes.choices[0]?.message?.content || '{"cards":[]}');
        generatedCards = parsed.cards || [];
    } catch (err: any) {
        console.error('Trend GPT Consolidation Error:', err.message);
    }

    if (generatedCards.length === 0) {
        generatedCards = buildFallbackCards(niche, rawData);
    }

    if (generatedCards.length > 0) {
        // Enforce fallback schema types if LLM halluciantes parameters
        generatedCards = generatedCards.map(c => ({
            ...c,
            id: c.id || `trend_${Math.random().toString(36).substr(2, 6)}`,
            viralityScore: Number(c.viralityScore) || 7,
            difficulty: ['easy', 'medium', 'hard'].includes(c.difficulty) ? c.difficulty : 'medium',
        }));

        // 4. Save to Firestore (Cache)
        await cacheDoc.set({
            niche,
            cards: generatedCards,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    return plan === 'starter'
        ? generatedCards.filter(c => c.source === 'youtube' || c.source === 'tiktok')
        : generatedCards;
}
