import { getFirestore } from '../config/firebase.js';
import { generateContent, generateMedia } from '../services/ai.service.js';
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
 * Generate media (image/video concept storyboard) using Dall-E 3 based on generated text prompts.
 * Deducts 2 credits per generation.
 */
export async function generateMediaRequest(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId, prompt, type } = req.body;
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

        if (currentCredits < 2) {
            return res.status(402).json({ error: 'Insufficient AI credits. Media generation costs 2 credits.' });
        }

        // 2. Generate media
        const mediaResult = await generateMedia(prompt, type || 'image');

        // 3. Deduct credits
        await workspaceRef.update({
            credits: currentCredits - 2,
            updatedAt: new Date().toISOString(),
        });

        // 4. Log usage
        await db.collection('ai_usage_logs').add({
            userId: uid,
            workspaceId,
            action: 'media_generation',
            type: mediaResult.type,
            provider: 'dall-e-3',
            promptSnippet: prompt.substring(0, 100),
            creditsDeducted: 2,
            timestamp: new Date().toISOString(),
        });

        res.json({
            mediaUrl: mediaResult.url,
            mediaType: mediaResult.type,
            remainingCredits: currentCredits - 2,
        });
    } catch (error) {
        console.error('[AI Controller] Media generation error:', error);
        res.status(500).json({ error: error.message || 'Media generation failed' });
    }
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

        const captions = parseCaptions(srtContent);

        res.json({
            captions,
            count: captions.length,
        });
    } catch (error) {
        console.error('[AI Controller] SRT parse error:', error);
        res.status(500).json({ error: 'Failed to parse SRT file' });
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
        res.status(500).json({ error: 'Failed to export SRT' });
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
