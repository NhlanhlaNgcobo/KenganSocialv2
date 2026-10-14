import type { TimelineElement } from '../types';

export function generateId(prefix = 'el'): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
    }
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Visible length of an element on the timeline, accounting for trims and speed. */
export function getElementLength(element: TimelineElement): number {
    const sourceLength = Math.max(0, element.duration - element.trimStart - element.trimEnd);
    const speed = element.type === 'media' ? element.speed || 1 : 1;
    return sourceLength / speed;
}

export function getElementEnd(element: TimelineElement): number {
    return element.startTime + getElementLength(element);
}

export function formatTimecode(seconds: number, fps = 30): string {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * fps);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

export function formatShort(seconds: number): string {
    if (!Number.isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

export function snapToFrame(time: number, fps: number): number {
    if (fps <= 0) return time;
    return Math.round(time * fps) / fps;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
