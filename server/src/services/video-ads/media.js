import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FFMPEG, FFPROBE } from '../ffmpeg-runner.js';
import { problem } from './validation.js';

const execute = promisify(execFile);
export const ROOT = fileURLToPath(new URL('../../../.cache/video-ads/', import.meta.url));
export function jobDirectory(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw problem(400, 'Invalid ad ID.');
    return path.join(ROOT, id);
}
export async function saveJson(dir, name, value) {
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, name);
    await fs.writeFile(`${file}.tmp`, JSON.stringify(value));
    await fs.rename(`${file}.tmp`, file);
}
export async function readJson(dir, name) { return JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')); }
export async function exists(file) { return fs.access(file).then(() => true, () => false); }
export async function probe(file) {
    const { stdout } = await execute(FFPROBE, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { timeout: 30000, windowsHide: true });
    return JSON.parse(stdout);
}
export async function prepareMusic(input, output, seconds) {
    await execute(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-stream_loop', '-1', '-i', input, '-t', String(seconds), '-af', `loudnorm=I=-24:TP=-2:LRA=7,afade=t=in:d=0.3,afade=t=out:st=${seconds - 1}:d=1`, '-c:a', 'libmp3lame', output], { timeout: 60000, windowsHide: true });
}
export async function finalizeExport(input, output, seconds) {
    // B-frame reordering and AAC padding can extend the MP4 container. Finalize a
    // constant-frame-rate timeline without B-frames and trim audio at the same boundary.
    await execute(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-t', String(seconds), '-map', '0:v:0', '-map', '0:a:0', '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-bf', '0', '-af', `apad,atrim=duration=${seconds}`, '-c:a', 'aac', '-movflags', '+faststart', output], { timeout: 180000, windowsHide: true });
    return verifyExport(output, seconds);
}
export async function verifyExport(file, target) {
    const data = await probe(file);
    const duration = Number(data.format?.duration);
    if (!Number.isFinite(duration) || duration > 25.001 || duration > target + 0.001 || duration < target - 0.1 || !data.streams.some(s => s.codec_type === 'video') || !data.streams.some(s => s.codec_type === 'audio')) {
        throw problem(500, `The export did not pass the duration and audio checks (${Number.isFinite(duration) ? duration : 'unknown'} seconds).`);
    }
    return duration;
}
