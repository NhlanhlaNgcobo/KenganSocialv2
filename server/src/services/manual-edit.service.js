import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

const RENDER_DIR = path.join(os.tmpdir(), 'kengan-renders');
if (!fs.existsSync(RENDER_DIR)) fs.mkdirSync(RENDER_DIR, { recursive: true });

// -------------------------------------------------------
// Upload Storage — keeps source files accessible by uploadId
// -------------------------------------------------------
const uploadStore = new Map(); // uploadId -> filePath

export function storeUpload(uploadId, filePath) {
    uploadStore.set(uploadId, filePath);
}

export function getUploadPath(uploadId) {
    return uploadStore.get(uploadId) || null;
}

// -------------------------------------------------------
// 1. TRIM & CUT
// -------------------------------------------------------

/**
 * Trim video between start and end timestamps (seconds).
 * @param {string} inputPath
 * @param {number} start - Start time in seconds
 * @param {number} end - End time in seconds
 * @returns {Promise<string>} Output file path
 */
export function trimClip(inputPath, start, end) {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(RENDER_DIR, `trim_${uuidv4()}.mp4`);
        const duration = end - start;

        ffmpeg(inputPath)
            .seekInput(start)
            .duration(duration)
            .outputOptions([
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '23',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-movflags', '+faststart',
            ])
            .on('start', (cmd) => console.log('[ManualEdit] Trim:', cmd))
            .on('end', () => {
                console.log(`[ManualEdit] Trimmed: ${outputPath}`);
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error('[ManualEdit] Trim error:', err.message);
                reject(err);
            })
            .save(outputPath);
    });
}

// -------------------------------------------------------
// 2. SPLIT
// -------------------------------------------------------

/**
 * Split a video at a given timestamp into two clips.
 * @param {string} inputPath
 * @param {number} timestamp - Split point in seconds
 * @returns {Promise<{part1: string, part2: string}>}
 */
export async function splitClip(inputPath, timestamp) {
    const info = await getMediaDuration(inputPath);
    const part1 = await trimClip(inputPath, 0, timestamp);
    const part2 = await trimClip(inputPath, timestamp, info.duration);
    return { part1, part2 };
}

// -------------------------------------------------------
// 3. SPEED CHANGE
// -------------------------------------------------------

/**
 * Change playback speed.
 * @param {string} inputPath
 * @param {number} speed - Speed multiplier (0.25 to 3.0)
 * @returns {Promise<string>}
 */
export function changeSpeed(inputPath, speed) {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(RENDER_DIR, `speed_${uuidv4()}.mp4`);

        // Video: setpts adjusts frame timestamps
        const videoPts = `setpts=${(1 / speed).toFixed(4)}*PTS`;

        // Audio: atempo only supports 0.5–2.0, so chain for extreme values
        const audioFilters = buildAtempoChain(speed);

        const cmd = ffmpeg(inputPath);

        if (audioFilters.length > 0) {
            cmd.complexFilter([
                { filter: 'setpts', options: `${(1 / speed).toFixed(4)}*PTS`, inputs: '0:v', outputs: 'v' },
                ...audioFilters.map((f, i) => ({
                    filter: 'atempo',
                    options: f.toString(),
                    inputs: i === 0 ? '0:a' : `a${i}`,
                    outputs: i === audioFilters.length - 1 ? 'a' : `a${i + 1}`
                }))
            ], ['v', 'a']);
        } else {
            cmd.videoFilter(videoPts);
        }

        cmd.outputOptions([
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
        ])
            .on('start', (cmdLine) => console.log('[ManualEdit] Speed:', cmdLine))
            .on('end', () => {
                console.log(`[ManualEdit] Speed changed: ${outputPath}`);
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error('[ManualEdit] Speed error:', err.message);
                reject(err);
            })
            .save(outputPath);
    });
}

/**
 * Build atempo filter chain for speeds outside 0.5–2.0 range.
 * atempo only accepts 0.5–2.0, so we chain multiple instances.
 */
function buildAtempoChain(speed) {
    const filters = [];
    let remaining = speed;

    if (remaining < 0.5) {
        while (remaining < 0.5) {
            filters.push(0.5);
            remaining /= 0.5;
        }
        filters.push(remaining);
    } else if (remaining > 2.0) {
        while (remaining > 2.0) {
            filters.push(2.0);
            remaining /= 2.0;
        }
        filters.push(remaining);
    } else {
        filters.push(remaining);
    }

    return filters;
}

// -------------------------------------------------------
// 4. VOLUME ADJUSTMENT
// -------------------------------------------------------

/**
 * Adjust clip volume.
 * @param {string} inputPath
 * @param {number} volume - 0.0 to 1.0
 * @returns {Promise<string>}
 */
export function adjustVolume(inputPath, volume) {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(RENDER_DIR, `vol_${uuidv4()}.mp4`);

        ffmpeg(inputPath)
            .audioFilter(`volume=${volume}`)
            .outputOptions([
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-movflags', '+faststart',
            ])
            .on('start', (cmd) => console.log('[ManualEdit] Volume:', cmd))
            .on('end', () => {
                console.log(`[ManualEdit] Volume adjusted: ${outputPath}`);
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error('[ManualEdit] Volume error:', err.message);
                reject(err);
            })
            .save(outputPath);
    });
}

// -------------------------------------------------------
// 5. COLOUR FILTERS
// -------------------------------------------------------

const FILTER_PRESETS = {
    vivid: 'eq=saturation=1.5:contrast=1.1:brightness=0.05',
    fade: 'eq=saturation=0.6:brightness=0.1:contrast=0.9',
    noir: 'hue=s=0,eq=contrast=1.3:brightness=-0.05',
    warm: 'colorbalance=rs=0.15:gs=0.05:bs=-0.1:rm=0.1:gm=0.0:bm=-0.1',
    cool: 'colorbalance=rs=-0.1:gs=0.0:bs=0.15:rm=-0.05:gm=0.05:bm=0.1',
    drama: 'eq=contrast=1.4:brightness=-0.08:saturation=1.2,unsharp=5:5:1.0',
    neon: 'eq=saturation=2.0:contrast=1.3:brightness=0.1,hue=h=10',
};

/**
 * Apply a colour filter to the video.
 * @param {string} inputPath
 * @param {string} filterName - vivid|fade|noir|warm|cool|drama|neon
 * @returns {Promise<string>}
 */
export function applyFilter(inputPath, filterName) {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(RENDER_DIR, `filter_${uuidv4()}.mp4`);
        const filterChain = FILTER_PRESETS[filterName.toLowerCase()];

        if (!filterChain) {
            return reject(new Error(`Unknown filter: ${filterName}. Available: ${Object.keys(FILTER_PRESETS).join(', ')}`));
        }

        ffmpeg(inputPath)
            .videoFilter(filterChain)
            .outputOptions([
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '23',
                '-c:a', 'copy',
                '-movflags', '+faststart',
            ])
            .on('start', (cmd) => console.log('[ManualEdit] Filter:', cmd))
            .on('end', () => {
                console.log(`[ManualEdit] Filter applied (${filterName}): ${outputPath}`);
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error('[ManualEdit] Filter error:', err.message);
                reject(err);
            })
            .save(outputPath);
    });
}

// -------------------------------------------------------
// 6. TEXT OVERLAYS
// -------------------------------------------------------

/**
 * Add text overlays to a video.
 * @param {string} inputPath
 * @param {Array<{text: string, x: number, y: number, size: number, color: string, start: number, end: number}>} overlays
 * @returns {Promise<string>}
 */
export function addTextOverlay(inputPath, overlays) {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(RENDER_DIR, `text_${uuidv4()}.mp4`);

        // Build drawtext filter chain — one per overlay
        const drawFilters = overlays.map((ov) => {
            const color = ov.color || '#ffffff';
            const fontSize = ov.size || 32;
            const x = ov.x || 50;
            const y = ov.y || 80;
            const startTime = ov.start || 0;
            const endTime = ov.end || 9999;

            // FFmpeg drawtext filter
            const escapedText = ov.text.replace(/'/g, "'\\''").replace(/:/g, '\\:');
            return `drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=${color}:x=${x}:y=${y}:enable='between(t,${startTime},${endTime})'`;
        });

        ffmpeg(inputPath)
            .videoFilter(drawFilters)
            .outputOptions([
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '23',
                '-c:a', 'copy',
                '-movflags', '+faststart',
            ])
            .on('start', (cmd) => console.log('[ManualEdit] Text overlay:', cmd))
            .on('end', () => {
                console.log(`[ManualEdit] Text overlays added: ${outputPath}`);
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error('[ManualEdit] Text overlay error:', err.message);
                reject(err);
            })
            .save(outputPath);
    });
}

// -------------------------------------------------------
// 7. TRANSITIONS
// -------------------------------------------------------

/**
 * Apply a transition between two clips.
 * @param {string} clipAPath
 * @param {string} clipBPath
 * @param {string} type - fade|slide|zoom
 * @param {number} [durationSec=1] - Transition duration in seconds
 * @returns {Promise<string>}
 */
export function applyTransition(clipAPath, clipBPath, type = 'fade', durationSec = 1) {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(RENDER_DIR, `transition_${uuidv4()}.mp4`);

        const transitionMap = {
            fade: 'fade',
            slide: 'slideleft',
            zoom: 'smoothup',
        };

        const xfadeType = transitionMap[type] || 'fade';

        // Get duration of clip A to know offset for xfade
        ffmpeg.ffprobe(clipAPath, (err, metadata) => {
            if (err) return reject(err);

            const clipADuration = metadata.format.duration;
            const offset = Math.max(0, clipADuration - durationSec);

            ffmpeg(clipAPath)
                .input(clipBPath)
                .complexFilter([
                    `[0:v][1:v]xfade=transition=${xfadeType}:duration=${durationSec}:offset=${offset}[vout]`,
                    `[0:a][1:a]acrossfade=d=${durationSec}[aout]`
                ], ['vout', 'aout'])
                .outputOptions([
                    '-c:v', 'libx264',
                    '-preset', 'fast',
                    '-crf', '23',
                    '-c:a', 'aac',
                    '-b:a', '128k',
                    '-movflags', '+faststart',
                ])
                .on('start', (cmd) => console.log('[ManualEdit] Transition:', cmd))
                .on('end', () => {
                    console.log(`[ManualEdit] Transition applied (${type}): ${outputPath}`);
                    resolve(outputPath);
                })
                .on('error', (err) => {
                    console.error('[ManualEdit] Transition error:', err.message);
                    reject(err);
                })
                .save(outputPath);
        });
    });
}

// -------------------------------------------------------
// 8. MERGE / CONCATENATE
// -------------------------------------------------------

/**
 * Concatenate multiple clips into one output video.
 * All clips must have the same resolution and codec.
 * @param {string[]} clipPaths - Array of file paths
 * @returns {Promise<string>}
 */
export function mergeClips(clipPaths) {
    return new Promise((resolve, reject) => {
        if (!clipPaths || clipPaths.length === 0) {
            return reject(new Error('No clips to merge'));
        }

        if (clipPaths.length === 1) {
            return resolve(clipPaths[0]);
        }

        const outputPath = path.join(RENDER_DIR, `merged_${uuidv4()}.mp4`);

        // Create a concat list file
        const listPath = path.join(RENDER_DIR, `concat_${uuidv4()}.txt`);
        const listContent = clipPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
        fs.writeFileSync(listPath, listContent);

        ffmpeg()
            .input(listPath)
            .inputOptions(['-f', 'concat', '-safe', '0'])
            .outputOptions([
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '23',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-movflags', '+faststart',
            ])
            .on('start', (cmd) => console.log('[ManualEdit] Merge:', cmd))
            .on('end', () => {
                console.log(`[ManualEdit] Merged ${clipPaths.length} clips: ${outputPath}`);
                try { fs.unlinkSync(listPath); } catch { }
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error('[ManualEdit] Merge error:', err.message);
                try { fs.unlinkSync(listPath); } catch { }
                reject(err);
            })
            .save(outputPath);
    });
}

// -------------------------------------------------------
// 9. EXPORT PER PLATFORM
// -------------------------------------------------------

const EXPORT_PRESETS = {
    tiktok: { width: 1080, height: 1920, label: 'TikTok / Reels (9:16)' },
    reels: { width: 1080, height: 1920, label: 'Instagram Reels (9:16)' },
    instagram: { width: 1080, height: 1080, label: 'Instagram Feed (1:1)' },
    youtube: { width: 1920, height: 1080, label: 'YouTube (16:9)' },
};

/**
 * Export video optimized for a specific platform.
 * @param {string} inputPath
 * @param {string} format - tiktok|reels|instagram|youtube
 * @returns {Promise<string>}
 */
export function exportForPlatform(inputPath, format) {
    return new Promise((resolve, reject) => {
        const preset = EXPORT_PRESETS[format.toLowerCase()];
        if (!preset) {
            return reject(new Error(`Unknown export format: ${format}. Available: ${Object.keys(EXPORT_PRESETS).join(', ')}`));
        }

        const outputPath = path.join(RENDER_DIR, `export_${format}_${uuidv4()}.mp4`);
        const { width, height } = preset;

        // Scale + pad to exact dimensions, maintaining aspect ratio
        const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;

        ffmpeg(inputPath)
            .videoFilter(scaleFilter)
            .outputOptions([
                '-c:v', 'libx264',
                '-preset', 'slow',
                '-crf', '20',
                '-profile:v', 'high',
                '-level:v', '4.1',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-ar', '48000',
                '-movflags', '+faststart',
                '-pix_fmt', 'yuv420p',
            ])
            .on('start', (cmd) => console.log(`[ManualEdit] Export (${format}):`, cmd))
            .on('end', () => {
                console.log(`[ManualEdit] Exported for ${preset.label}: ${outputPath}`);
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error(`[ManualEdit] Export error (${format}):`, err.message);
                reject(err);
            })
            .save(outputPath);
    });
}

// -------------------------------------------------------
// 10. FULL PIPELINE ORCHESTRATOR
// -------------------------------------------------------

/**
 * Process a full edit config JSON, applying all operations in sequence.
 *
 * @param {object} config - The edit config JSON from the frontend
 * @param {Function} onProgress - Progress callback (0–100)
 * @returns {Promise<string>} Path to the final output video
 */
export async function processEditConfig(config, onProgress = () => { }) {
    const { clips, exportFormat = 'tiktok' } = config;

    if (!clips || clips.length === 0) {
        throw new Error('No clips in edit config');
    }

    const totalSteps = clips.length * 5 + 2; // rough step count
    let currentStep = 0;

    const reportProgress = () => {
        currentStep++;
        const pct = Math.min(Math.round((currentStep / totalSteps) * 100), 95);
        onProgress(pct);
    };

    const processedClips = [];

    for (const clip of clips) {
        // Resolve source path from uploadId
        let clipPath = getUploadPath(clip.source);
        if (!clipPath || !fs.existsSync(clipPath)) {
            throw new Error(`Source not found for upload ID: ${clip.source}`);
        }

        // Step 1: Trim
        if (clip.start !== undefined && clip.end !== undefined) {
            clipPath = await trimClip(clipPath, clip.start, clip.end);
        }
        reportProgress();

        // Step 2: Speed
        if (clip.speed && clip.speed !== 1) {
            clipPath = await changeSpeed(clipPath, clip.speed);
        }
        reportProgress();

        // Step 3: Volume
        if (clip.volume !== undefined && clip.volume !== 1) {
            clipPath = await adjustVolume(clipPath, clip.volume);
        }
        reportProgress();

        // Step 4: Filter
        if (clip.filter) {
            clipPath = await applyFilter(clipPath, clip.filter);
        }
        reportProgress();

        // Step 5: Text Overlays
        if (clip.textOverlays && clip.textOverlays.length > 0) {
            clipPath = await addTextOverlay(clipPath, clip.textOverlays);
        }
        reportProgress();

        processedClips.push({ path: clipPath, transition: clip.transition || null });
    }

    // Step 6: Apply transitions + merge
    let finalPath;
    if (processedClips.length === 1) {
        finalPath = processedClips[0].path;
    } else {
        // Apply transitions between consecutive clips, then the result is the merged output
        let mergedPath = processedClips[0].path;

        for (let i = 1; i < processedClips.length; i++) {
            const transition = processedClips[i].transition;
            if (transition && transition !== 'none') {
                mergedPath = await applyTransition(mergedPath, processedClips[i].path, transition);
            } else {
                mergedPath = await mergeClips([mergedPath, processedClips[i].path]);
            }
        }

        finalPath = mergedPath;
    }
    reportProgress();

    // Step 7: Export for platform
    finalPath = await exportForPlatform(finalPath, exportFormat);
    reportProgress();

    onProgress(100);
    return finalPath;
}

// -------------------------------------------------------
// UTILITY
// -------------------------------------------------------

function getMediaDuration(inputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) return reject(err);
            resolve({
                duration: parseFloat(metadata.format.duration),
                width: metadata.streams.find(s => s.codec_type === 'video')?.width,
                height: metadata.streams.find(s => s.codec_type === 'video')?.height,
            });
        });
    });
}
