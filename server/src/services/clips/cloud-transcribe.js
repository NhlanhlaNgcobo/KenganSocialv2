import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FFMPEG, run } from '../ffmpeg-runner.js';
import { whisperProviders, whisperTranscribe } from '../speech/whisper-api.js';

/**
 * Cloud transcription for clip projects. A long video on CPU Whisper takes about as long as the
 * video (the medium model, more). Cloud latency depends on the provider and video length.
 * The audio is cut into 5-minute mono MP3 pieces (well under the 25 MB / ~60 s per-call limits),
 * sent three at a time, and the words are stitched back on one timeline.
 *
 * CLIP_TRANSCRIBE=auto (default) uses the cloud for videos of CLOUD_TRANSCRIBE_MIN_MINUTES (10)
 * or longer, =cloud for every video, =local never.
 */
const PIECE_SECONDS = 300;
const CONCURRENCY = 3;

export function useCloudTranscription(durationSeconds) {
    const mode = String(process.env.CLIP_TRANSCRIBE || 'auto').toLowerCase();
    if (mode === 'local' || !whisperProviders().length) return false;
    if (mode === 'cloud') return true;
    const threshold = Number(process.env.CLOUD_TRANSCRIBE_MIN_MINUTES || 10);
    return durationSeconds >= (Number.isFinite(threshold) && threshold > 0 ? threshold : 10) * 60;
}

/**
 * @param {string} sourcePath a video or audio file
 * @param {number} duration seconds
 * @param {{ onProgress?: (fraction: number) => void, language?: string }} opts
 * @returns {Promise<{ words: {text, start, end}[], transcriptionProvider: string, language: string }>}
 *          word times in milliseconds, the shape the clip pipeline and analysis expect
 */
export async function cloudTranscribe(sourcePath, duration, { onProgress = () => {}, language } = {}) {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('A positive source duration is required.');
    const providers = whisperProviders();
    if (!providers.length) throw new Error('No speech-to-text provider is configured.');
    const dir = path.join(os.tmpdir(), `kengan-stt-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const pieces = Array.from({ length: Math.max(1, Math.ceil(duration / PIECE_SECONDS)) }, (_, i) => ({ index: i, start: i * PIECE_SECONDS }));
    const results = new Array(pieces.length);
    let done = 0;
    let failure;
    try {
        const queue = [...pieces];
        const worker = async () => {
            for (let piece = queue.shift(); piece && !failure; piece = queue.shift()) {
              try {
                const file = path.join(dir, `piece-${piece.index}.mp3`);
                await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(piece.start), '-t', String(PIECE_SECONDS), '-i', sourcePath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', file]);
                const buffer = await fs.readFile(file);
                let result;
                for (const via of providers) {
                  for (let attempt = 0; attempt < 2 && !result; attempt++) {
                    try {
                        result = await whisperTranscribe(buffer, { filename: `piece-${piece.index}.mp3`, language, via });
                    } catch (error) {
                        if (attempt === 1 && via === providers.at(-1)) throw error;
                    }
                  }
                  if (result) break;
                }
                results[piece.index] = { start: piece.start, ...result };
                onProgress(++done / pieces.length);
              } catch (error) {
                failure ||= error;
                throw error;
              }
            }
        };
        // Let in-flight workers finish before removing files they may still be using.
        await Promise.allSettled(Array.from({ length: Math.min(CONCURRENCY, pieces.length) }, worker));
        if (failure) throw failure;
    } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    const words = results.flatMap((r) =>
        r.words.filter((w) => w.start < Math.min(PIECE_SECONDS, duration - r.start))
            .map((w) => ({ text: w.text, start: Math.round((r.start + w.start) * 1000), end: Math.round(Math.min(duration, r.start + PIECE_SECONDS, r.start + Math.max(w.end, w.start + 0.08)) * 1000) }))
    );
    // Languages per piece; the most common one is the video's.
    const counts = results.reduce((m, r) => m.set(r.language, (m.get(r.language) || 0) + 1), new Map());
    const detected = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    return { words, transcriptionProvider: `whisper-api:${[...new Set(results.map((r) => r.provider))].join(',')}`, language: detected };
}
