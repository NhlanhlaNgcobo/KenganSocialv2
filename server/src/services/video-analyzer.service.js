import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { GEMINI_MODEL } from '../config/ai-models.js';
import { FFMPEG, probe, run } from './ffmpeg-runner.js';

/**
 * @fileoverview
 * Video Analyzer — Real transcription from video audio.
 * 
 * Priority chain:
 * 1. OpenAI Whisper (extracts audio → speech-to-text, plus GPT key moments)
 * 2. Local Whisper in the Python video service (free, offline)
 * 3. Gemini (multimodal — sends a small proxy of the video; retries busy models)
 * 4. No captions (only when every service above is unavailable)
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

    // 2. Local Whisper in the Python video service: free, offline, real transcription.
    try {
        const result = await analyzeWithLocalWhisper(videoPath);
        console.log('[Video Analyzer] ✅ Local Whisper transcription succeeded');
        return result;
    } catch (err) {
        // No speech is an answer, not a failure: other services could only invent captions for it
        // (Gemini's free tier also took minutes on a silent clip).
        if (err.noSpeech) {
            console.log('[Video Analyzer] No speech in the video: no captions');
            return { ...generateLocalFallback(options.context), _source: 'no-speech' };
        }
        console.warn(`[Video Analyzer] ❌ Local Whisper failed: ${err.message}`);
    }

    // 3. Gemini (multimodal — sends a small proxy of the video)
    if (process.env.GEMINI_API_KEY) {
        try {
            const result = await analyzeWithGemini(videoPath, options);
            console.log('[Video Analyzer] ✅ Gemini analysis succeeded');
            return result;
        } catch (err) {
            console.warn(`[Video Analyzer] ❌ Gemini failed: ${err.message}`);
        }
    }

    // 4. Nothing could transcribe: return no captions rather than invented ones.
    console.log('[Video Analyzer] ⚠️ All transcription services failed — returning no captions');
    return generateLocalFallback(options.context);
}

// -------------------------------------------------------
// Local Whisper (faster-whisper in the Python video service)
// -------------------------------------------------------
const PYTHON_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';

async function analyzeWithLocalWhisper(videoPath) {
    const info = await probe(videoPath);
    if (!info.hasAudio) throw new Error('Video has no audio track to transcribe');

    let data;
    try {
        const response = await axios.post(
            `${PYTHON_URL}/process/transcribe`,
            // "nano" selects the base model, which is small enough to run on CPU quickly.
            { videoUrl: videoPath, jobId: `analyze_${uuidv4()}`, workspaceId: 'content-studio', plan: 'nano' },
            { timeout: 15 * 60 * 1000 }
        );
        data = response.data;
    } catch (err) {
        if (err.code === 'ECONNREFUSED') throw new Error('Python video service is not running');
        throw new Error(err.response?.data?.detail?.message || err.message);
    }

    const words = data.words || [];
    if (!words.length) throw Object.assign(new Error('No speech detected'), { noSpeech: true });

    // Group words into caption lines of up to 5 words, breaking on pauses and sentence ends.
    const transcription = [];
    let line = null;
    for (const w of words) {
        const text = String(w.text || '').trim();
        if (!text) continue;
        const startsNew = !line || line.words.length >= 5 || w.start - line.endMs > 700 || /[.!?]$/.test(line.words[line.words.length - 1]);
        if (startsNew) {
            if (line) transcription.push({ text: line.words.join(' '), startMs: line.startMs, endMs: line.endMs });
            line = { words: [text], startMs: w.start, endMs: w.end };
        } else {
            line.words.push(text);
            line.endMs = w.end;
        }
    }
    if (line) transcription.push({ text: line.words.join(' '), startMs: line.startMs, endMs: line.endMs });

    const fullText = transcription.map((t) => t.text).join(' ');
    return {
        transcription,
        keyMoments: [],
        suggestedCuts: [],
        summary: fullText.slice(0, 200),
        suggestedCaption: fullText.slice(0, 100),
        _source: 'local-whisper',
    };
}

// -------------------------------------------------------
// 1. Gemini Analysis (multimodal — sends actual video bytes)
// -------------------------------------------------------
async function analyzeWithGemini(videoPath, options) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    let prompt = ANALYSIS_PROMPT;
    if (options.context) prompt += `\nContext: ${options.context}`;

    const parts = [];

    // If there is a reference style video link, append instructions
    if (options.referenceUrl) {
        prompt += `\n\nIMPORTANT: You have also been provided with a REFERENCE TikTok style video link: ${options.referenceUrl}. You MUST analyze its editing style, typography, and pacing. Use this exact style to influence the 'keyMoments', 'suggestedCuts', and 'suggestedCaption' you generate for the main video. Match the hook punchiness and vibe. Use web search or your internet knowledge to analyze it if possible, otherwise infer from the URL slug.`;
    }

    // Inline requests are capped at ~20MB, so send a small proxy instead of the original.
    // Gemini samples video at about 1 fps, so 360p at low bitrate loses nothing it uses.
    const proxyPath = path.join(os.tmpdir(), `gemini_proxy_${uuidv4()}.mp4`);
    try {
        await run(FFMPEG, [
            '-hide_banner', '-y', '-i', videoPath,
            '-vf', 'scale=-2:360,fps=2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '34',
            '-c:a', 'aac', '-b:a', '48k', '-ac', '1', '-movflags', '+faststart', proxyPath,
        ]);
        const size = fs.statSync(proxyPath).size;
        if (size > 19 * 1024 * 1024) throw new Error('Video is too long for inline Gemini analysis');
        parts.push({ inlineData: { mimeType: 'video/mp4', data: fs.readFileSync(proxyPath).toString('base64') } });
    } finally {
        try { fs.unlinkSync(proxyPath); } catch { }
    }
    parts.push({ text: prompt });

    const GEMINI_TIMEOUT_MS = 60_000;
    // Google returns 503/429 when a model is overloaded and 404 when one is retired;
    // retry busy models, then fall through to other current ones.
    const models = [...new Set([GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-flash-lite-latest'])];
    let lastError;
    for (const modelId of models) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                // A time limit per call: the free tier sometimes takes minutes, and the user is waiting.
                const result = await genAI.getGenerativeModel({ model: modelId }, { timeout: GEMINI_TIMEOUT_MS }).generateContent(parts);
                return { ...parseJsonResponse(result.response.text()), _source: 'gemini' };
            } catch (err) {
                lastError = err;
                if (/\b404\b|no longer available|not found/i.test(err.message)) break; // retired: next model
                const retryable = /\b(503|429|500)\b|overloaded|high demand/i.test(err.message);
                if (!retryable) throw err;
                console.warn(`[Video Analyzer] Gemini ${modelId} busy (attempt ${attempt + 1}), retrying...`);
                await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
            }
        }
    }
    throw lastError;
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
    const info = await probe(videoPath);
    if (!info.hasAudio) throw new Error('Video has no audio track to transcribe');

    const audioPath = path.join(os.tmpdir(), `audio_${uuidv4()}.mp3`);
    console.log('[Video Analyzer] Extracting audio with FFmpeg...');
    try {
        // No shell and no fixed timeout: long uploads used to be killed silently after 30s.
        await run(FFMPEG, ['-hide_banner', '-y', '-i', videoPath, '-map', '0:a:0', '-vn', '-acodec', 'libmp3lame', '-ar', '16000', '-ac', '1', '-q:a', '4', audioPath]);
    } catch (err) {
        console.error('[FFmpeg] Audio extraction error:', err.message);
        throw new Error(`Failed to extract audio from video: ${err.message}`);
    }

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
    // No invented captions: burning made-up text into a user's video is worse than none.
    const topic = context || 'your video';
    return {
        transcription: [],
        keyMoments: [],
        suggestedCuts: [],
        summary: '',
        suggestedCaption: `New video about ${topic} 🎬`,
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
