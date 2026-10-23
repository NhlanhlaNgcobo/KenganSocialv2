import axios from 'axios';
import { db } from '../../utils/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { CHAT_MODEL, chatClient } from '../llm-client.js';

const openai = chatClient;

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const TIKTOK_ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '';
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';
// The old llama-3.1-sonar-* model names were retired by Perplexity; "sonar" is the current online model.
const PERPLEXITY_MODEL = process.env.PERPLEXITY_MODEL || 'sonar';

const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
// A manual refresh regenerates the cache at most this often, so repeated clicks can't run up LLM costs.
const MIN_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** 'live' = built from real trend data (YouTube / TikTok / Perplexity); 'ai-ideas' = AI suggestions only. */
export type TrendDataSource = 'live' | 'ai-ideas';

export interface TrendCard {
    id: string;
    hook: string;
    videoIdea: string;
    captionPreview: string;
    hashtags: string[];
    platform: string;
    /** An AI estimate, not a measured metric. */
    viralityScore: number;
    difficulty: 'easy' | 'medium' | 'hard';
    source: string;
}

export interface TrendingResult {
    cards: TrendCard[];
    generatedAt: string | null;
    dataSource: TrendDataSource;
    cached: boolean;
    refreshThrottled?: boolean;
}

function buildFallbackCards(niche: string, source: string): TrendCard[] {
    const normalizedNiche = niche.trim() || 'general';

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
            source,
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
            source,
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
            source,
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

function cardsForPlan(cards: TrendCard[], dataSource: TrendDataSource, plan: string) {
    // Starter gets the YouTube/TikTok-derived cards only (no Perplexity). When there is no live
    // data at all, the cards are AI ideas for everyone, labelled as such.
    if (plan === 'starter' && dataSource === 'live') {
        return cards.filter((c) => c.source === 'youtube' || c.source === 'tiktok');
    }
    return cards;
}

export async function fetchTrendingResult(
    niche: string,
    plan: string = 'starter',
    options: { refresh?: boolean } = {}
): Promise<TrendingResult> {
    const firestoreKey = niche.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const cacheDoc = db.collection('trending_cache').doc(firestoreKey);

    // 1. Check cache (2 hours TTL). A manual refresh skips it unless it was just regenerated.
    const cached = await cacheDoc.get();
    if (cached.exists) {
        const data = cached.data();
        const generatedMs = data?.timestamp?.toMillis?.() ?? 0;
        const ageMs = Date.now() - generatedMs;
        const dataSource: TrendDataSource = data?.dataSource === 'live' ? 'live' : 'ai-ideas';
        const throttled = !!options.refresh && ageMs < MIN_REFRESH_INTERVAL_MS;

        if ((!options.refresh || throttled) && ageMs < CACHE_TTL_MS && data?.cards?.length > 0) {
            return {
                cards: cardsForPlan(data.cards, dataSource, plan),
                generatedAt: generatedMs ? new Date(generatedMs).toISOString() : null,
                dataSource,
                cached: true,
                ...(throttled ? { refreshThrottled: true } : {}),
            };
        }
    }

    // 2. Fetch Fresh Data (Parallel Sources)
    const rawData: Array<{ source: string; text: string }> = [];

    const sources: Promise<void>[] = [];
    // Source A: YouTube Most Popular
    if (YOUTUBE_API_KEY) sources.push((async () => {
        try {
            const ytCat = mapNicheToCategory(niche);
            const ytRes = await axios.get(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&videoCategoryId=${ytCat}&maxResults=10&regionCode=ZA&key=${YOUTUBE_API_KEY}`, { timeout: 10000 });
            if (ytRes.data?.items) {
                const titles = ytRes.data.items.map((i: any) => i.snippet.title).join(' | ');
                rawData.push({ source: 'youtube', text: titles });
            }
        } catch (err: any) {
            console.error('YouTube Trend Fetch Error:', err.message);
        }
    })());

    // Source B: TikTok Research API hashtag suggestions
    if (TIKTOK_ACCESS_TOKEN) sources.push((async () => {
        try {
            const tkRes = await axios.get(`https://open.tiktokapis.com/v2/research/adv/hashtag/suggest?keyword=${encodeURIComponent(niche)}&country_code=ZA`, {
                timeout: 10000, headers: { 'Authorization': `Bearer ${TIKTOK_ACCESS_TOKEN}` }
            });
            if (tkRes.data?.data) {
                const tkTags = tkRes.data.data.map((i: any) => `#${i.hashtag_name} (${i.view_count} views)`).join(', ');
                rawData.push({ source: 'tiktok', text: tkTags });
            }
        } catch (err: any) {
            console.error('TikTok Trend Fetch Error:', err.message);
        }
    })());

    // Source C: Perplexity (online search) — only for nano, creator, agency plans
    if (plan !== 'starter' && PERPLEXITY_API_KEY) sources.push((async () => {
        try {
            const pxRes = await axios.post('https://api.perplexity.ai/chat/completions', {
                model: PERPLEXITY_MODEL,
                messages: [{
                    role: 'user',
                    content: `What content is trending on social media for ${niche} creators this week in South Africa? Return 5 specific content ideas with hooks.`
                }]
            }, { timeout: 12000, headers: { 'Authorization': `Bearer ${PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' } });

            const pxData = pxRes.data.choices[0]?.message?.content || '';
            if (pxData) rawData.push({ source: 'perplexity', text: pxData });
        } catch (err: any) {
            console.error('Perplexity Trend Fetch Error:', err.response?.data?.error?.message || err.message);
        }
    })());
    await Promise.all(sources);

    let dataSource: TrendDataSource = rawData.length > 0 ? 'live' : 'ai-ideas';

    // No live source configured or reachable: ask for ideas, and label them honestly as AI ideas.
    if (rawData.length === 0) {
        rawData.push({ source: 'ai-ideas', text: `No live trend data available. Suggest evergreen ${niche} content ideas.` });
    }

    // 3. Have the chat model structure the raw data into cards
    const combinedContext = rawData.map(r => `[SOURCE: ${r.source}] Data: ${r.text}`).join('\n\n');

    let generatedCards: TrendCard[] = [];
    try {
        const gptRes = await openai.chat.completions.create({
            model: CHAT_MODEL,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: `You are a social media trend analyst. Turn the raw trend data into distinct video ideas with hooks. Set "source" to the [SOURCE: ...] value the idea came from. Output exactly JSON: { "cards": [ { "id": "card_XYZ123", "hook": "...", "videoIdea": "...", "captionPreview": "...", "hashtags": ["#tag1", "#tag2"], "platform": "tiktok|instagram|youtube", "viralityScore": 1-10 int, "difficulty": "easy|medium|hard", "source": "origin source" } ] }` },
                { role: 'user', content: `Niche: ${niche}.\nRaw Trend Data:\n${combinedContext}` }
            ]
        }, { timeout: 15000, maxRetries: 0 });

        const parsed = JSON.parse(gptRes.choices[0]?.message?.content || '{"cards":[]}');
        generatedCards = Array.isArray(parsed.cards) ? parsed.cards : [];
    } catch (err: any) {
        console.error('Trend GPT Consolidation Error:', err.message);
    }

    if (generatedCards.length === 0) {
        dataSource = 'ai-ideas';
        generatedCards = buildFallbackCards(niche, 'ai-ideas');
    }

    const liveSources = new Set(rawData.map((r) => r.source));
    generatedCards = generatedCards.map(c => ({
        ...c,
        id: c.id || `trend_${Math.random().toString(36).substr(2, 6)}`,
        hashtags: Array.isArray(c.hashtags) ? c.hashtags : [],
        platform: typeof c.platform === 'string' ? c.platform : 'tiktok',
        viralityScore: Math.min(10, Math.max(1, Math.round(Number(c.viralityScore) || 5))),
        difficulty: ['easy', 'medium', 'hard'].includes(c.difficulty) ? c.difficulty : 'medium',
        // Never let the model claim a live source we did not actually query.
        source: dataSource === 'ai-ideas' ? 'ai-ideas' : (liveSources.has(c.source) ? c.source : rawData[0].source),
    }));

    // 4. Save to Firestore (Cache)
    await cacheDoc.set({
        niche,
        evidence: rawData.filter(r => r.source !== 'ai-ideas'),
        cards: generatedCards,
        dataSource,
        timestamp: FieldValue.serverTimestamp()
    });

    return {
        cards: cardsForPlan(generatedCards, dataSource, plan),
        generatedAt: new Date().toISOString(),
        dataSource,
        cached: false,
    };
}

/** Back-compat wrapper (used by the trending cron): returns just the cards. */
export async function fetchTrendingByNiche(niche: string, plan: string = 'starter', options: { refresh?: boolean } = {}): Promise<TrendCard[]> {
    const result = await fetchTrendingResult(niche, plan, options);
    return result.cards;
}
