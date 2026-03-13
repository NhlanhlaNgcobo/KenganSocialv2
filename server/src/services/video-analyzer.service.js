import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

/**
 * @fileoverview
 * Video Analyzer — Real transcription from video audio.
 * 
 * Priority chain:
 * 1. Gemini 2.0 Flash (multimodal — sends actual video for analysis)
 * 2. OpenAI Whisper (extracts audio → real speech-to-text transcription)
 * 3. Local fallback (synthetic — only when both APIs are down)
 */

const ANALYSIS_PROMPT = `You are a professional video editor AI. Analyze this video and return a JSON response with:

1. "transcription": Array of subtitle objects with timestamps. Each: {"text": "3-8 words", "startMs": 0, "endMs": 3000}
2. "keyMoments": Array of engaging moments. Each: {"startMs": 0, "endMs": 5000, "description": "...", "score": 8}
3. "suggestedCuts": Array of recommended clips. Each: {"startMs": 0, "endMs": 15000, "reason": "..."}
4. "summary": Brief 1-2 sentence summary
5. "suggestedCaption": Engaging social media caption with emojis

Return ONLY valid JSON. No markdown, no code blocks.`;

/**
 * Analyze a video file — tries Gemini first, falls back to OpenAI Whisper.
 */
export async function analyzeVideo(videoPath, options = {}) {
    console.log(`[Video Analyzer] Analyzing: ${videoPath}`);

    // 1. Try OpenAI Whisper first (real audio transcription with timestamps)
    if (process.env.OPENAI_API_KEY) {
        try {
            const result = await analyzeWithWhisper(videoPath, options);
            console.log('[Video Analyzer] ✅ OpenAI Whisper transcription succeeded');
            return result;
        } catch (err) {
            console.warn(`[Video Analyzer] ❌ OpenAI Whisper failed: ${err.message}`);
        }
    }

    // 2. Fallback: Gemini (multimodal — sends actual video)
    if (process.env.GEMINI_API_KEY) {
        try {
            const result = await analyzeWithGemini(videoPath, options);
            console.log('[Video Analyzer] ✅ Gemini analysis succeeded');
            return result;
        } catch (err) {
            console.warn(`[Video Analyzer] ❌ Gemini failed: ${err.message}`);
        }
    }

    // 3. Last resort: local fallback
    console.log('[Video Analyzer] ⚠️ All APIs failed — using local fallback');
    return generateLocalFallback(options.context);
}

// -------------------------------------------------------
// 1. Gemini Analysis (multimodal — sends actual video bytes)
// -------------------------------------------------------
async function analyzeWithGemini(videoPath, options) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    let prompt = ANALYSIS_PROMPT;
    if (options.context) prompt += `\nContext: ${options.context}`;

    const parts = [];

    // If there is a reference style video link, append instructions
    if (options.referenceUrl) {
        prompt += `\n\nIMPORTANT: You have also been provided with a REFERENCE TikTok style video link: ${options.referenceUrl}. You MUST analyze its editing style, typography, and pacing. Use this exact style to influence the 'keyMoments', 'suggestedCuts', and 'suggestedCaption' you generate for the main video. Match the hook punchiness and vibe. Use web search or your internet knowledge to analyze it if possible, otherwise infer from the URL slug.`;
    }

    // Now load the main video to analyze
    const videoBuffer = fs.readFileSync(videoPath);
    const mimeType = videoPath.endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
    parts.push({ inlineData: { mimeType, data: videoBuffer.toString('base64') } });
    parts.push({ text: prompt });

    const result = await model.generateContent(parts);

    return parseJsonResponse(result.response.text());
}

// -------------------------------------------------------
// 2. OpenAI Whisper (REAL audio transcription from video)
//    1. FFmpeg extracts audio track → temp .mp3
//    2. Whisper transcribes with word-level timestamps
//    3. GPT-4o-mini enhances with key moments + caption
// -------------------------------------------------------
async function analyzeWithWhisper(videoPath, options) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // --- Step 1: Extract audio from video using FFmpeg ---
    const audioPath = path.join(os.tmpdir(), `audio_${uuidv4()}.mp3`);
    console.log('[Video Analyzer] Extracting audio with FFmpeg...');

    await new Promise((resolve, reject) => {
        exec(
            `ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -ar 16000 -ac 1 -q:a 4 "${audioPath}" -y`,
            { timeout: 30000 },
            (err, stdout, stderr) => {
                if (err) {
                    console.error('[FFmpeg] Audio extraction error:', stderr);
                    reject(new Error('Failed to extract audio from video'));
                } else {
                    resolve();
                }
            }
        );
    });

    // Check if audio file was created and has content
    if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size < 1000) {
        try { fs.unlinkSync(audioPath); } catch { }
        throw new Error('Video has no audio track or audio extraction failed');
    }

    console.log(`[Video Analyzer] Audio extracted: ${(fs.statSync(audioPath).size / 1024).toFixed(0)}KB`);

    // --- Step 2: Transcribe with Whisper (word-level timestamps) ---
    console.log('[Video Analyzer] Sending audio to Whisper...');

    let whisperResult;
    try {
        whisperResult = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: 'whisper-1',
            response_format: 'verbose_json',
            timestamp_granularities: ['word', 'segment'],
        });
    } finally {
        // Clean up temp audio file
        try { fs.unlinkSync(audioPath); } catch { }
    }

    console.log(`[Video Analyzer] Whisper transcription: "${whisperResult.text?.substring(0, 80)}..."`);

    // --- Step 3: Convert Whisper segments to our subtitle format ---
    const segments = whisperResult.segments || [];
    const words = whisperResult.words || [];

    let transcription = [];

    if (segments.length > 0) {
        // Use segments (sentence-level chunks)
        transcription = segments.map(seg => ({
            text: seg.text.trim(),
            startMs: Math.round(seg.start * 1000),
            endMs: Math.round(seg.end * 1000),
        }));

        // Split long segments into smaller chunks (max 8 words)
        const splitTranscription = [];
        for (const seg of transcription) {
            const segWords = seg.text.split(' ');
            if (segWords.length > 8) {
                const chunks = [];
                for (let i = 0; i < segWords.length; i += 6) {
                    chunks.push(segWords.slice(i, i + 6).join(' '));
                }
                const segDuration = seg.endMs - seg.startMs;
                const chunkDuration = segDuration / chunks.length;
                chunks.forEach((chunk, idx) => {
                    splitTranscription.push({
                        text: chunk,
                        startMs: Math.round(seg.startMs + idx * chunkDuration),
                        endMs: Math.round(seg.startMs + (idx + 1) * chunkDuration),
                    });
                });
            } else {
                splitTranscription.push(seg);
            }
        }
        transcription = splitTranscription;
    } else if (words.length > 0) {
        // Build from word-level timestamps
        const chunkSize = 5;
        for (let i = 0; i < words.length; i += chunkSize) {
            const chunk = words.slice(i, i + chunkSize);
            transcription.push({
                text: chunk.map(w => w.word).join(' '),
                startMs: Math.round(chunk[0].start * 1000),
                endMs: Math.round(chunk[chunk.length - 1].end * 1000),
            });
        }
    } else if (whisperResult.text) {
        // Fallback: split the full text into lines
        const allWords = whisperResult.text.split(' ');
        const duration = whisperResult.duration || 30;
        const chunkSize = 5;
        for (let i = 0; i < allWords.length; i += chunkSize) {
            const chunk = allWords.slice(i, i + chunkSize);
            const startMs = Math.round((i / allWords.length) * duration * 1000);
            const endMs = Math.round(((i + chunkSize) / allWords.length) * duration * 1000);
            transcription.push({
                text: chunk.join(' '),
                startMs,
                endMs: Math.min(endMs, Math.round(duration * 1000)),
            });
        }
    }

    // --- Step 4: Use GPT to generate key moments + caption ---
    let keyMoments = [];
    let suggestedCuts = [];
    let summary = '';
    let suggestedCaption = '';

    try {
        const enhanceResponse = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'You analyze video transcriptions and generate metadata. Return ONLY valid JSON, no markdown.',
                },
                {
                    role: 'user',
                    content: `Here is the real transcription from a video:

"${whisperResult.text}"

Duration: ${whisperResult.duration || 30} seconds.
${options.context ? `Context: ${options.context}` : ''}

Generate JSON with:
{
  "keyMoments": [{"startMs": number, "endMs": number, "description": "what happens", "score": 1-10}] (3-5 moments),
  "suggestedCuts": [{"startMs": number, "endMs": number, "reason": "why this clip is good"}] (2-3 clips),
  "summary": "1-2 sentence summary of what is being said",
  "suggestedCaption": "engaging social media caption with emojis and hashtags"
}

Base timestamps on the actual content. Duration is ${whisperResult.duration || 30} seconds.`,
                },
            ],
            temperature: 0.7,
            max_tokens: 1000,
        });

        const enhanced = parseJsonResponse(enhanceResponse.choices[0]?.message?.content || '{}');
        keyMoments = enhanced.keyMoments || [];
        suggestedCuts = enhanced.suggestedCuts || [];
        summary = enhanced.summary || '';
        suggestedCaption = enhanced.suggestedCaption || '';
    } catch (err) {
        console.warn('[Video Analyzer] GPT enhance failed:', err.message);
        summary = whisperResult.text?.substring(0, 200) || '';
        suggestedCaption = whisperResult.text?.substring(0, 100) || '';
    }

    return {
        transcription,
        keyMoments,
        suggestedCuts,
        summary,
        suggestedCaption,
        _source: 'whisper',  // Tag so frontend knows this is real transcription
    };
}

// -------------------------------------------------------
// 3. Local Fallback (synthetic — no API)
// -------------------------------------------------------
function generateLocalFallback(context) {
    const topic = context || 'social media content';
    const lines = [
        `Creating amazing ${topic}`,
        'Let me show you how',
        'First tip is consistency',
        'Post every single day',
        'Engage with your audience',
        'Reply to every comment',
        'Use trending sounds',
        'Keep videos under 60 seconds',
        'Hook them in 3 seconds',
        'Add captions always',
        'Quality over quantity',
        'Be authentic and real',
    ];

    return {
        transcription: lines.map((text, i) => ({
            text,
            startMs: i * 3000,
            endMs: (i + 1) * 3000,
        })),
        keyMoments: [
            { startMs: 0, endMs: 6000, description: 'Opening hook', score: 9 },
            { startMs: 9000, endMs: 18000, description: 'Main tips', score: 8 },
            { startMs: 27000, endMs: 36000, description: 'Closing advice', score: 7 },
        ],
        suggestedCuts: [
            { startMs: 0, endMs: 15000, reason: 'Strong opening with tips' },
            { startMs: 15000, endMs: 30000, reason: 'Engagement advice segment' },
        ],
        summary: `A short-form video about ${topic} with actionable tips.`,
        suggestedCaption: `🔥 ${topic.charAt(0).toUpperCase() + topic.slice(1)} tips you NEED! 💡 #ContentCreator #SocialMedia`,
        _source: 'fallback',
    };
}

// -------------------------------------------------------
// JSON parser (handles markdown code blocks)
// -------------------------------------------------------
function parseJsonResponse(text) {
    let cleaned = text
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

    try {
        const parsed = JSON.parse(cleaned);
        return {
            transcription: parsed.transcription || [],
            keyMoments: parsed.keyMoments || [],
            suggestedCuts: parsed.suggestedCuts || [],
            summary: parsed.summary || '',
            suggestedCaption: parsed.suggestedCaption || '',
        };
    } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
            const parsed = JSON.parse(match[0]);
            return {
                transcription: parsed.transcription || [],
                keyMoments: parsed.keyMoments || [],
                suggestedCuts: parsed.suggestedCuts || [],
                summary: parsed.summary || '',
                suggestedCaption: parsed.suggestedCaption || '',
            };
        }
        throw new Error('Could not parse AI response as JSON');
    }
}
