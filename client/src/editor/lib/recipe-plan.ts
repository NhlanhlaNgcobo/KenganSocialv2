import { CANVAS_SIZES, DEFAULT_TEXT } from '../constants';
import type { MediaElement, MediaItem, TextElement, TimelineTrack } from '../types';
import type { AutoCutTemplate } from './templates';
import { generateId } from './time';
import { DEFAULT_TRANSFORM, fillScale } from './transform';
import { colorFromLegacy } from './grade';

/** Pure plan construction: no timeline mutations and no asynchronous work. */
export function buildRecipe(template: AutoCutTemplate, sources: MediaItem[], texts: { hookText?: string; ctaText?: string }, pace = 1) {
    if (!template.recipe?.length || !sources.length) throw new Error('Choose footage for the template.');
    const canvas = CANVAS_SIZES[template.ratio];
    const main: MediaElement[] = [];
    const overlays: MediaElement[] = [];
    const titles: TextElement[] = [];
    let cursor = 0;
    const timing = Math.max(0.5, Math.min(2, pace));
    const title = (content: string, start: number, duration: number, y: number, size = 58) => {
        if (!content.trim()) return;
        titles.push({ ...DEFAULT_TEXT, id: generateId('title'), name: `Template: ${content.slice(0, 24)}`, content,
            startTime: start, duration, fontSize: size, fontFamily: 'Poppins', fontWeight: 'bold', y,
            backgroundColor: 'rgba(15,15,18,0.8)', animation: 'pop' });
    };
    template.recipe.forEach((shot, i) => {
        const source = sources[i] || sources[0];
        if (!source || !['video', 'image'].includes(source.type)) throw new Error(`Choose a video or image for ${shot.label}.`);
        const speed = source.type === 'image' ? 1 : Math.max(0.25, Math.min(4, shot.speed || 1));
        const wanted = shot.seconds / timing;
        const sourceDuration = source.type === 'image' ? wanted : source.duration;
        if (!Number.isFinite(sourceDuration) || sourceDuration < 0.1) throw new Error(`${source.name} has no usable duration.`);
        const length = Math.min(wanted, sourceDuration / speed);
        const position = shot.sourcePosition ?? i / Math.max(1, template.recipe!.length - 1);
        const start = source.type === 'image' ? 0 : Math.max(0, sourceDuration - length * speed) * position;
        const base = fillScale(source.width || 0, source.height || 0, canvas.width, canvas.height);
        const color = colorFromLegacy(template.grade);
        color.creative.look = template.filter === 'none' ? null : template.filter;
        const split = shot.overlay === 'split';
        main.push({
            id: generateId('clip'), type: 'media', mediaId: source.id, name: shot.label,
            duration: sourceDuration, startTime: cursor, trimStart: start, trimEnd: Math.max(0, sourceDuration - start - length * speed),
            speed, volume: 1, filter: 'none', color, effects: shot.effects || template.effects,
            transitionIn: i > 0 ? shot.transition || null : null,
            transform: { ...DEFAULT_TRANSFORM, scale: split ? 0.5 : base * (template.framing === 'punch' && i % 2 ? 1.1 : 1),
                x: split ? -canvas.width * 0.25 : 0,
                animation: !split && ['kenburns', 'slow-zoom'].includes(template.framing) ? (i % 2 && template.framing === 'kenburns' ? 'zoom-out' : 'zoom-in') : 'none',
                animationAmount: 0.08 },
        });
        if (shot.overlay) {
            const reference = sources[0];
            const d = reference.type === 'image' ? length : reference.duration;
            overlays.push({ id: generateId('clip'), type: 'media', mediaId: reference.id, name: `Template: ${split ? 'Paired memory' : 'Reference inset'}`,
                duration: d, startTime: cursor, trimStart: 0, trimEnd: Math.max(0, d - length),
                speed: 1, volume: 0, muted: true, filter: 'none',
                transform: { ...DEFAULT_TRANSFORM, scale: split ? 0.5 : 0.3, x: canvas.width * (split ? 0.25 : 0.29), y: split ? 0 : -canvas.height * 0.28 },
            });
        }
        if (shot.title) title(shot.title, cursor, Math.min(length, 3), canvas.height * 0.22);
        cursor += length;
    });
    const hook = texts.hookText ?? template.hookText;
    const cta = texts.ctaText ?? template.ctaText;
    if (hook) title(hook, 0, Math.min(2.5, cursor), -canvas.height * 0.28, 62);
    if (cta) title(cta, Math.max(0, cursor - 2.5), Math.min(2.5, cursor), canvas.height * 0.22);
    const tracks: TimelineTrack[] = [];
    if (titles.length) tracks.push({ id: generateId('track'), name: 'Template titles', type: 'text', elements: titles });
    if (overlays.length) tracks.push({ id: generateId('track'), name: 'Template overlays', type: 'media', elements: overlays });
    return { main, tracks, duration: cursor };
}
