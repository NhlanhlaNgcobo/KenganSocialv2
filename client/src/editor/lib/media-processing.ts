import type { MediaType } from '../types';

export interface MediaInfo {
    type: MediaType;
    duration: number;
    width?: number;
    height?: number;
    thumbnailUrl?: string;
}

export function detectMediaType(file: File | Blob): MediaType | null {
    const mime = file.type || '';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    return null;
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        video.src = url;
        video.onloadedmetadata = () => resolve(video);
        video.onerror = () => reject(new Error('Could not read video metadata'));
    });
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
    return new Promise((resolve) => {
        const done = () => {
            video.removeEventListener('seeked', done);
            resolve();
        };
        video.addEventListener('seeked', done);
        video.currentTime = time;
    });
}

function drawThumbnail(source: CanvasImageSource, width: number, height: number): string {
    const maxWidth = 320;
    const scale = Math.min(1, maxWidth / Math.max(width, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
}

export async function getMediaInfo(file: File | Blob, url: string): Promise<MediaInfo> {
    const type = detectMediaType(file);
    if (!type) throw new Error(`Unsupported file type: ${file.type || 'unknown'}`);

    if (type === 'video') {
        const video = await loadVideo(url);
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        await seek(video, Math.min(1, duration / 2));
        const thumbnailUrl = drawThumbnail(video, video.videoWidth, video.videoHeight);
        const info = { type, duration, width: video.videoWidth, height: video.videoHeight, thumbnailUrl };
        video.removeAttribute('src');
        video.load();
        return info;
    }

    if (type === 'image') {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Could not read image'));
            image.src = url;
        });
        return {
            type,
            duration: 0,
            width: img.naturalWidth,
            height: img.naturalHeight,
            thumbnailUrl: drawThumbnail(img, img.naturalWidth, img.naturalHeight),
        };
    }

    const duration = await new Promise<number>((resolve, reject) => {
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        audio.src = url;
        audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
        audio.onerror = () => reject(new Error('Could not read audio metadata'));
    });
    return { type, duration };
}

/** Samples video frames for the timeline filmstrip. */
export async function generateFilmstrip(url: string, count: number): Promise<string[]> {
    const video = await loadVideo(url);
    const frames: string[] = [];
    const duration = video.duration || 0;
    for (let i = 0; i < count; i += 1) {
        await seek(video, (duration * (i + 0.5)) / count);
        frames.push(drawThumbnail(video, video.videoWidth, video.videoHeight));
    }
    video.removeAttribute('src');
    video.load();
    return frames;
}

/** Downsampled peak data for audio waveforms, normalised to 0..1. */
export async function getWaveformPeaks(file: Blob, buckets = 200): Promise<number[]> {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return [];
    const ctx = new AudioCtx();
    try {
        const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
        const data = buffer.getChannelData(0);
        const size = Math.max(1, Math.floor(data.length / buckets));
        const peaks: number[] = [];
        for (let i = 0; i < buckets; i += 1) {
            let max = 0;
            for (let j = i * size; j < Math.min(data.length, (i + 1) * size); j += 1) {
                const v = Math.abs(data[j]);
                if (v > max) max = v;
            }
            peaks.push(max);
        }
        const top = Math.max(...peaks, 0.01);
        return peaks.map((p) => p / top);
    } catch {
        return [];
    } finally {
        ctx.close();
    }
}
