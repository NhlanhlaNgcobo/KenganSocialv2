import fs from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { FFMPEG, probe, run } from '../ffmpeg-runner.js';
import { storeUpload } from '../manual-edit.service.js';
import { renderTimeline } from '../timeline-render.service.js';
import { enhanceVideo } from '../video-enhance.service.js';

/**
 * Renders one clip: cut from the source → reframe to the target ratio, following
 * faces when possible → burn in word-timed captions and the hook title.
 */

const RENDER_DIR = path.join(os.tmpdir(), 'kengan-renders');

export const RATIOS = {
    '9:16': { exportFormat: 'tiktok', width: 1080, height: 1920 },
    '1:1': { exportFormat: 'instagram', width: 1080, height: 1080 },
    '16:9': { exportFormat: 'youtube', width: 1920, height: 1080 },
};

export const CAPTION_STYLES = {
    bold: { label: 'Bold', size: 0.078, bold: true, upper: true, color: '#ffffff', background: 'rgba(0,0,0,0.55)', words: 3 },
    clean: { label: 'Clean', size: 0.06, bold: false, upper: false, color: '#ffffff', background: 'rgba(0,0,0,0.4)', words: 5 },
    accent: { label: 'Accent', size: 0.072, bold: true, upper: false, color: '#ffffff', background: '#e04a18', words: 3 },
    none: { label: 'No captions' },
};

/** Greedy word wrap for burned-in text (FFmpeg drawtext does not wrap). */
function wrap(textValue, maxChars) {
    const lines = [];
    let line = '';
    for (const word of textValue.split(/\s+/).filter(Boolean)) {
        if (line && (line + ' ' + word).length > maxChars) {
            lines.push(line);
            line = word;
        } else {
            line = line ? `${line} ${word}` : word;
        }
    }
    if (line) lines.push(line);
    return lines.join('\n');
}

/** Short caption phrases timed to the words, relative to the clip start. */
export function captionChunks(words, start, end, maxWords) {
    const inClip = words.filter((w) => w.end > start && w.start < end);
    const chunks = [];
    let current = [];
    const flush = () => {
        if (!current.length) return;
        chunks.push({
            text: current.map((w) => w.text).join(' '),
            start: Math.max(0, current[0].start - start),
            end: Math.min(end, current[current.length - 1].end) - start,
        });
        current = [];
    };
    for (const word of inClip) {
        const prev = current[current.length - 1];
        if (prev && word.start - prev.end > 0.35) flush();
        current.push(word);
        if (current.length >= maxWords || /[.!?,;:]$/.test(word.text)) flush();
    }
    flush();
    // Close small gaps so captions do not flicker, and keep each one readable.
    for (let i = 0; i < chunks.length; i += 1) {
        const next = chunks[i + 1];
        if (next && next.start - chunks[i].end < 0.3) chunks[i].end = next.start;
        if (chunks[i].end - chunks[i].start < 0.25) chunks[i].end = chunks[i].start + 0.25;
    }
    return chunks;
}

function textElements({ words, clip, length, ratio, captionStyle, hookTitle }) {
    const { width: W, height: H } = RATIOS[ratio];
    const unit = Math.min(W, H);
    const elements = [];
    const style = CAPTION_STYLES[captionStyle];

    if (style && captionStyle !== 'none') {
        const fontSize = Math.round(unit * style.size);
        const maxChars = Math.max(10, Math.floor((W * 0.84) / (fontSize * 0.56)));
        for (const chunk of captionChunks(words, clip.start, clip.end, style.words)) {
            const content = style.upper ? chunk.text.toUpperCase() : chunk.text;
            elements.push({
                content: wrap(content, maxChars),
                timelineStart: chunk.start,
                timelineEnd: Math.min(length, chunk.end),
                fontSize,
                bold: style.bold,
                color: style.color,
                backgroundColor: style.background,
                align: 'center',
                x: 0,
                y: Math.round(H * (ratio === '16:9' ? 0.3 : 0.2)),
            });
        }
    }

    if (hookTitle && clip.hook) {
        const fontSize = Math.round(unit * 0.052);
        const maxChars = Math.max(12, Math.floor((W * 0.82) / (fontSize * 0.56)));
        elements.push({
            content: wrap(clip.hook, maxChars),
            timelineStart: 0,
            timelineEnd: Math.min(3, length),
            fontSize,
            bold: true,
            color: '#ffffff',
            backgroundColor: 'rgba(0,0,0,0.62)',
            align: 'center',
            x: 0,
            y: -Math.round(H * (ratio === '16:9' ? 0.34 : 0.31)),
        });
    }
    return elements;
}

/** Zoom that makes a fitted frame cover the canvas (used when face tracking is unavailable). */
function coverScale(srcW, srcH, W, H) {
    if (!srcW || !srcH) return 1;
    const fit = Math.min(W / srcW, H / srcH);
    const cover = Math.max(W / srcW, H / srcH);
    return Math.min(4, cover / fit);
}

async function cut(sourcePath, start, end, outPath) {
    await run(FFMPEG, [
        '-hide_banner', '-y',
        '-ss', start.toFixed(3), '-i', sourcePath, '-t', (end - start).toFixed(3),
        '-map', '0:v:0', '-map', '0:a?',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart', outPath,
    ]);
    return outPath;
}

async function poster(videoPath, at) {
    const out = path.join(RENDER_DIR, `poster_${uuidv4()}.jpg`);
    try {
        await run(FFMPEG, ['-hide_banner', '-y', '-ss', at.toFixed(2), '-i', videoPath, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', out]);
        return `data:image/jpeg;base64,${fs.readFileSync(out).toString('base64')}`;
    } catch {
        return null;
    } finally {
        fs.rm(out, { force: true }, () => {});
    }
}

/**
 * @returns {Promise<{ outputPath: string, poster: string|null, reframe: string }>}
 */
export async function renderClip({ sourcePath, clip, words, ratio, captionStyle, hookTitle, ownerId, onProgress = () => {} }) {
    const spec = RATIOS[ratio] || RATIOS['9:16'];
    const cutPath = path.join(RENDER_DIR, `clipcut_${uuidv4()}.mp4`);
    const temp = [cutPath];
    try {
        await cut(sourcePath, clip.start, clip.end, cutPath);
        onProgress(20);

        const info = await probe(cutPath);
        const length = info.duration || clip.end - clip.start;
        const sourceAspect = info.width && info.height ? info.width / info.height : spec.width / spec.height;
        const targetAspect = spec.width / spec.height;

        let framedPath = cutPath;
        let reframe = 'none';
        let transform = null;
        if (Math.abs(sourceAspect - targetAspect) > 0.02) {
            try {
                const { outputPath, summary } = await enhanceVideo({ inputPath: cutPath, stabilize: null, autoframe: { ratio } });
                framedPath = outputPath;
                temp.push(outputPath);
                reframe = summary.autoframe?.applied ? 'tracked' : 'centre';
            } catch (error) {
                // No faces found or the video service is down: centre crop instead.
                console.warn('[Clips] Auto-frame skipped:', error.message);
            }
            if (framedPath === cutPath) {
                const scale = coverScale(info.width, info.height, spec.width, spec.height);
                transform = { scaleStart: scale, scaleEnd: scale };
                reframe = 'centre';
            }
        }
        onProgress(60);

        const uploadId = `clipsrc_${uuidv4()}`;
        storeUpload(uploadId, framedPath, ownerId);
        const outputPath = await renderTimeline(
            {
                version: 2,
                exportFormat: spec.exportFormat,
                fps: 30,
                backgroundColor: '#000000',
                duration: length,
                main: [{ source: uploadId, kind: 'video', sourceStart: 0, sourceEnd: length, timelineStart: 0, volume: 1, transform }],
                text: textElements({ words, clip, length, ratio, captionStyle, hookTitle }),
            },
            ownerId,
            (p) => onProgress(60 + Math.round(p * 0.38))
        );
        const posterUrl = await poster(outputPath, Math.min(1.2, length / 2));
        onProgress(100);
        return { outputPath, poster: posterUrl, reframe };
    } finally {
        for (const file of temp) fs.rm(file, { force: true }, () => {});
    }
}
