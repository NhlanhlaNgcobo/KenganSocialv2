/**
 * Kengan JSON templates in the editor: the ids the editor and export support, building a timeline
 * from a template + the user's media, and turning the current edit back into a template.
 * Schema, validation and timing live in template-schema.js (shared with Node checks).
 */
import { CANVAS_SIZES, DEFAULT_TEXT } from '../constants';
import { CAPTION_MOTIONS, TEXT_ANIMATIONS } from './caption-motion.js';
import { LOOK_NAMES, neutralColor } from './color-pipeline.js';
import { EFFECTS, TRANSITIONS } from './fx';
import { analyseMedia } from './beat-sync';
import { applyParams, CAMERA, resolveTiming, TEMPLATE_SCHEMA, validateTemplate } from './template-schema.js';
import { generateId, getElementLength } from './time';
import { DEFAULT_TRANSFORM, fillScale, getTransform } from './transform';
import beatMontage15 from '../templates/beat-montage-15.json';
import cinematicSlideshow20 from '../templates/cinematic-slideshow-20.json';
import animatedPromo10 from '../templates/animated-promo-10.json';
import { useMediaStore } from '../stores/media-store';
import { usePlaybackStore } from '../stores/playback-store';
import { useProjectStore } from '../stores/project-store';
import { sortTracks, useTimelineStore } from '../stores/timeline-store';
import type { AspectRatio, ClipTransform, Keyframes, MediaElement, MediaItem, TextElement, TimelineTrack, TransitionType } from '../types';

// ---------------------------------------------------------------- template types (validated shape)

export interface TemplateSlot {
    id: string;
    label: string;
    accepts: ('video' | 'image')[];
    length: number;
    speed: number;
    sourcePosition: number | null;
    fit: 'fill' | 'fit';
    camera: ClipTransform['animation'];
    transitionIn: { type: TransitionType; duration: number } | null;
    effects: { type: string; amount: number }[];
    keyframes: Keyframes | null;
    color: { look: string | null; intensity: number } | null;
}
export interface TemplateText {
    id: string;
    label: string;
    content: string;
    slot: string | null;
    start: number;
    length: number;
    style: { fontSize: number; fontFamily: string; fontWeight: 'normal' | 'bold'; color: string; backgroundColor: string; x: number; y: number; textAlign: 'left' | 'center' | 'right' };
    motion: string | null;
    keyframes: Keyframes | null;
}
export interface TemplateParam {
    id: string;
    type: 'text' | 'color' | 'number' | 'choice';
    label: string;
    default: string | number;
    min?: number;
    max?: number;
    options?: string[];
    targets: string[];
}
export interface KenganTemplate {
    schema: typeof TEMPLATE_SCHEMA;
    id: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    canvas: { ratio: AspectRatio; fps: number; background: string };
    timing: { unit: 'seconds' | 'beats'; bpm: number };
    slots: TemplateSlot[];
    texts: TemplateText[];
    music: { source: 'user' | 'library'; query: { genre: string; vocals: string } | null; volume: number; originalVolume: number; startAt: number; beatSync: boolean } | null;
    params: TemplateParam[];
}

const TITLE_MOTIONS = new Set(TEXT_ANIMATIONS.map((a: { id: string }) => a.id));

/** Template scale keyframes are relative to the slot's fit scale (1 = filling the canvas). */
function scaleKeyframes(kf: Keyframes | null, factor: number): Keyframes | null {
    if (!kf?.scale) return kf;
    return { ...kf, scale: kf.scale.map((k) => ({ ...k, v: Math.round(k.v * factor * 10000) / 10000 })) };
}

/** Ids a template may use: what the editor previews and the export renders. */
export function knownIds() {
    return {
        transitions: TRANSITIONS.map((t) => t.type as string),
        effects: EFFECTS.map((e) => e.type as string),
        motions: [...CAPTION_MOTIONS, ...TITLE_MOTIONS, 'fade', 'pop'],
        looks: Object.keys(LOOK_NAMES),
    };
}

export function loadTemplate(input: unknown) {
    const result = validateTemplate(input, knownIds());
    return { ...result, template: result.template as KenganTemplate | null };
}

// ---------------------------------------------------------------- building

export interface BuildInput {
    /** Media per slot id; missing slots reuse the given media in order. */
    assignments: Record<string, string | undefined>;
    params?: Record<string, string | number>;
    /** Audio (or video) media used as the music, or null for none. */
    musicId?: string | null;
}

export interface BuildResult {
    main: MediaElement[];
    tracks: TimelineTrack[];
    duration: number;
    notes: string[];
    /** Timeline beat times the cuts follow (beat templates with music). */
    beatTimes: number[];
}

/**
 * Builds timeline elements from a validated template (no store mutations). Beat templates with
 * music: the song starts on its first beat at or after music.startAt, and every slot boundary is
 * placed on the song's detected beats.
 */
export async function buildTemplate(template: KenganTemplate, input: BuildInput): Promise<BuildResult> {
    const media = useMediaStore.getState();
    const notes: string[] = [];
    const { template: t, pace } = applyParams(template, input.params || {}) as { template: KenganTemplate; pace: number };
    const canvas = CANVAS_SIZES[t.canvas.ratio];

    // Media per slot: chosen, else the chosen media cycled in slot order.
    const chosen = t.slots.map((s) => (input.assignments[s.id] ? media.getItem(input.assignments[s.id]!) : undefined));
    const pool = chosen.filter((m): m is MediaItem => !!m);
    if (!pool.length) throw new Error('Add at least one video or photo to the template.');
    let reuse = 0;
    const sources = chosen.map((m, i) => {
        if (m && t.slots[i].accepts.includes(m.type as 'video' | 'image')) return m;
        if (m) notes.push(`${t.slots[i].label} takes ${t.slots[i].accepts.join(' or ')}; reused other media.`);
        const fallback = pool.filter((p) => t.slots[i].accepts.includes(p.type as 'video' | 'image'))[reuse++ % pool.length] || pool[reuse++ % pool.length];
        return fallback;
    });
    const missing = chosen.filter((m) => !m).length;
    if (missing) notes.push(`${missing} empty slot${missing === 1 ? '' : 's'} reuse your other media; swap them on the timeline.`);

    // Music and its beats.
    const music = input.musicId ? media.getItem(input.musicId) : null;
    let musicStart = t.music?.startAt || 0;
    let beatTimes: number[] = [];
    let beats: number[] | null = null;
    if (t.music && music && t.timing.unit === 'beats' && t.music.beatSync) {
        try {
            const analysis = await analyseMedia(music);
            const firstIdx = analysis.beats.findIndex((b) => b >= musicStart - 1e-3);
            if (firstIdx >= 0 && analysis.beats.length - firstIdx > 2) {
                musicStart = analysis.beats[firstIdx];
                beats = analysis.beats.slice(firstIdx).map((b) => b - musicStart);
                notes.push(`Cut to ${analysis.bpm} BPM.`);
            } else notes.push('No steady beat in the music; used the template tempo.');
        } catch {
            notes.push('Could not read the music; used the template tempo.');
        }
    } else if (t.timing.unit === 'beats' && !music) notes.push(`No music chosen: timed at ${t.timing.bpm} BPM.`);
    const timing = resolveTiming(t, { beats, pace });
    beatTimes = timing.beatTimes;

    const main: MediaElement[] = t.slots.map((slot, i) => {
        const source = sources[i];
        const length = timing.slots[i].length;
        let speed = source.type === 'image' ? 1 : slot.speed;
        const sourceDuration = source.type === 'image' ? length : source.duration;
        if (source.type !== 'image' && sourceDuration < length * speed) {
            // Too short for the slot at this speed: slow it down to fill the slot exactly.
            speed = Math.max(0.25, sourceDuration / length);
            if (sourceDuration < length * speed - 1e-3) notes.push(`${slot.label}: ${source.name} is too short even at 0.25×.`);
            else notes.push(`${slot.label}: ${source.name} slowed to ${speed.toFixed(2)}× to fill the slot.`);
        }
        const used = Math.min(sourceDuration, length * speed);
        const position = slot.sourcePosition ?? (t.slots.length > 1 ? i / (t.slots.length - 1) : 0);
        const trimStart = source.type === 'image' ? 0 : Math.max(0, sourceDuration - used) * position;
        const base = slot.fit === 'fill' ? fillScale(source.width || 0, source.height || 0, canvas.width, canvas.height) : 1;
        const color = slot.color ? { ...neutralColor(), creative: { ...neutralColor().creative, look: slot.color.look, intensity: slot.color.intensity } } : null;
        return {
            id: generateId('clip'),
            type: 'media',
            mediaId: source.id,
            name: slot.label,
            duration: source.type === 'image' ? length : sourceDuration,
            startTime: timing.slots[i].start,
            trimStart,
            trimEnd: source.type === 'image' ? 0 : Math.max(0, sourceDuration - trimStart - length * speed),
            speed,
            volume: t.music && music ? t.music.originalVolume : 1,
            filter: 'none',
            color,
            effects: slot.effects.length ? (slot.effects as MediaElement['effects']) : undefined,
            transitionIn: i > 0 && slot.transitionIn ? { type: slot.transitionIn.type, duration: Math.min(slot.transitionIn.duration, length * 0.8) } : null,
            transform: { ...DEFAULT_TRANSFORM, scale: base, animation: slot.camera, animationAmount: 0.12 },
            ...(slot.keyframes ? { keyframes: scaleKeyframes(slot.keyframes, base) } : {}),
        } as MediaElement;
    });

    const texts: TextElement[] = t.texts
        .filter((x) => x.content.trim())
        .map((x) => {
            const at = timing.texts.find((r) => r.id === x.id)!;
            const motion = x.motion;
            return {
                ...DEFAULT_TEXT,
                id: generateId('title'),
                name: `Template: ${x.label}`,
                content: x.content,
                startTime: at.start,
                duration: at.length,
                fontSize: x.style.fontSize,
                fontFamily: x.style.fontFamily,
                fontWeight: x.style.fontWeight,
                color: x.style.color,
                backgroundColor: x.style.backgroundColor,
                textAlign: x.style.textAlign,
                x: x.style.x,
                y: x.style.y,
                ...(motion === 'fade' || motion === 'pop' ? { animation: motion } : motion ? { captionMotion: motion } : {}),
                ...(x.keyframes ? { keyframes: x.keyframes } : {}),
            } as TextElement;
        });

    const tracks: TimelineTrack[] = [];
    if (texts.length) tracks.push({ id: generateId('track'), name: 'Template text', type: 'text', elements: texts });
    if (t.music && music) {
        const end = Math.min(music.duration, musicStart + timing.duration);
        if (end - musicStart < timing.duration - 0.05) notes.push('The song is shorter than the template.');
        tracks.push({
            id: generateId('track'),
            name: 'Template music',
            type: 'audio',
            elements: [
                {
                    id: generateId('clip'),
                    type: 'media',
                    mediaId: music.id,
                    name: `Music: ${music.name}`,
                    duration: music.duration,
                    startTime: 0,
                    trimStart: musicStart,
                    trimEnd: Math.max(0, music.duration - end),
                    volume: t.music.volume,
                    speed: 1,
                    filter: 'none',
                } as MediaElement,
            ],
        });
    }
    return { main, tracks, duration: timing.duration, notes, beatTimes };
}

/**
 * Replaces the edit with a built template as one undo step: main track, template text and music
 * tracks; the canvas ratio, background and fps follow the template.
 */
export function applyBuiltTemplate(template: KenganTemplate, built: BuildResult) {
    const before = useTimelineStore.getState();
    const project = useProjectStore.getState();
    const kept = before.tracks.filter((track) => track.isMain || !track.elements.length || !track.elements.every((e) => e.name.startsWith('Template:') || e.name.startsWith('Music: ')));
    const next = sortTracks([...built.tracks, ...kept.map((track) => (track.isMain ? { ...track, elements: built.main } : track))]);
    usePlaybackStore.getState().pause();
    before.pushHistory();
    const history = useTimelineStore.getState().history;
    try {
        project.setRatio(template.canvas.ratio);
        project.setBackgroundColor(template.canvas.background);
        useProjectStore.setState({ fps: template.canvas.fps });
        useTimelineStore.setState({ tracks: next, selected: [], history, future: [] });
        // Beat markers for the music clip so the timeline shows where the cuts were placed.
        const musicTrack = useTimelineStore.getState().tracks.find((tr) => tr.name === 'Template music');
        const musicEl = musicTrack?.elements[0];
        if (musicEl && musicEl.type === 'media' && built.beatTimes.length) {
            const item = useMediaStore.getState().getItem(musicEl.mediaId);
            if (item) void analyseMedia(item).then((a) => {
                const found = useTimelineStore.getState().findElement(musicEl.id);
                if (found) useTimelineStore.getState().updateElement(found.track.id, musicEl.id, { beats: { bpm: a.bpm, confidence: a.confidence, beats: a.beats, downbeats: a.downbeats, markers: [] } }, false);
            });
        }
    } catch (error) {
        useTimelineStore.setState({ tracks: before.tracks, history: before.history, future: before.future, selected: before.selected });
        useProjectStore.setState({ ratio: project.ratio, backgroundColor: project.backgroundColor, fps: project.fps });
        throw error;
    }
    usePlaybackStore.getState().seek(0);
}

// ---------------------------------------------------------------- saving the edit as a template

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * The current edit as a template: main clips become slots (lengths in beats when every cut sits on
 * a beat of the music), text becomes editable text (each with a param), music settings are kept.
 */
export function timelineToTemplate({ name, description = '', id }: { name: string; description?: string; id?: string }) {
    const { tracks } = useTimelineStore.getState();
    const project = useProjectStore.getState();
    const mediaStore = useMediaStore.getState();
    const mainTrack = tracks.find((tr) => tr.isMain);
    const clips = (mainTrack?.elements || []).filter((e): e is MediaElement => e.type === 'media').sort((a, b) => a.startTime - b.startTime);
    if (!clips.length) throw new Error('Put clips on the main track first.');
    const musicEl = tracks.filter((tr) => tr.type === 'audio').flatMap((tr) => tr.elements).find((e): e is MediaElement => e.type === 'media');

    // Beat timing when the music has beats and every cut is within 30 ms of one.
    const beatsAbs = musicEl?.beats?.beats?.length ? musicEl.beats.beats.filter((b) => b >= musicEl.trimStart - 1e-3).map((b) => musicEl.startTime + (b - musicEl.trimStart) / (musicEl.speed || 1)) : [];
    const boundaries = [...clips.map((c) => c.startTime), clips[clips.length - 1].startTime + getElementLength(clips[clips.length - 1])];
    const origin = boundaries[0];
    const beatIndex = (time: number) => {
        let best = -1;
        for (let i = 0; i < beatsAbs.length; i += 1) if (best < 0 || Math.abs(beatsAbs[i] - time) < Math.abs(beatsAbs[best] - time)) best = i;
        return best >= 0 && Math.abs(beatsAbs[best] - time) <= 0.03 ? best : -1;
    };
    const indices = boundaries.map(beatIndex);
    const onBeats = beatsAbs.length > 2 && indices.every((i) => i >= 0) && Math.abs(beatsAbs[indices[0]] - origin) < 0.03;
    const bpm = musicEl?.beats?.bpm || 120;
    const toUnits = (time: number) => {
        if (!onBeats) return round(time - origin);
        // Fractional beat position (texts need not sit on beats).
        const i = beatsAbs.findIndex((b, k) => k + 1 >= beatsAbs.length || beatsAbs[k + 1] > time);
        const a = beatsAbs[Math.max(0, i)];
        const b = beatsAbs[Math.min(beatsAbs.length - 1, Math.max(0, i) + 1)];
        const frac = b > a ? (time - a) / (b - a) : 0;
        return round(Math.max(0, i) + frac - indices[0], 2);
    };

    const slots = clips.map((c, i) => {
        const item = mediaStore.getItem(c.mediaId);
        const tf = getTransform(c);
        const canvas = CANVAS_SIZES[project.ratio];
        const base = fillScale(item?.width || 0, item?.height || 0, canvas.width, canvas.height) || 1;
        const length = onBeats ? indices[i + 1] - indices[i] : round(getElementLength(c));
        return {
            id: `shot-${i + 1}`,
            label: c.name && !/\.(mp4|mov|webm|jpe?g|png|m4v)$/i.test(c.name) ? c.name.slice(0, 40) : `Shot ${i + 1}`,
            accepts: item?.type === 'image' ? ['image', 'video'] : ['video', 'image'],
            length,
            ...(c.speed && c.speed !== 1 ? { speed: c.speed } : {}),
            ...(CAMERA.includes(tf.animation) && tf.animation !== 'none' ? { camera: tf.animation } : {}),
            ...(i > 0 && c.transitionIn ? { transitionIn: { type: c.transitionIn.type, duration: c.transitionIn.duration } } : {}),
            ...(c.effects?.length ? { effects: c.effects.map((e) => ({ type: e.type, amount: e.amount })) } : {}),
            ...(c.keyframes ? { keyframes: scaleKeyframes(c.keyframes, 1 / base) } : {}),
            ...(c.color?.creative?.look ? { color: { look: c.color.creative.look, intensity: c.color.creative.intensity } } : {}),
        };
    });
    const end = boundaries[boundaries.length - 1];
    const texts = tracks
        .filter((tr) => tr.type === 'text')
        .flatMap((tr) => tr.elements)
        .filter((e): e is TextElement => e.type === 'text' && !e.isCaption && e.startTime < end)
        .slice(0, 40)
        .map((e, i) => {
            const start = toUnits(e.startTime);
            const stop = toUnits(Math.min(end, e.startTime + getElementLength(e)));
            const motion = e.captionMotion || (e.animation && e.animation !== 'none' ? e.animation : undefined);
            return {
                id: `text-${i + 1}`,
                label: e.name?.replace(/^Template: /, '').slice(0, 40) || `Text ${i + 1}`,
                content: e.content,
                start,
                length: Math.max(0.05, round(stop - start, 2)),
                style: { fontSize: e.fontSize, fontFamily: e.fontFamily, fontWeight: e.fontWeight, color: /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : '#ffffff', backgroundColor: e.backgroundColor, x: Math.round(e.x), y: Math.round(e.y), textAlign: e.textAlign },
                ...(motion ? { motion } : {}),
                ...(e.keyframes ? { keyframes: e.keyframes } : {}),
            };
        });
    const raw = {
        schema: TEMPLATE_SCHEMA,
        id: id || `my-${Date.now().toString(36)}`,
        name: name.trim().slice(0, 60) || 'My template',
        description,
        category: 'mine',
        canvas: { ratio: project.ratio, fps: project.fps, background: /^#[0-9a-f]{6}$/i.test(project.backgroundColor) ? project.backgroundColor : '#000000' },
        timing: onBeats ? { unit: 'beats', bpm } : { unit: 'seconds' },
        slots,
        texts,
        music: musicEl ? { source: 'user', volume: musicEl.volume ?? 0.8, originalVolume: clips[0].volume ?? 1, startAt: 0, beatSync: onBeats } : null,
        params: [
            ...texts.map((x) => ({ id: `${x.id}-text`, type: 'text', label: x.label, default: x.content, targets: [`texts.${x.id}.content`] })),
            ...(musicEl ? [{ id: 'music-volume', type: 'number', label: 'Music volume', min: 0, max: 1.5, default: musicEl.volume ?? 0.8, targets: ['music.volume'] }] : []),
            ...(!onBeats ? [{ id: 'pace', type: 'number', label: 'Pace', min: 0.5, max: 2, default: 1, targets: ['pace'] }] : []),
        ],
    };
    const result = loadTemplate(raw);
    if (!result.ok) throw new Error(`This edit can't be saved as a template: ${result.errors[0]}`);
    return { template: result.template!, onBeats };
}

// ---------------------------------------------------------------- saved templates (this browser)

const STORE_KEY = 'kengan.templates.v1';

export function savedTemplates(): KenganTemplate[] {
    try {
        const list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
        return (Array.isArray(list) ? list : []).map((x) => loadTemplate(x).template).filter((x): x is KenganTemplate => !!x);
    } catch {
        return [];
    }
}

export function saveTemplate(template: KenganTemplate) {
    const list = savedTemplates().filter((x) => x.id !== template.id);
    list.unshift(template);
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, 50)));
    } catch {
        throw new Error('This browser blocked saving. Download the template file instead.');
    }
}

export function deleteTemplate(id: string) {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(savedTemplates().filter((x) => x.id !== id)));
    } catch {
        /* storage unavailable */
    }
}

/** Built-in templates (JSON files in ../templates/; add new ones to this list). */
const BUILT_IN = [beatMontage15, cinematicSlideshow20, animatedPromo10];

export function builtInTemplates(): KenganTemplate[] {
    return BUILT_IN.map((raw) => loadTemplate(raw).template).filter((x): x is KenganTemplate => !!x);
}
