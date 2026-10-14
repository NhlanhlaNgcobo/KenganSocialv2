import { spawn } from 'child_process';
import path from 'path';

export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

/**
 * Runs an FFmpeg/FFprobe process without a shell. When `duration` and `onProgress`
 * are given and the args include `-progress pipe:1`, reports completion as 0..1.
 */
export function run(bin, args, { cwd, duration, onProgress } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { cwd, windowsHide: true });
        let stderr = '';
        let stdout = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
            if (onProgress && duration) {
                const matches = [...String(chunk).matchAll(/out_time_ms=(\d+)/g)];
                const last = matches[matches.length - 1];
                if (last) onProgress(Math.min(1, Number(last[1]) / 1e6 / duration));
            }
            if (stdout.length > 1e6) stdout = stdout.slice(-1e5);
        });
        child.stderr.on('data', (chunk) => {
            stderr = (stderr + chunk).slice(-8000);
        });
        child.on('error', (err) => reject(new Error(`${path.basename(bin)} could not start: ${err.message}`)));
        child.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(`${path.basename(bin)} failed (${code}): ${stderr.split('\n').slice(-6).join(' ').trim()}`));
        });
    });
}

export async function probe(filePath) {
    const out = await run(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath]);
    const data = JSON.parse(out);
    const streams = data.streams || [];
    const video = streams.find((s) => s.codec_type === 'video');
    return {
        hasVideo: !!video,
        hasAudio: streams.some((s) => s.codec_type === 'audio'),
        width: video?.width ?? 0,
        height: video?.height ?? 0,
        duration: Number(data.format?.duration) || 0,
    };
}
