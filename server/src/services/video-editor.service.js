import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

const RENDER_DIR = path.join(os.tmpdir(), 'kengan-renders');
if (!fs.existsSync(RENDER_DIR)) fs.mkdirSync(RENDER_DIR, { recursive: true });

/**
 * @fileoverview
 * FFmpeg Video Editor
 * 
 * Uses FFmpeg to perform real video editing:
 * - Crop landscape to vertical (9:16) 
 * - Burn in subtitles (ASS format with styling)
 * - Auto-cut clips from key moments
 * - Trim videos to specific time ranges
 */

/**
 * Crop a video to vertical 9:16 format.
 * Centers the crop on the middle of the frame.
 * 
 * @param {string} inputPath - Path to input video
 * @param {object} [options]
 * @param {number} [options.startMs] - Trim start in ms
 * @param {number} [options.endMs] - Trim end in ms
 * @returns {Promise<string>} Path to output video
 */
export function cropToVertical(inputPath, options = {}) {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(RENDER_DIR, `vertical_${uuidv4()}.mp4`);
        const { startMs, endMs } = options;

        let cmd = ffmpeg(inputPath)
            .videoFilter('crop=ih*9/16:ih')  // Crop to 9:16 centered
            .size('1080x1920')
            .autopad()
            .outputOptions([
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '23',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-movflags', '+faststart',
            ]);

        if (startMs !== undefined) {
            cmd = cmd.seekInput(startMs / 1000);
        }
        if (endMs !== undefined && startMs !== undefined) {
            cmd = cmd.duration((endMs - startMs) / 1000);
        }

        cmd
            .on('start', (cmdLine) => console.log('[FFmpeg] Command:', cmdLine))
            .on('progress', (p) => {
                if (p.percent) console.log(`[FFmpeg] Progress: ${Math.round(p.percent)}%`);
            })
            .on('end', () => {
                console.log(`[FFmpeg] Vertical crop complete: ${outputPath}`);
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error('[FFmpeg] Crop error:', err.message);
                reject(err);
            })
            .save(outputPath);
    });
}

/**
 * Burn subtitles into a video using ASS format for styling.
 * 
 * @param {string} inputPath - Path to input video
 * @param {Array<{text: string, startMs: number, endMs: number}>} subtitles
 * @param {object} style - Caption style options
 * @returns {Promise<string>} Path to output video
 */
export function burnSubtitles(inputPath, subtitles, style = {}, offsetMs = 0) {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(RENDER_DIR, `captioned_${uuidv4()}.mp4`);

        // Generate ASS subtitle file
        const assPath = path.join(RENDER_DIR, `subs_${uuidv4()}.ass`);
        const assContent = generateASS(subtitles, style, offsetMs);
        fs.writeFileSync(assPath, assContent);

        // Escape path for FFmpeg filter (Windows paths need escaping)
        const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

        ffmpeg(inputPath)
            .videoFilter(`ass='${escapedAssPath}'`)
            .outputOptions([
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '23',
                '-c:a', 'copy',
                '-movflags', '+faststart',
            ])
            .on('start', (cmdLine) => console.log('[FFmpeg] Subtitle burn cmd:', cmdLine))
            .on('end', () => {
                console.log(`[FFmpeg] Subtitles burned: ${outputPath}`);
                // Clean up temp ASS file
                try { fs.unlinkSync(assPath); } catch { }
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error('[FFmpeg] Subtitle burn error:', err.message);
                try { fs.unlinkSync(assPath); } catch { }
                reject(err);
            })
            .save(outputPath);
    });
}

/**
 * Full pipeline: crop to vertical + burn subtitles in one pass.
 * 
 * @param {string} inputPath
 * @param {Array} subtitles
 * @param {object} style
 * @param {object} [options] - startMs, endMs for trimming
 * @returns {Promise<string>}
 */
export function cropAndCaption(inputPath, subtitles, style = {}, options = {}) {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(RENDER_DIR, `final_${uuidv4()}.mp4`);
        const { startMs = 0, endMs, musicPath, musicVolume = 0.2, hasAudio = true } = options;

        // Generate ASS subtitle file
        const assPath = path.join(RENDER_DIR, `subs_${uuidv4()}.ass`);
        const assContent = generateASS(subtitles, style, startMs);
        fs.writeFileSync(assPath, assContent);

        const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

        let cmd = ffmpeg(inputPath);

        const isHigh = options.quality === 'high';
        const targetRes = isHigh ? '1080:1920' : '720:1280';

        // Filters pipeline
        const videoFilters = [
            'crop=\'trunc(ih*9/16/2)*2\':\'trunc(ih/2)*2\'',
            `scale=${targetRes}`,
            `ass='${escapedAssPath}'`
        ];

        if (musicPath && fs.existsSync(musicPath)) {
            cmd = cmd.input(musicPath);
            if (hasAudio) {
                // Mix original audio and music
                cmd = cmd.complexFilter([
                    { filter: 'crop', options: 'trunc(ih*9/16/2)*2:trunc(ih/2)*2', inputs: '0:v', outputs: 'v1' },
                    { filter: 'scale', options: targetRes, inputs: 'v1', outputs: 'v2' },
                    { filter: 'ass', options: escapedAssPath, inputs: 'v2', outputs: 'vfinal' },
                    { filter: 'volume', options: '1', inputs: '0:a', outputs: 'a0' },
                    { filter: 'volume', options: musicVolume.toString(), inputs: '1:a', outputs: 'a1' },
                    { filter: 'amix', options: 'inputs=2:duration=first', inputs: ['a0', 'a1'], outputs: 'afinal' }
                ], ['vfinal', 'afinal']);
            } else {
                // Video has no audio track, so just apply volume to the music track
                cmd = cmd.complexFilter([
                    { filter: 'crop', options: 'trunc(ih*9/16/2)*2:trunc(ih/2)*2', inputs: '0:v', outputs: 'v1' },
                    { filter: 'scale', options: targetRes, inputs: 'v1', outputs: 'v2' },
                    { filter: 'ass', options: escapedAssPath, inputs: 'v2', outputs: 'vfinal' },
                    { filter: 'volume', options: musicVolume.toString(), inputs: '1:a', outputs: 'afinal' }
                ], ['vfinal', 'afinal']);
            }
        } else {
            cmd = cmd.videoFilter(videoFilters);
        }

        const outputOptions = isHigh
            ? [
                '-c:v', 'libx264',
                '-preset', 'slow',
                '-crf', '18',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-movflags', '+faststart',
            ]
            : [
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '24',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-movflags', '+faststart',
            ];

        cmd.outputOptions(outputOptions);

        if (startMs > 0) cmd = cmd.seekInput(startMs / 1000);
        if (endMs !== undefined) cmd = cmd.duration((endMs - startMs) / 1000);

        cmd
            .on('start', (cmdLine) => console.log('[FFmpeg] Full pipeline:', cmdLine))
            .on('progress', (p) => {
                if (p.percent) console.log(`[FFmpeg] Pipeline progress: ${Math.round(p.percent)}%`);
            })
            .on('end', () => {
                console.log(`[FFmpeg] Final render complete: ${outputPath}`);
                try { fs.unlinkSync(assPath); } catch { }
                resolve(outputPath);
            })
            .on('error', (err, stdout, stderr) => {
                console.error('[FFmpeg] Pipeline error:', err.message);
                console.error('[FFmpeg] stderr output:', stderr);
                try { fs.unlinkSync(assPath); } catch { }
                reject(new Error(`ffmpeg exited with error: ${err.message}. Details: ${stderr}`));
            })
            .save(outputPath);
    });
}

/**
 * Get video metadata (duration, resolution, etc.)
 */
export function getVideoInfo(inputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) return reject(err);
            const video = metadata.streams.find(s => s.codec_type === 'video');
            const audio = metadata.streams.find(s => s.codec_type === 'audio');
            resolve({
                duration: metadata.format.duration,
                durationMs: Math.round(metadata.format.duration * 1000),
                width: video?.width,
                height: video?.height,
                fps: video ? eval(video.r_frame_rate) : 30,
                hasAudio: !!audio,
                fileSize: metadata.format.size,
            });
        });
    });
}

// -------------------------------------------------------
// ASS Subtitle Generator
// -------------------------------------------------------

function generateASS(subtitles, style = {}, offsetMs = 0) {
    const fontName = style.fontFamily?.replace(/'/g, '') || 'Inter';
    const fontSize = style.fontSize || 28;
    const fontWeight = (style.fontWeight || 700) >= 700 ? -1 : 0;
    const primaryColor = assColor(style.color || '#FFFFFF');
    const highlightColor = assColor(style.highlightColor || '#8b5cf6');
    const outlineColor = assColor(style.strokeColor || '#000000');
    const outlineWidth = style.strokeWidth || 3;
    const alignment = style.position === 'top' ? 8 : style.position === 'center' ? 5 : 2;

    // Has background box?
    const hasBg = style.bgColor && style.bgColor !== 'transparent';
    const borderStyle = hasBg ? 3 : 1;
    const bgColor = hasBg ? assColor(style.bgColor) : '&H00000000';

    const header = `[Script Info]
Title: KenganSocial Captions
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${primaryColor},${highlightColor},${outlineColor},${bgColor},${fontWeight},0,0,0,100,100,0,0,${borderStyle},${outlineWidth},0,${alignment},40,40,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

    const events = subtitles
        .map((sub) => {
            const startM = (sub.startMs || 0) - offsetMs;
            const endM = (sub.endMs || (sub.startMs || 0) + 3000) - offsetMs;

            // Only include if at least partially visible within the trimmed range
            // (FFmpeg seekInput starts output file at 0:00:00)
            if (endM < 0) return null;

            const start = msToAssTime(Math.max(0, startM));
            const end = msToAssTime(endM);

            const words = sub.text.split(' ');
            let styledText = sub.text;
            if (words.length > 1) {
                styledText = `{\\c${highlightColor}}${words[0]}{\\c${primaryColor}} ${words.slice(1).join(' ')}`;
            }
            return `Dialogue: 0,${start},${end},Default,,0,0,0,,${styledText}`;
        })
        .filter(Boolean);

    return header + '\n' + events.join('\n') + '\n';
}

function assColor(hex) {
    // Convert CSS hex color to ASS color format: &HAABBGGRR
    if (hex.startsWith('rgba')) {
        // Parse rgba
        const match = hex.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (match) {
            const r = parseInt(match[1]).toString(16).padStart(2, '0');
            const g = parseInt(match[2]).toString(16).padStart(2, '0');
            const b = parseInt(match[3]).toString(16).padStart(2, '0');
            const a = match[4] ? Math.round((1 - parseFloat(match[4])) * 255).toString(16).padStart(2, '0') : '00';
            return `&H${a}${b}${g}${r}`.toUpperCase();
        }
    }
    const clean = hex.replace('#', '');
    const r = clean.substring(0, 2);
    const g = clean.substring(2, 4);
    const b = clean.substring(4, 6);
    return `&H00${b}${g}${r}`.toUpperCase();
}

function msToAssTime(ms) {
    const totalSeconds = ms / 1000;
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    const cs = Math.round((totalSeconds % 1) * 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
