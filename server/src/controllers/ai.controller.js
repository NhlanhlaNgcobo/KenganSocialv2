import { getFirestore } from '../config/firebase.js';
import { generateContent, generateMedia, mediaGenerationAvailable, IMAGE_GENERATION_UNAVAILABLE } from '../services/ai.service.js';
import {
    parseCaptions,
    exportToSrt,
    generateTikTokCaptions,
    buildCaptionOverlayData,
    createRenderJob
} from '../services/video.service.js';
import { renderVerticalVideo, secondsToFrames } from '../services/render.service.js';
import { uploadFile } from '../services/storage.service.js';
import fs from 'fs';

// -------------------------------------------------------
// AI Text Generation (Captions, Hashtags, Scripts, Hooks)
// -------------------------------------------------------

/**
 * POST /api/ai/generate
 * Generate AI content with Gemini → OpenAI fallback.
 * Deducts 1 credit per generation.
 */
export async function generateAI(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId, prompt, type, tone, language, platform } = req.body;
        const uid = req.user.uid;

        if (!prompt || !workspaceId) {
            return res.status(400).json({ error: 'Prompt and Workspace ID are required' });
        }

        // 1. Credit check
        const workspaceRef = db.collection('workspaces').doc(workspaceId);
        const workspaceDoc = await workspaceRef.get();

        if (!workspaceDoc.exists) {
            return res.status(404).json({ error: 'Workspace not found' });
        }

        const workspaceData = workspaceDoc.data();
        const currentCredits = workspaceData.credits !== undefined ? workspaceData.credits : 50;

        if (currentCredits <= 0) {
            return res.status(402).json({ error: 'Insufficient AI credits. Please upgrade your plan.' });
        }

        // 2. Generate with real AI service
        const { result, provider } = await generateContent(type || 'caption', prompt, {
            tone,
            language,
            platform,
        });

        // 3. Deduct credits
        await workspaceRef.update({
            credits: currentCredits - 1,
            updatedAt: new Date().toISOString(),
        });

        // 4. Log usage
        await db.collection('ai_usage_logs').add({
            userId: uid,
            workspaceId,
            action: 'generation',
            type: type || 'caption',
            provider,
            promptSnippet: prompt.substring(0, 100),
            creditsDeducted: 1,
            timestamp: new Date().toISOString(),
        });

        res.json({
            result,
            provider,
            remainingCredits: currentCredits - 1,
        });
    } catch (error) {
        console.error('[AI Controller] Generation error:', error);
        res.status(500).json({ error: error.message || 'AI generation failed' });
    }
}

/**
 * POST /api/ai/generate-media
 * Generate a real image for AI-written copy (image-gen adapter: Pollinations or OpenRouter),
 * store it in our storage and return its URL. Costs 2 credits, deducted only after success.
 */
const MEDIA_COST = 2;

export async function generateMediaRequest(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId, prompt, type } = req.body;
        const uid = req.user.uid;

        if (!prompt || !workspaceId) {
            return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Write some copy first, then generate an image for it.' });
        }

        // Not configured: say so and charge nothing.
        if (!mediaGenerationAvailable()) {
            return res.status(503).json({ error: 'IMAGE_GENERATION_UNAVAILABLE', message: IMAGE_GENERATION_UNAVAILABLE });
        }

        // 1. Credit check
        const workspaceRef = db.collection('workspaces').doc(workspaceId);
        const workspaceDoc = await workspaceRef.get();

        if (!workspaceDoc.exists) {
            return res.status(404).json({ error: 'Workspace not found' });
        }

        const workspaceData = workspaceDoc.data();
        const currentCredits = workspaceData.credits !== undefined ? workspaceData.credits : 50;

        if (currentCredits < MEDIA_COST) {
            return res.status(402).json({ error: 'INSUFFICIENT_CREDITS', message: `You need ${MEDIA_COST} AI credits to generate an image.` });
        }

        // 2. Generate and store the image. Nothing is charged if this fails.
        let mediaResult;
        try {
            mediaResult = await generateMedia(String(prompt), type || 'image', { workspaceId });
        } catch (error) {
            console.error('[AI Controller] Image generation failed:', error.message);
            const status = error.status === 503 ? 503 : 502;
            return res.status(status).json({
                error: status === 503 ? 'IMAGE_GENERATION_UNAVAILABLE' : 'IMAGE_GENERATION_FAILED',
                message: status === 503 ? IMAGE_GENERATION_UNAVAILABLE : "The image couldn't be generated. No credits were used. Try again in a moment.",
            });
        }

        // 3. Deduct credits (transaction, so concurrent requests can't double-spend)
        const remainingCredits = await db.runTransaction(async (tx) => {
            const snap = await tx.get(workspaceRef);
            const credits = snap.data()?.credits !== undefined ? snap.data().credits : 50;
            const next = Math.max(0, credits - MEDIA_COST);
            tx.update(workspaceRef, { credits: next, updatedAt: new Date().toISOString() });
            return next;
        });

        // 4. Log usage
        await db.collection('ai_usage_logs').add({
            userId: uid,
            workspaceId,
            action: 'media_generation',
            type: mediaResult.type,
            provider: `${mediaResult.provider}:${mediaResult.model}`,
            promptSnippet: String(prompt).substring(0, 100),
            creditsDeducted: MEDIA_COST,
            timestamp: new Date().toISOString(),
        });

        res.json({
            mediaUrl: mediaResult.url,
            mediaType: mediaResult.type,
            remainingCredits,
        });
    } catch (error) {
        console.error('[AI Controller] Media generation error:', error);
        res.status(500).json({ error: 'MEDIA_GENERATION_FAILED', message: 'Image generation failed. Try again.' });
    }
}

/**
 * GET /api/ai/status
 * Which optional AI features are configured on this server.
 */
export function getAiStatus(_req, res) {
    res.json({ imageGeneration: mediaGenerationAvailable() });
}

// -------------------------------------------------------
// AI Credit Management
// -------------------------------------------------------

/**
 * GET /api/ai/credits/:workspaceId
 */
export async function getCredits(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId } = req.params;

        const doc = await db.collection('workspaces').doc(workspaceId).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Workspace not found' });
        }

        const data = doc.data();
        res.json({ credits: data.credits !== undefined ? data.credits : 50 });
    } catch (error) {
        console.error('[AI Controller] Get credits error:', error);
        res.status(500).json({ error: 'Failed to fetch credits' });
    }
}

/**
 * GET /api/ai/usage/:workspaceId
 * Return recent AI usage logs for a workspace.
 */
export async function getUsageLogs(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId } = req.params;

        const snapshot = await db.collection('ai_usage_logs')
            .where('workspaceId', '==', workspaceId)
            .orderBy('timestamp', 'desc')
            .limit(50)
            .get();

        const logs = [];
        snapshot.forEach(doc => logs.push(doc.data()));

        res.json({ logs });
    } catch (error) {
        console.error('[AI Controller] Usage logs error:', error);
        res.status(500).json({ error: 'Failed to fetch usage logs' });
    }
}

// -------------------------------------------------------
// Video Captions (Remotion Integration)
// -------------------------------------------------------

/**
 * POST /api/ai/captions/parse
 * Parse an uploaded .srt file into structured caption objects.
 */
export async function parseSrtFile(req, res) {
    try {
        const { srtContent } = req.body;

        if (!srtContent) {
            return res.status(400).json({ error: 'SRT content is required' });
        }

        if (typeof srtContent !== 'string' || srtContent.length > 2 * 1024 * 1024) {
            return res.status(400).json({ error: 'INVALID_SRT', message: 'Upload a text .srt file under 2 MB.' });
        }

        // Always a plain Caption[] (never the { captions } wrapper @remotion/captions returns).
        const captions = parseCaptions(srtContent);
        if (!captions.length) {
            return res.status(400).json({ error: 'EMPTY_SRT', message: "That file doesn't contain any captions we could read." });
        }

        res.json({
            captions,
            count: captions.length,
        });
    } catch (error) {
        console.error('[AI Controller] SRT parse error:', error);
        res.status(400).json({ error: 'INVALID_SRT', message: "That file couldn't be read as SRT captions." });
    }
}

/**
 * POST /api/ai/captions/export
 * Export caption objects back to .srt format string.
 */
export async function exportSrtFile(req, res) {
    try {
        const { captions } = req.body;

        if (!captions || !Array.isArray(captions)) {
            return res.status(400).json({ error: 'Captions array is required' });
        }

        const srt = exportToSrt(captions);
        res.json({ srt });
    } catch (error) {
        console.error('[AI Controller] SRT export error:', error);
        res.status(500).json({ error: 'SRT_EXPORT_FAILED', message: "The captions couldn't be exported. Try again." });
    }
}

/**
 * POST /api/ai/captions/tiktok
 * Generate TikTok-style animated caption pages from word timings.
 */
export async function generateTikTokStyleCaptions(req, res) {
    try {
        const { wordTimings, style } = req.body;

        if (!wordTimings || !Array.isArray(wordTimings)) {
            return res.status(400).json({ error: 'wordTimings array is required' });
        }

        const overlayData = buildCaptionOverlayData(wordTimings, style || {});

        res.json({
            overlayData,
            totalPages: overlayData.tikTokPages.length,
            totalCaptions: overlayData.captions.length,
        });
    } catch (error) {
        console.error('[AI Controller] TikTok captions error:', error);
        res.status(500).json({ error: 'Failed to generate TikTok captions' });
    }
}

// -------------------------------------------------------
// Video Render Jobs
// -------------------------------------------------------

/**
 * POST /api/ai/video/render
 * Queue a video render job (captions overlay + edits).
 */
export async function queueVideoRender(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId, contentId, inputVideoUrl, captionData, editConfig } = req.body;
        const uid = req.user.uid;

        if (!workspaceId || !inputVideoUrl) {
            return res.status(400).json({ error: 'Workspace ID and input video URL are required' });
        }

        // Credit check (video renders cost 5 credits)
        const workspaceRef = db.collection('workspaces').doc(workspaceId);
        const workspaceDoc = await workspaceRef.get();

        if (!workspaceDoc.exists) {
            return res.status(404).json({ error: 'Workspace not found' });
        }

        const currentCredits = workspaceDoc.data().credits || 50;

        if (currentCredits < 5) {
            return res.status(402).json({ error: 'Video rendering requires 5 AI credits.' });
        }

        // Create render job
        const job = createRenderJob({
            workspaceId,
            contentId,
            inputVideoUrl,
            captionData,
            editConfig,
        });

        // Save to Firestore
        await db.collection('render_jobs').doc(job.id).set(job);

        // Deduct credits
        await workspaceRef.update({
            credits: currentCredits - 5,
            updatedAt: new Date().toISOString(),
        });

        // Log usage
        await db.collection('ai_usage_logs').add({
            userId: uid,
            workspaceId,
            action: 'video_render',
            type: 'render',
            creditsDeducted: 5,
            renderJobId: job.id,
            timestamp: new Date().toISOString(),
        });

        // Return immediately — render runs in the background
        res.status(201).json({
            job,
            remainingCredits: currentCredits - 5,
        });

        // ---- Background Render ----
        const jobRef = db.collection('render_jobs').doc(job.id);
        try {
            await jobRef.update({ status: 'processing' });

            const durationSeconds = editConfig?.durationSeconds || 30;
            const compositionId = editConfig?.compositionId || 'VerticalCrop';

            const outputPath = await renderVerticalVideo({
                inputVideoUrl,
                durationInFrames: secondsToFrames(durationSeconds),
                compositionId,
                extraProps: captionData ? { captions: captionData } : {},
            });

            // Upload rendered file to Firebase Storage
            const fileBuffer = fs.readFileSync(outputPath);
            const outputUrl = await uploadFile(
                fileBuffer,
                `${workspaceId}/renders`,
                'video/mp4'
            );

            // Clean up temp file
            fs.unlinkSync(outputPath);

            await jobRef.update({
                status: 'completed',
                outputVideoUrl: outputUrl,
                progress: 100,
                updatedAt: new Date().toISOString(),
            });

            console.log(`[Render] Job ${job.id} completed → ${outputUrl}`);
        } catch (renderErr) {
            console.error(`[Render] Job ${job.id} failed:`, renderErr.message);
            await jobRef.update({
                status: 'failed',
                error: renderErr.message,
                updatedAt: new Date().toISOString(),
            });
        }
    } catch (error) {
        console.error('[AI Controller] Render queue error:', error);
        res.status(500).json({ error: 'Failed to queue video render' });
    }
}

/**
 * GET /api/ai/video/render/:jobId
 * Check the status of a render job.
 */
export async function getRenderJobStatus(req, res) {
    try {
        const db = getFirestore();
        const { jobId } = req.params;

        const doc = await db.collection('render_jobs').doc(jobId).get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Render job not found' });
        }

        res.json({ job: doc.data() });
    } catch (error) {
        console.error('[AI Controller] Render status error:', error);
        res.status(500).json({ error: 'Failed to fetch render status' });
    }
}
