import axios from 'axios';
import admin from 'firebase-admin';
import { probe } from '../ffmpeg-runner.js';
import { CLIP_LENGTHS, findClips } from './find-clips.js';
import { capLength, PLATFORMS } from './platforms.js';
import { CAPTION_STYLES, LAYOUTS, RATIOS, renderClip } from './render-clip.js';
import { normalizeWords } from './transcript.js';
import { loadClipBrand } from './brand.js';

/**
 * Long video → ranked short clips, in the spirit of OpusClip:
 * transcribe → score visual/speech signals → pick standalone moments from the
 * transcript → render each clip reframed with captions.
 */

export { CAPTION_STYLES, CLIP_LENGTHS, LAYOUTS, PLATFORMS, RATIOS };

const PYTHON_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';

export function normalizeClipRequest(body = {}) {
    const count = Math.round(Number(body.count) || 5);
    // A platform target (TikTok / Shorts / Reels) fixes the ratio and caps the length.
    const platform = PLATFORMS[body.platform] ? body.platform : null;
    const preset = platform ? PLATFORMS[platform] : null;
    const length = CLIP_LENGTHS[body.length] ? body.length : preset?.length || 'short';
    return {
        sourceUploadId: typeof body.sourceUploadId === 'string' ? body.sourceUploadId : '',
        sourceName: typeof body.sourceName === 'string' ? body.sourceName.slice(0, 120) : 'Video',
        count: Math.min(10, Math.max(1, count)),
        platform,
        length: capLength(platform, length),
        ratio: preset ? preset.ratio : RATIOS[body.ratio] ? body.ratio : '9:16',
        layout: LAYOUTS[body.layout] ? body.layout : 'auto',
        captionStyle: CAPTION_STYLES[body.captionStyle] ? body.captionStyle : 'bold',
        hookTitle: body.hookTitle !== false,
        progressBar: body.progressBar === true,
        // Brand kit (Marketing > Brand): logo on the clip, captions and bar in the brand colour.
        brand: body.brand === true,
        prompt: typeof body.prompt === 'string' ? body.prompt.replace(/\s+/g, ' ').trim().slice(0, 300) : '',
    };
}

function pythonError(error, step) {
    if (error.code === 'ECONNREFUSED') return new Error(`${step} needs the Kengan video service, which is not running.`);
    const detail = error.response?.data?.detail;
    return new Error(detail?.message || detail || error.response?.data?.error || error.message);
}

/**
 * Runs the whole pipeline, reporting through hooks so the route owns persistence.
 * @param {object} request          normalizeClipRequest output
 * @param {object} ctx              { sourcePath, uid, workspaceId, plan, jobId, db }
 * @param {object} hooks            { onStage(stage, progress, extra), onClip(clip) }
 */
export async function createClips(request, ctx, { onStage = () => {}, onClip = () => {} } = {}) {
    const { sourcePath, uid, workspaceId, plan, jobId, db } = ctx;
    const info = await probe(sourcePath);
    if (!info.hasVideo) throw new Error('This file has no video track.');
    const duration = info.duration;
    const { min } = CLIP_LENGTHS[request.length];
    if (duration < Math.min(min, 10)) throw new Error('This video is too short to cut into clips.');
    onStage('Transcribing', 5, { duration });

    // The Python service reads and writes progress on a render_jobs document.
    const analysisJob = db.collection('render_jobs').doc(jobId);
    await analysisJob.set({
        jobId,
        workspaceId,
        userId: uid,
        type: 'clips',
        status: 'transcribing',
        progress: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    let transcription = { words: [] };
    try {
        const { data } = await axios.post(`${PYTHON_URL}/process/transcribe`, { videoUrl: sourcePath, jobId, workspaceId, plan, analysisPreferences: {} }, { timeout: 60 * 60 * 1000 });
        transcription = data || { words: [] };
        await analysisJob.update({ transcription, status: 'analyzing' });
    } catch (error) {
        // Starter plans and silent videos still get clips from visual signals.
        console.warn('[Clips] Transcription unavailable:', pythonError(error, 'Transcription').message);
    }
    const words = normalizeWords(transcription.words);
    onStage('Finding the best moments', 30, { words: words.length });

    let signalClips = [];
    try {
        const { max } = CLIP_LENGTHS[request.length];
        const { data } = await axios.post(
            `${PYTHON_URL}/process/analyze-viral`,
            {
                videoUrl: sourcePath,
                jobId,
                workspaceId,
                plan,
                analysisPreferences: { mode: 'viral', keepCount: request.count * 2, minClipLength: Math.min(min, 20), maxClipLength: Math.min(max, 45) },
            },
            { timeout: 60 * 60 * 1000 }
        );
        signalClips = data?.clips || [];
    } catch (error) {
        console.warn('[Clips] Signal analysis unavailable:', pythonError(error, 'Analysis').message);
    }

    const { clips, finder, note } = await findClips({ words, duration, signalClips, count: request.count, length: request.length, prompt: request.prompt });
    if (!clips.length) throw new Error(note || 'No clips could be found in this video.');
    onStage(`Rendering clip 1 of ${clips.length}`, 40, { finder, note, planned: clips.length });

    let brand = null;
    if (request.brand) {
        brand = await loadClipBrand(db, workspaceId).catch((error) => {
            console.warn('[Clips] Brand kit unavailable:', error.message);
            return null;
        });
    }

    const rendered = [];
    for (const [i, clip] of clips.entries()) {
        const base = 40 + (i / clips.length) * 58;
        onStage(`Rendering clip ${i + 1} of ${clips.length}`, Math.round(base));
        try {
            const result = await renderClip({
                sourcePath,
                clip,
                words,
                ratio: request.ratio,
                layout: request.layout,
                captionStyle: words.length ? request.captionStyle : 'none',
                hookTitle: request.hookTitle,
                progressBar: request.progressBar,
                platform: request.platform,
                brand,
                onProgress: (p) => onStage(`Rendering clip ${i + 1} of ${clips.length}`, Math.round(base + (p / 100) * (58 / clips.length))),
            });
            const done = { ...clip, ...result, duration: Math.round((clip.end - clip.start) * 10) / 10 };
            rendered.push(done);
            await onClip(done);
        } catch (error) {
            console.error(`[Clips] Clip ${i + 1} failed:`, error.message);
            await onClip({ ...clip, error: error.message });
        }
    }
    if (!rendered.length) throw new Error('None of the clips could be rendered.');
    analysisJob.update({ status: 'ready', progress: 100 }).catch(() => {});
    return { finder, note, duration };
}
