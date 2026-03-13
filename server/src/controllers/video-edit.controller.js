import { analyzeVideo } from '../services/video-analyzer.service.js';
import { cropToVertical, burnSubtitles, cropAndCaption, getVideoInfo } from '../services/video-editor.service.js';
import { uploadFile } from '../services/storage.service.js';
import { getFirestore } from '../config/firebase.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import os from 'os';

const RENDER_DIR = path.join(os.tmpdir(), 'kengan-renders');

// -------------------------------------------------------
// POST /api/ai/video/analyze
// Upload a video file, analyze it with Gemini, return analysis
// -------------------------------------------------------
export async function analyzeUploadedVideo(req, res) {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No video file uploaded' });
        }

        const context = req.body.context || '';
        console.log(`[Video Edit] Analyzing video: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);

        // Get video info first
        let videoInfo = {};
        try {
            videoInfo = await getVideoInfo(file.path);
            console.log(`[Video Edit] Video info: ${videoInfo.width}x${videoInfo.height}, ${videoInfo.duration?.toFixed(1)}s`);
        } catch (err) {
            console.warn('[Video Edit] Could not probe video:', err.message);
        }

        // Analyze with Gemini/Whisper
        const analysis = await analyzeVideo(file.path, {
            context,
            referenceUrl: req.body.referenceUrl
        });

        // Store the temp file path for later rendering
        const db = getFirestore();
        const jobId = uuidv4();

        // Move temp file to a stable location
        const stablePath = path.join(RENDER_DIR, `source_${jobId}${path.extname(file.originalname || '.mp4')}`);
        if (!fs.existsSync(RENDER_DIR)) fs.mkdirSync(RENDER_DIR, { recursive: true });
        fs.copyFileSync(file.path, stablePath);

        // Save analysis to Firestore
        await db.collection('video_analyses').doc(jobId).set({
            id: jobId,
            userId: req.user.uid,
            sourcePath: stablePath,
            videoInfo,
            analysis,
            createdAt: new Date().toISOString(),
        });

        // Clean up multer temp file
        try { fs.unlinkSync(file.path); } catch { }

        res.json({
            jobId,
            videoInfo,
            analysis,
        });
    } catch (error) {
        console.error('[Video Edit] Analyze error:', error);
        res.status(500).json({ error: error.message || 'Video analysis failed' });
    }
}

// -------------------------------------------------------
// POST /api/ai/video/edit
// Render the final edited video (crop + captions)
// Body: { jobId, subtitles, style, options: { startMs, endMs, mode } }
// mode: 'crop' | 'caption' | 'full' (crop + caption)
// -------------------------------------------------------
export async function renderEditedVideo(req, res) {
    try {
        const { jobId, subtitles, style, options } = req.body;

        if (!jobId) {
            return res.status(400).json({ error: 'Job ID is required' });
        }

        const db = getFirestore();

        // Get the analysis doc
        const analysisDoc = await db.collection('video_analyses').doc(jobId).get();
        if (!analysisDoc.exists) {
            return res.status(404).json({ error: 'Video analysis not found. Upload and analyze first.' });
        }

        const analysisData = analysisDoc.data();
        const sourcePath = analysisData.sourcePath;

        if (!fs.existsSync(sourcePath)) {
            return res.status(404).json({ error: 'Source video file expired. Please re-upload.' });
        }

        // Create render job
        const renderId = uuidv4();
        const mode = options?.mode || 'full';
        const musicId = options?.musicId;
        const musicVolume = options?.musicVolume || 0.2;

        await db.collection('render_jobs').doc(renderId).set({
            id: renderId,
            jobId,
            userId: req.user.uid,
            status: 'processing',
            mode,
            musicId,
            musicVolume,
            style: style || {},
            progress: 0,
            createdAt: new Date().toISOString(),
        });

        // Return immediately — render runs in background
        res.status(202).json({
            renderId,
            status: 'processing',
            message: 'Rendering started. Poll /api/ai/video/status/:renderId for progress.',
        });

        // ---- Background Render ----
        const jobRef = db.collection('render_jobs').doc(renderId);

        try {
            let outputPath;
            let musicPath = null;
            if (musicId) {
                // Look for music in public/sounds
                musicPath = path.join(process.cwd(), 'public', 'sounds', musicId);
                if (!fs.existsSync(musicPath)) {
                    console.warn(`[Video Edit] Music not found: ${musicPath}`);
                    musicPath = null;
                }
            }

            if (mode === 'crop') {
                // Crop only — no captions
                await jobRef.update({ progress: 20 });
                outputPath = await cropToVertical(sourcePath, {
                    startMs: options?.startMs,
                    endMs: options?.endMs,
                });
            } else if (mode === 'caption') {
                // Add captions only — no crop
                await jobRef.update({ progress: 20 });
                outputPath = await burnSubtitles(sourcePath, subtitles || analysisData.analysis.transcription, style || {});
            } else {
                // Full pipeline: crop + captions + music
                await jobRef.update({ progress: 10 });
                outputPath = await cropAndCaption(
                    sourcePath,
                    subtitles || analysisData.analysis.transcription,
                    style || {},
                    {
                        startMs: options?.startMs,
                        endMs: options?.endMs,
                        musicPath,
                        musicVolume,
                        quality: options?.quality,
                        hasAudio: analysisData.videoInfo?.hasAudio !== false
                    }
                );
            }

            await jobRef.update({ progress: 80 });

            // The output file can be served directly
            const filename = path.basename(outputPath);

            await jobRef.update({
                status: 'completed',
                progress: 100,
                outputPath,
                outputFilename: filename,
                downloadUrl: `/api/ai/video/download/${filename}`,
                updatedAt: new Date().toISOString(),
            });

            console.log(`[Video Edit] Render ${renderId} complete → ${filename}`);
        } catch (renderErr) {
            console.error(`[Video Edit] Render ${renderId} failed:`, renderErr.message);
            await jobRef.update({
                status: 'failed',
                error: renderErr.message,
                updatedAt: new Date().toISOString(),
            });
        }
    } catch (error) {
        console.error('[Video Edit] Render error:', error);
        res.status(500).json({ error: error.message || 'Video render failed' });
    }
}

// -------------------------------------------------------
// GET /api/ai/video/status/:jobId
// Check render status
// -------------------------------------------------------
export async function getRenderStatus(req, res) {
    try {
        const { jobId } = req.params;
        const db = getFirestore();
        const doc = await db.collection('render_jobs').doc(jobId).get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Render job not found' });
        }

        const data = doc.data();
        res.json({
            renderId: data.id,
            status: data.status,
            progress: data.progress || 0,
            downloadUrl: data.downloadUrl || null,
            error: data.error || null,
        });
    } catch (error) {
        console.error('[Video Edit] Status error:', error);
        res.status(500).json({ error: 'Failed to get status' });
    }
}

// -------------------------------------------------------
// GET /api/ai/video/download/:filename
// Serve the rendered video file
// -------------------------------------------------------
export async function serveRenderedFile(req, res) {
    try {
        const { filename } = req.params;
        const filePath = path.join(RENDER_DIR, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found or expired' });
        }

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        fs.createReadStream(filePath).pipe(res);
    } catch (error) {
        console.error('[Video Edit] Download error:', error);
        res.status(500).json({ error: 'Failed to serve file' });
    }
}
