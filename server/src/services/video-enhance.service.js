import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { FFMPEG, probe, run } from './ffmpeg-runner.js';

/**
 * Clip enhancement: stabilization and auto-framing, producing a new video file.
 *
 * Stabilization uses the L1 optimal camera-path method in the Python video service
 * (python-service/stabilizer.py). If that service is unreachable it falls back to FFmpeg's
 * two-pass vidstab method from https://github.com/Bmoradi93/video-stabilizer (MIT).
 *
 * Auto-framing asks the Python video service for a subject-following crop path
 * and applies it frame by frame with FFmpeg's sendcmd + crop.
 */

const RENDER_DIR = path.join(os.tmpdir(), 'kengan-renders');
if (!fs.existsSync(RENDER_DIR)) fs.mkdirSync(RENDER_DIR, { recursive: true });

const PYTHON_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';
export const AUTOFRAME_RATIOS = ['9:16', '4:5', '1:1', '16:9'];

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

async function planAutoframe(videoPath, ratio) {
    try {
        const { data } = await axios.post(`${PYTHON_URL}/process/autoframe`, { videoPath: path.resolve(videoPath), targetRatio: ratio }, { timeout: 15 * 60 * 1000 });
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

/**
 * @param {object} opts
 * @param {string} opts.inputPath
 * @param {object | null} opts.stabilize  options accepted by normalizeStabilizeOptions
 * @param {{ ratio: string } | null} opts.autoframe
 * @param {(pct: number) => void} [opts.onProgress]
 * @param {string} [opts.jobId]  manual_edit_jobs id the Python service may write progress to
 */
export async function enhanceVideo({ inputPath, stabilize: stab, autoframe, onProgress = () => {}, jobId = null }) {
    const info = await probe(inputPath);
    if (!info.hasVideo) throw new Error('This file has no video track to enhance.');
    const duration = info.duration || 1;
    const workDir = fs.mkdtempSync(path.join(RENDER_DIR, 'enhance-'));

    // Progress budget: stabilization 0–60 (or 0–100 alone), auto-frame the rest.
    const stabShare = stab ? (autoframe ? 0.6 : 1) : 0;
    const report = (f) => onProgress(Math.min(99, Math.round(f * 100)));
    const summary = { stabilized: false, autoframe: null };

    try {
        let current = inputPath;
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
            const plan = await planAutoframe(current, autoframe.ratio);
            if (plan.noop) {
                summary.autoframe = { applied: false, reason: plan.reason };
            } else {
                report(stabShare + 0.3 * (1 - stabShare));
                current = await applyCrop(current, workDir, plan, duration, (f) => report(stabShare + (0.3 + f * 0.7) * (1 - stabShare)));
                summary.autoframe = {
                    applied: true,
                    ratio: autoframe.ratio,
                    width: plan.cropWidth,
                    height: plan.cropHeight,
                    shots: plan.shots,
                    faceCoverage: plan.faceCoverage,
                };
            }
        }

        if (current === inputPath) throw new Error(summary.autoframe?.reason || 'Nothing to change for this clip.');

        const outputPath = path.join(RENDER_DIR, `enhanced_${uuidv4()}.mp4`);
        fs.renameSync(current, outputPath);
        onProgress(100);
        return { outputPath, summary };
    } finally {
        fs.rm(workDir, { recursive: true, force: true }, () => {});
    }
}
