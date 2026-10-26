import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { FFMPEG, probe, run } from './ffmpeg-runner.js';
import { applyCleanup, hasCleanup, normalizeCleanup } from './clip-cleanup.js';

/**
 * Clip enhancement: stabilization and auto-framing, producing a new video file.
 *
 * Stabilization uses the L1 optimal camera-path method in the Python video service
 * (python-service/stabilizer.py). If that service is unreachable it falls back to FFmpeg's
 * two-pass vidstab method from https://github.com/Bmoradi93/video-stabilizer (MIT).
 *
 * Auto-framing asks the Python video service for a layout and applies it with FFmpeg:
 *  - track: a subject-following crop path, applied frame by frame with sendcmd + crop
 *  - split: two speakers (podcasts, split-screen) cropped separately and stacked top/bottom
 *  - fit:   the whole frame centred over a blurred, zoomed copy of itself
 */

const RENDER_DIR = path.join(os.tmpdir(), 'kengan-renders');
if (!fs.existsSync(RENDER_DIR)) fs.mkdirSync(RENDER_DIR, { recursive: true });

const PYTHON_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';
export const AUTOFRAME_RATIOS = ['9:16', '4:5', '1:1', '16:9'];
export const AUTOFRAME_LAYOUTS = ['auto', 'track', 'split', 'fit'];

const ENCODE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];

export const STABILIZE_DEFAULTS = {
    mode: 'smooth',
    strength: 60,
    zoomMode: 'auto',
    zoom: 1.1,
    edgeFill: 'zoom',
    correctRotation: true,
};

export function normalizeStabilizeOptions(raw = {}) {
    const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
    return {
        mode: ['smooth', 'tripod'].includes(raw.mode) ? raw.mode : STABILIZE_DEFAULTS.mode,
        strength: num(raw.strength, STABILIZE_DEFAULTS.strength, 0, 100),
        zoomMode: ['auto', 'manual'].includes(raw.zoomMode) ? raw.zoomMode : STABILIZE_DEFAULTS.zoomMode,
        zoom: num(raw.zoom, STABILIZE_DEFAULTS.zoom, 1, 1.5),
        edgeFill: ['zoom', 'blur', 'black'].includes(raw.edgeFill) ? raw.edgeFill : STABILIZE_DEFAULTS.edgeFill,
        correctRotation: raw.correctRotation !== false,
    };
}

/**
 * L1 optimal camera-path stabilization in the Python video service (see python-service/stabilizer.py).
 * Falls back to FFmpeg vidstab only when that service is unreachable.
 */
async function stabilizeL1(inputPath, workDir, options, progressJob) {
    const outputPath = path.resolve(workDir, 'stabilized.mp4');
    try {
        const { data } = await axios.post(
            `${PYTHON_URL}/process/stabilize`,
            { inputPath: path.resolve(inputPath), outputPath, ...options, ...progressJob },
            { timeout: 60 * 60 * 1000 }
        );
        return { outputPath, stats: data, engine: 'l1' };
    } catch (error) {
        if (error.code === 'ECONNREFUSED') return null;
        const detail = error.response?.data?.detail;
        throw new Error(detail?.message || error.message);
    }
}

async function stabilize(inputPath, workDir, smoothing, duration, onProgress) {
    // Pass 1: measure camera shake.
    await run(
        FFMPEG,
        ['-hide_banner', '-y', '-i', inputPath, '-vf', 'vidstabdetect=shakiness=6:accuracy=15:result=transforms.trf', '-progress', 'pipe:1', '-nostats', '-f', 'null', '-'],
        { cwd: workDir, duration, onProgress: (f) => onProgress(f * 0.5) }
    );
    // Pass 2: smooth the camera path. optzoom=1 zooms just enough to hide moving borders.
    const out = path.join(workDir, 'stabilized.mp4');
    await run(
        FFMPEG,
        [
            '-hide_banner', '-y', '-i', inputPath,
            '-vf', `vidstabtransform=input=transforms.trf:smoothing=${smoothing}:optzoom=1:zoomspeed=0.25:interpol=bicubic,unsharp=5:5:0.8:3:3:0.4`,
            '-map', '0:v:0', '-map', '0:a:0?',
            ...ENCODE, '-progress', 'pipe:1', '-nostats', 'stabilized.mp4',
        ],
        { cwd: workDir, duration, onProgress: (f) => onProgress(0.5 + f * 0.5) }
    );
    return out;
}

async function planAutoframe(videoPath, ratio, layout = 'auto') {
    try {
        const { data } = await axios.post(
            `${PYTHON_URL}/process/autoframe`,
            { videoPath: path.resolve(videoPath), targetRatio: ratio, layout: AUTOFRAME_LAYOUTS.includes(layout) ? layout : 'auto' },
            { timeout: 15 * 60 * 1000 }
        );
        return data;
    } catch (error) {
        if (error.code === 'ECONNREFUSED') throw new Error('Auto-framing needs the Kengan video service, which is not running.');
        const detail = error.response?.data?.detail;
        throw new Error(detail?.message || error.message);
    }
}

/**
 * Expands sparse keyframes into per-frame crop commands. Positions are linearly
 * interpolated within a shot and jump at cuts.
 */
export function buildCropCommands(keyframes, fps, duration) {
    if (!keyframes.length) return '';
    const lines = [];
    let k = 0;
    let lastX = null;
    let lastY = null;
    const frames = Math.ceil(duration * fps);
    for (let i = 0; i <= frames; i += 1) {
        const t = i / fps;
        while (k < keyframes.length - 1 && keyframes[k + 1].t <= t) k += 1;
        const a = keyframes[k];
        const b = keyframes[k + 1];
        let x = a.x;
        let y = a.y;
        if (b && !b.cut && b.t > a.t) {
            const f = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
            x = a.x + (b.x - a.x) * f;
            y = a.y + (b.y - a.y) * f;
        }
        x = Math.round(x / 2) * 2;
        y = Math.round(y / 2) * 2;
        if (x !== lastX || y !== lastY) {
            lines.push(`${t.toFixed(4)} crop@af x ${x}, crop@af y ${y};`);
            lastX = x;
            lastY = y;
        }
    }
    return lines.join('\n');
}

async function applyCrop(inputPath, workDir, plan, duration, onProgress) {
    const fps = plan.fps || 30;
    fs.writeFileSync(path.join(workDir, 'crop_cmds.txt'), buildCropCommands(plan.keyframes, fps, duration));
    const first = plan.keyframes[0] || { x: 0, y: 0 };
    const out = path.join(workDir, 'autoframed.mp4');
    await run(
        FFMPEG,
        [
            '-hide_banner', '-y', '-i', inputPath,
            '-vf', `sendcmd=f=crop_cmds.txt,crop@af=w=${plan.cropWidth}:h=${plan.cropHeight}:x=${first.x}:y=${first.y}`,
            '-map', '0:v:0', '-map', '0:a:0?',
            ...ENCODE, '-progress', 'pipe:1', '-nostats', 'autoframed.mp4',
        ],
        { cwd: workDir, duration, onProgress }
    );
    return out;
}

/** Output size for a target ratio: 1080 on the short side. */
export function outputSize(ratio) {
    const [w, h] = String(ratio).split(':').map(Number);
    const r = w / h || 9 / 16;
    const even = (n) => Math.round(n / 2) * 2;
    return r <= 1 ? { width: 1080, height: even(1080 / r) } : { width: even(1080 * r), height: 1080 };
}

/** Two speakers: crop each panel, scale to half the output height, stack top/bottom. */
async function applySplit(inputPath, workDir, plan, ratio, duration, onProgress) {
    const { width, height } = outputSize(ratio);
    const half = Math.round(height / 4) * 2;
    const [a, b] = plan.panels;
    const panel = (p, label) => `[0:v]crop=${p.w}:${p.h}:${p.x}:${p.y},scale=${width}:${half}:force_original_aspect_ratio=increase,crop=${width}:${half},setsar=1[${label}]`;
    const out = path.join(workDir, 'split.mp4');
    await run(
        FFMPEG,
        [
            '-hide_banner', '-y', '-i', inputPath,
            '-filter_complex', `${panel(a, 'top')};${panel(b, 'bottom')};[top][bottom]vstack=inputs=2,scale=${width}:${height}[v]`,
            '-map', '[v]', '-map', '0:a:0?',
            ...ENCODE, '-progress', 'pipe:1', '-nostats', 'split.mp4',
        ],
        { cwd: workDir, duration, onProgress }
    );
    return out;
}

/** Whole frame, centred over a blurred, zoomed copy (nothing cropped out). */
async function applyFit(inputPath, workDir, ratio, duration, onProgress) {
    const { width, height } = outputSize(ratio);
    const out = path.join(workDir, 'fit.mp4');
    await run(
        FFMPEG,
        [
            '-hide_banner', '-y', '-i', inputPath,
            '-filter_complex',
            `[0:v]split[bgsrc][fgsrc];[bgsrc]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=28,eq=brightness=-0.06[bg];` +
                `[fgsrc]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`,
            '-map', '[v]', '-map', '0:a:0?',
            ...ENCODE, '-progress', 'pipe:1', '-nostats', 'fit.mp4',
        ],
        { cwd: workDir, duration, onProgress }
    );
    return out;
}

/** AI background removal in the Python video service: people on a flat key colour (background_removal.py). */
async function removeBackgroundAi(inputPath, workDir, progressJob) {
    const outputPath = path.resolve(workDir, 'no-background.mp4');
    try {
        const { data } = await axios.post(
            `${PYTHON_URL}/process/remove-background`,
            { inputPath: path.resolve(inputPath), outputPath, ...progressJob },
            { timeout: 60 * 60 * 1000 }
        );
        return { outputPath, stats: data };
    } catch (error) {
        if (error.code === 'ECONNREFUSED') throw new Error('Background removal needs the AI video service, which is offline. Try again shortly.');
        const detail = error.response?.data?.detail;
        throw new Error(detail?.message || error.message);
    }
}

/**
 * @param {object} opts
 * @param {string} opts.inputPath
 * @param {object | null} opts.stabilize  options accepted by normalizeStabilizeOptions
 * @param {{ ratio: string, layout?: string } | null} opts.autoframe  layout: auto | track | split | fit
 * @param {boolean} [opts.removeBackground]  AI background removal, last (the matte follows the final framing)
 * @param {(pct: number) => void} [opts.onProgress]
 * @param {string} [opts.jobId]  manual_edit_jobs id the Python service may write progress to
 */
export async function enhanceVideo({ inputPath, stabilize: stab, autoframe, cleanup: rawCleanup = null, removeBackground = false, onProgress = () => {}, jobId = null }) {
    const info = await probe(inputPath);
    const cleanup = rawCleanup ? normalizeCleanup(rawCleanup) : null;
    const wantsCleanup = cleanup && hasCleanup(cleanup);
    if (!info.hasVideo && (stab || autoframe || removeBackground || !wantsCleanup)) throw new Error('This file has no video track to enhance.');
    const duration = info.duration || 1;
    const workDir = fs.mkdtempSync(path.join(RENDER_DIR, 'enhance-'));

    // Progress budget: stabilization 0–60 (or 0–100 alone), auto-frame the rest. Background removal,
    // when combined, takes the last 60% and the other steps share the first 40%.
    const bgShare = removeBackground ? (stab || autoframe || wantsCleanup ? 0.6 : 1) : 0;
    const stabShare = stab ? (autoframe ? 0.6 : 1) : 0;
    const report = (f) => onProgress(Math.min(99, Math.round(f * (1 - bgShare) * 100)));
    const summary = { stabilized: false, autoframe: null, cleanup: null, backgroundRemoved: null };

    try {
        let current = inputPath;
        // Clean-up first: denoising before stabilisation gives the motion analysis cleaner frames.
        if (wantsCleanup) {
            const cleanShare = stab || autoframe ? 0.25 : 1;
            const cleaned = path.join(workDir, info.hasVideo ? 'cleaned.mp4' : 'cleaned.m4a');
            const done = await applyCleanup(current, cleaned, cleanup, info, (f) => report(f * cleanShare));
            current = cleaned;
            summary.cleanup = { ...done, options: cleanup };
        }
        if (stab) {
            const options = normalizeStabilizeOptions(stab);
            const progressJob = jobId ? { progressJobId: jobId, progressFrom: 0, progressTo: Math.round(stabShare * 99) } : {};
            const l1 = await stabilizeL1(current, workDir, options, progressJob);
            if (l1) {
                current = l1.outputPath;
                summary.stabilized = true;
                summary.stabilizer = { engine: 'l1', ...options, zoomApplied: l1.stats.zoom, shots: l1.stats.shots };
            } else {
                // Python service down: FFmpeg vidstab keeps the feature usable, with fewer options.
                const smoothing = Math.round(5 + options.strength * 0.55);
                current = await stabilize(current, workDir, smoothing, duration, (f) => report(f * stabShare));
                summary.stabilized = true;
                summary.stabilizer = { engine: 'vidstab-fallback', strength: options.strength };
            }
            report(stabShare);
        }

        if (autoframe) {
            report(stabShare + 0.05 * (1 - stabShare));
            const plan = await planAutoframe(current, autoframe.ratio, autoframe.layout);
            if (plan.noop) {
                summary.autoframe = { applied: false, layout: 'none', reason: plan.reason };
            } else {
                report(stabShare + 0.3 * (1 - stabShare));
                const step = (f) => report(stabShare + (0.3 + f * 0.7) * (1 - stabShare));
                if (plan.layout === 'split' && plan.panels?.length === 2) current = await applySplit(current, workDir, plan, autoframe.ratio, duration, step);
                else if (plan.layout === 'fit') current = await applyFit(current, workDir, autoframe.ratio, duration, step);
                else current = await applyCrop(current, workDir, plan, duration, step);
                const size = plan.layout === 'split' || plan.layout === 'fit' ? outputSize(autoframe.ratio) : { width: plan.cropWidth, height: plan.cropHeight };
                summary.autoframe = {
                    applied: true,
                    layout: plan.layout || 'track',
                    ratio: autoframe.ratio,
                    width: size.width,
                    height: size.height,
                    shots: plan.shots,
                    faceCoverage: plan.faceCoverage,
                    twoSpeakerShare: plan.twoSpeakerShare,
                };
            }
        }

        if (removeBackground) {
            const from = Math.round((1 - bgShare) * 99);
            const progressJob = jobId ? { progressJobId: jobId, progressFrom: from, progressTo: 99 } : {};
            const removed = await removeBackgroundAi(current, workDir, progressJob);
            current = removed.outputPath;
            summary.backgroundRemoved = { keyColor: removed.stats.keyColor, personShare: removed.stats.personShare };
        }

        if (current === inputPath) throw new Error(summary.autoframe?.reason || 'Nothing to change for this clip.');

        const outputPath = path.join(RENDER_DIR, `enhanced_${uuidv4()}${path.extname(current) || '.mp4'}`);
        fs.renameSync(current, outputPath);
        onProgress(100);
        return { outputPath, summary };
    } finally {
        fs.rm(workDir, { recursive: true, force: true }, () => {});
    }
}
