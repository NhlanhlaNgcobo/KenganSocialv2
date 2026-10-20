import type { MediaItem } from '../types';
import type { RecipeShot } from './trend-templates';

const words = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2);
/** Deterministic metadata matching. Does not claim visual or speech understanding. */
export function arrangeClips(shots: RecipeShot[], pool: MediaItem[]): string[] {
    const usable = pool.filter((m) => m.type === 'image' || (m.type === 'video' && m.duration > 0));
    if (!usable.length) return [];
    let used = new Set<string>();
    const assigned: string[] = [];
    return shots.map((shot) => {
        if (shot.repeatSource !== undefined && assigned[shot.repeatSource]) {
            const id = assigned[shot.repeatSource];
            assigned.push(id);
            return id;
        }
        if (used.size === usable.length) used = new Set();
        const keywords = words(shot.label);
        const ranked = usable.filter((m) => !used.has(m.id)).map((m, order) => {
            const tokens = words(m.name);
            const matches = keywords.filter((w) => tokens.includes(w)).length;
            const needed = shot.seconds * (shot.speed || 1);
            const fit = m.type === 'image' ? 0 : Math.min(1, m.duration / needed);
            const orientation = m.height > m.width ? 0.2 : 0;
            return { m, order, score: matches * 10 + fit + orientation };
        }).sort((a, b) => b.score - a.score || a.order - b.order);
        used.add(ranked[0].m.id);
        assigned.push(ranked[0].m.id);
        return ranked[0].m.id;
    });
}
