import { recentTrendContext } from './trend-context.js';
import axios from 'axios';
import { FieldValue } from 'firebase-admin/firestore';
import { probe } from '../ffmpeg-runner.js';
import { CLIP_LENGTHS } from './find-clips.js';
import { selectClipMoments } from './select-clips.js';
import { capLength, PLATFORMS } from './platforms.js';
import { CAPTION_STYLES, LAYOUTS, RATIOS, renderClip } from './render-clip.js';
import { normalizeWords } from './transcript.js';
import { cloudTranscribe, useCloudTranscription } from './cloud-transcribe.js';
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
    // The video service requires a workspace id; free starter clips (no account) have none.
    const pyWorkspace = workspaceId || 'free-clip';

    // The Python service reads and writes progress on a render_jobs document.
    const analysisJob = db.collection('render_jobs').doc(jobId);
    await analysisJob.set({
        jobId,
        workspaceId,
        userId: uid,
        type: 'clips',
        status: 'transcribing',
        progress: 0,
        createdAt: FieldValue.serverTimestamp(),
    });

    let transcription = { words: [] };
    // Long videos: Whisper through OpenRouter (minutes, with progress). Short ones, or if the cloud
    // fails: Whisper on this server's CPU in the video service.
    if (plan !== 'starter' && useCloudTranscription(duration)) {
        try {
            transcription = await cloudTranscribe(sourcePath, duration, { onProgress: (f) => onStage('Transcribing', 5 + Math.round(f * 24)) });
            await analysisJob.update({ transcription, status: 'analyzing' });
        } catch (error) {
            console.warn('[Clips] Cloud transcription failed, using the local model:', String(error.message).slice(0, 300));
            transcription = { words: [] };
        }
    }
    if (!transcription.words?.length) {
        const started = Date.now();
        const progressTimer = setInterval(() => {
            const elapsed = Math.round((Date.now() - started) / 1000);
            onStage(`Transcribing locally (${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed)`, 5);
        }, 10000);
        progressTimer.unref?.();
        try {
            const { data } = await axios.post(`${PYTHON_URL}/process/transcribe`, { videoUrl: sourcePath, jobId, workspaceId: pyWorkspace, plan, analysisPreferences: {} }, { timeout: 10 * 60 * 1000 });
            transcription = data || { words: [] };
            await analysisJob.update({ transcription, status: 'analyzing' });
        } catch (error) {
            // Starter plans and silent videos still get clips from visual signals.
            console.warn('[Clips] Transcription unavailable:', pythonError(error, 'Transcription').message);
        } finally {
            clearInterval(progressTimer);
        }
    }
    const words = normalizeWords(transcription.words);
    onStage('Finding the best moments', 30, { words: words.length });

    const trendContext = await recentTrendContext(workspaceId);
    const selectionInput = { words, duration, count: request.count, length: request.length, prompt: request.prompt, trendContext };
    // With a substantial transcript, selecting moments does not require decoding every frame
    // of a long source. Each selected short still gets face-aware framing during rendering.
    const { clips, finder, note } = await selectClipMoments(selectionInput, async () => {
        let signalClips = [];
        try {
            const { max } = CLIP_LENGTHS[request.length];
            const { data } = await axios.post(
                `${PYTHON_URL}/process/analyze-viral`,
                {
                    videoUrl: sourcePath,
                    jobId,
                    workspaceId: pyWorkspace,
                    plan,
                    analysisPreferences: { mode: 'viral', keepCount: request.count * 2, minClipLength: Math.min(min, 20), maxClipLength: Math.min(max, 45) },
                },
                { timeout: 60 * 60 * 1000 }
            );
            signalClips = data?.clips || [];
        } catch (error) {
            console.warn('[Clips] Signal analysis unavailable:', pythonError(error, 'Analysis').message);
        }
        return signalClips;
    });
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
    await analysisJob.update({ status: 'ready', progress: 100 });
    return { finder, note, duration };
}
