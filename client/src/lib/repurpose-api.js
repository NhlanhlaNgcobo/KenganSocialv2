/**
 * Repurpose API (/api/repurpose) and posting-slot helpers.
 */
import { apiClient } from './api';

export const repurposeApi = {
    options: () => apiClient('/repurpose/options'),
    generate: (body) => apiClient('/repurpose', { method: 'POST', body }),
};

/** Default posting times (local time). Morning commute, lunch and early evening. */
export const POSTING_TIMES = [
    [9, 0],
    [12, 30],
    [17, 30],
];

/**
 * The next free posting slot for a platform over the coming two weeks: the first
 * default time at least 30 minutes away with no post for that platform within an hour.
 */
export async function nextFreeSlot(platform) {
    const now = new Date();
    const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    let taken = [];
    try {
        const data = await apiClient(`/schedule/calendar?start=${now.toISOString()}&end=${end.toISOString()}`);
        taken = (data.posts || [])
            .filter((p) => (p.platforms || []).includes(platform))
            .map((p) => new Date(p.scheduledAt?._seconds ? p.scheduledAt._seconds * 1000 : p.scheduledAt).getTime());
    } catch {
        // Without the calendar, fall back to the next default time.
    }
    const earliest = now.getTime() + 30 * 60 * 1000;
    for (let day = 0; day < 14; day += 1) {
        for (const [h, m] of POSTING_TIMES) {
            const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, h, m).getTime();
            if (slot < earliest) continue;
            if (taken.some((t) => Math.abs(t - slot) < 60 * 60 * 1000)) continue;
            return new Date(slot);
        }
    }
    return new Date(earliest);
}

export function formatSlot(date) {
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (date.toDateString() === today.toDateString()) return `today ${time}`;
    if (date.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`;
    return `${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

export async function schedulePost({ platform, caption, at }) {
    return apiClient('/schedule/create', {
        method: 'POST',
        body: { platforms: [platform], caption, mediaUrl: '', scheduledAt: at.toISOString(), platformOptions: { [platform]: { caption } } },
    });
}
