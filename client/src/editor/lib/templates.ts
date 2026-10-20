/**
 * Auto-cut templates: a recipe (canvas, length, cutting strategy, framing, captions,
 * text cards, music) applied to one source video to produce a finished timeline.
 * AI analysis supplies highlights, speech-only segments and captions when the plan
 * allows it; otherwise cuts are spread evenly across the source.
 */
import { CAPTION_STYLES } from '../constants';
import { useMediaStore } from '../stores/media-store';
import { usePlaybackStore } from '../stores/playback-store';
import { getCanvasSize, useProjectStore } from '../stores/project-store';
import { sortTracks, useTimelineStore } from '../stores/timeline-store';
import type { AspectRatio, ClipEffect, ClipTransform, ClipTransition, ColorGrade, ColorSettings, MediaElement, TextElement, VideoFilter } from '../types';
import { LOOK_NAMES } from './color-pipeline.js';
import { colorFromLegacy } from './grade';
import { DEFAULT_AUTO_EDIT, mapWordsToTimeline, runAnalysis, type AnalysisMode } from './ai';
import { musicApi, type SongQuery } from '../../lib/music-api';
import { DEFAULT_TRANSFORM, fillScale } from './transform';
import { TREND_TEMPLATES, type RecipeShot } from './trend-templates';
import { CREATOR_TEMPLATES } from './creator-templates';
import { arrangeClips } from './arrange-clips';
import { buildRecipe } from './recipe-plan';
import { generateId } from './time';
import type { MediaItem, TimelineTrack } from '../types';

export type CutStrategy = 'highlights' | 'longest-speech' | 'even' | 'tidy';

/** Name prefix marking music a template added, so the next template can replace it. */
const TEMPLATE_MUSIC = 'Music: ';
export type FramingPattern = 'punch' | 'kenburns' | 'slow-zoom' | 'none';

export interface AutoCutTemplate {
    id: string;
    name: string;
    description: string;
    ratio: AspectRatio;
    /** Target length in seconds; null keeps as much as the strategy selects. */
    targetSeconds: number | null;
    strategy: CutStrategy;
    clipSeconds: [number, number];
    fill: boolean;
    framing: FramingPattern;
    captions: keyof typeof CAPTION_STYLES | null;
    filter: VideoFilter;
    hookText?: string;
    ctaText?: string;
    lowerThird?: string;
    /** Background song; genre/vocals are song-library filters (see music-api.ts). */
    music?: TemplateMusic | null;
    /** Colour grade, effects and the transition used on every cut. */
    grade?: ColorGrade;
    effects?: ClipEffect[];
    transition?: ClipTransition | null;
    recipe?: RecipeShot[];
    category?: 'gym' | 'lifestyle' | 'vlog';
}

export interface TemplateMusic {
    genre: string;
    vocals: NonNullable<SongQuery['vocals']>;
    volume: number;
    originalVolume: number;
}

/** Levels used when music is added to a template that has none by default: keep speech on top. */
const UNDERSCORE = { volume: 0.3, originalVolume: 1 };

function templateColor(template: AutoCutTemplate): ColorSettings | null {
    const look = LOOK_NAMES[template.filter] ? template.filter : null;
    if (!look && !template.grade) return null;
    const color = colorFromLegacy(template.grade);
    color.creative.look = look;
    return color;
}

export const TEMPLATES: AutoCutTemplate[] = [
    ...TREND_TEMPLATES,
    ...CREATOR_TEMPLATES,
    {
        id: 'viral-hook',
        name: 'Viral hook',
        description: 'Strongest moment first, then quick highlights with punch-in zooms and bold captions.',
        ratio: '9:16',
        targetSeconds: 20,
        strategy: 'highlights',
        clipSeconds: [2, 5],
        fill: true,
        framing: 'punch',
        captions: 'bold',
        filter: 'vivid',
        hookText: 'Wait for it…',
    },
    {
        id: 'podcast-clip',
        name: 'Podcast clip',
        description: 'One continuous talking segment, reframed vertical with a slow push-in and clean captions.',
        ratio: '9:16',
        targetSeconds: 45,
        strategy: 'longest-speech',
        clipSeconds: [20, 60],
        fill: true,
        framing: 'slow-zoom',
        captions: 'minimal',
        filter: 'none',
        lowerThird: 'Guest name',
    },
    {
        id: 'product-showcase',
        name: 'Product showcase',
        description: 'Five evenly spaced shots with alternating Ken Burns moves, a title card, a call to action and music.',
        ratio: '1:1',
        targetSeconds: 15,
        strategy: 'even',
        clipSeconds: [3, 3],
        fill: true,
        framing: 'kenburns',
        captions: null,
        filter: 'vivid',
        hookText: 'Meet the new drop',
        ctaText: 'Shop now',
        music: { genre: 'pop', vocals: 'any', volume: 0.5, originalVolume: 0.25 },
    },
    {
        id: 'beat-montage',
        name: 'Beat montage',
        description: 'Fast cuts every 1.2 seconds across the whole clip with punch zooms over an energetic track.',
        ratio: '9:16',
        targetSeconds: 15,
        strategy: 'even',
        clipSeconds: [1.2, 1.2],
        fill: true,
        framing: 'punch',
        captions: null,
        filter: 'drama',
        music: { genre: 'electronic', vocals: 'any', volume: 0.7, originalVolume: 0 },
    },
    {
        id: 'talking-head',
        name: 'Talking head tidy',
        description: 'Removes silences and dead air, keeps your ratio, and punches in on alternate cuts to hide jump cuts.',
        ratio: '16:9',
        targetSeconds: null,
        strategy: 'tidy',
        clipSeconds: [1, 600],
        fill: false,
        framing: 'punch',
        captions: 'minimal',
        filter: 'none',
    },
    {
        id: 'cinematic-trailer',
        name: 'Cinematic trailer',
        description: 'Best moments as a widescreen trailer: teal & orange grade, film grain, vignette and dips to black.',
        ratio: '16:9',
        targetSeconds: 30,
        strategy: 'highlights',
        clipSeconds: [2, 4],
        fill: true,
        framing: 'slow-zoom',
        captions: null,
        filter: 'teal-orange',
        grade: { brightness: -0.02, contrast: 1.12, saturation: 1, temperature: 0, fade: 0.1 },
        effects: [{ type: 'vignette', amount: 0.55 }, { type: 'grain', amount: 0.3 }],
        transition: { type: 'fadeblack', duration: 0.8 },
        hookText: 'Coming soon',
        music: { genre: 'electronic', vocals: 'any', volume: 0.6, originalVolume: 0.3 },
    },
    {
        id: 'travel-vlog',
        name: 'Travel vlog',
        description: 'Golden-hour grade, gentle Ken Burns moves and slide transitions over an upbeat acoustic track.',
        ratio: '9:16',
        targetSeconds: 24,
        strategy: 'even',
        clipSeconds: [3, 3],
        fill: true,
        framing: 'kenburns',
        captions: null,
        filter: 'golden',
        transition: { type: 'slideleft', duration: 0.5 },
        hookText: 'Take me back',
        music: { genre: 'acoustic', vocals: 'any', volume: 0.55, originalVolume: 0.2 },
    },
    {
        id: 'retro-vhs',
        name: 'Retro VHS',
        description: 'Home-video nostalgia: vintage colour, tape grain and colour bleed, pixel transitions.',
        ratio: '9:16',
        targetSeconds: 16,
        strategy: 'even',
        clipSeconds: [2, 2],
        fill: true,
        framing: 'none',
        captions: null,
        filter: 'vintage',
        effects: [{ type: 'vhs', amount: 0.65 }],
        transition: { type: 'pixelize', duration: 0.4 },
        hookText: 'Summer ’98',
        music: { genre: 'soul', vocals: 'any', volume: 0.6, originalVolume: 0.2 },
    },
    {
        id: 'tutorial-steps',
        name: 'Tutorial steps',
        description: 'Tidies a screen or talking tutorial: pauses removed, soft fades between steps, clean captions.',
        ratio: '16:9',
        targetSeconds: null,
        strategy: 'tidy',
        clipSeconds: [1, 600],
        fill: false,
        framing: 'none',
        captions: 'minimal',
        filter: 'none',
        grade: { brightness: 0.02, contrast: 1.05, saturation: 1.03, temperature: 0 },
        transition: { type: 'fade', duration: 0.3 },
        lowerThird: 'Step 1',
    },
    {
        id: 'testimonial',
        name: 'Customer testimonial',
        description: 'One honest answer in a warm film look with a soft vignette, name tag and a call to action.',
        ratio: '9:16',
        targetSeconds: 40,
        strategy: 'longest-speech',
        clipSeconds: [20, 45],
        fill: true,
        framing: 'slow-zoom',
        captions: 'minimal',
        filter: 'film-warm',
        effects: [{ type: 'vignette', amount: 0.35 }],
        lowerThird: 'Customer name',
        ctaText: 'Book yours today',
        music: { genre: 'acoustic', vocals: 'any', volume: 0.18, originalVolume: 1 },
    },
    {
        id: 'property-tour',
        name: 'Property tour',
        description: 'Bright, airy walkthrough: slow pans, long cross fades, a “Just listed” title and viewing CTA.',
        ratio: '16:9',
        targetSeconds: 30,
        strategy: 'even',
        clipSeconds: [4, 4],
        fill: true,
        framing: 'kenburns',
        captions: null,
        filter: 'none',
        grade: { brightness: 0.05, contrast: 1.04, saturation: 1.08, temperature: 0.1, highlights: -0.2, shadows: 0.25 },
        transition: { type: 'fade', duration: 0.8 },
        hookText: 'Just listed',
        ctaText: 'Book a viewing',
        music: { genre: 'jazz', vocals: 'any', volume: 0.5, originalVolume: 0 },
    },
    {
        id: 'event-recap',
        name: 'Event recap',
        description: 'High-energy highlights with punch zooms, camera shake and zoom transitions on a dance track.',
        ratio: '9:16',
        targetSeconds: 20,
        strategy: 'highlights',
        clipSeconds: [1.5, 3],
        fill: true,
        framing: 'punch',
        captions: null,
        filter: 'vivid',
        effects: [{ type: 'shake', amount: 0.25 }],
        transition: { type: 'zoomin', duration: 0.35 },
        hookText: 'Last night was unreal',
        music: { genre: 'dance', vocals: 'any', volume: 0.7, originalVolume: 0.15 },
    },
    {
        id: 'recipe-quick',
        name: 'Quick recipe',
        description: 'Square food video: warm, appetising colour, quick steps with wipes and bold captions.',
        ratio: '1:1',
        targetSeconds: 20,
        strategy: 'even',
        clipSeconds: [2.5, 2.5],
        fill: true,
        framing: 'kenburns',
        captions: 'bold',
        filter: 'film-warm',
        grade: { brightness: 0.03, contrast: 1.06, saturation: 1.12, temperature: 0.15, vibrance: 0.3 },
        transition: { type: 'wiperight', duration: 0.35 },
        hookText: 'Ready in 15 minutes',
        music: { genre: 'latin', vocals: 'any', volume: 0.5, originalVolume: 0.3 },
    },
    {
        id: 'moody-story',
        name: 'Moody storytime',
        description: 'A personal story told straight to camera: moody grade, grain and vignette, slow push-in, captions.',
        ratio: '9:16',
        targetSeconds: 50,
        strategy: 'longest-speech',
        clipSeconds: [25, 60],
        fill: true,
        framing: 'slow-zoom',
        captions: 'minimal',
        filter: 'moody',
        effects: [{ type: 'grain', amount: 0.35 }, { type: 'vignette', amount: 0.5 }],
    },
];

interface Segment {
    start: number;
    end: number;
    label?: string;
    score?: number;
}

/** n evenly spaced windows of `length` seconds across [0, duration]. */
export function evenSegments(duration: number, count: number, length: number): Segment[] {
    const usable = Math.max(0, duration - length);
    return Array.from({ length: count }, (_, i) => {
        const start = count === 1 ? usable / 2 : (usable * i) / (count - 1);
        return { start, end: Math.min(duration, start + length), label: `Shot ${i + 1}` };
    }).filter((s) => s.end - s.start > 0.2);
}

function fitToLength(segments: Segment[], target: number | null): Segment[] {
    if (!target) return segments;
    const out: Segment[] = [];
    let total = 0;
    for (const s of segments) {
        const len = s.end - s.start;
        if (total + len > target + 0.5) {
            const room = target - total;
            if (room >= 1) out.push({ ...s, end: s.start + room });
            break;
        }
        out.push(s);
        total += len;
    }
    return out;
}

function chooseSegments(
    template: AutoCutTemplate,
    duration: number,
    analysis: {
        viralClips?: { startSec: number; endSec: number; score: number; reason: string }[] | null;
        keepSegments?: { startSec: number; endSec: number }[] | null;
        silenceSegments?: { startSec: number; endSec: number }[] | null;
    } | null
): { segments: Segment[]; usedAi: boolean } {
    const [minLen, maxLen] = template.clipSeconds;
    const target = template.targetSeconds;

    if (template.strategy === 'highlights' && analysis?.viralClips?.length) {
        const clips = [...analysis.viralClips].sort((a, b) => b.score - a.score);
        // Strongest moment as the hook, the rest in story order.
        const [hook, ...rest] = clips;
        const ordered = [hook, ...rest.sort((a, b) => a.startSec - b.startSec)];
        const segments = ordered.map((c) => {
            const len = Math.min(maxLen, Math.max(minLen, c.endSec - c.startSec));
            const start = Math.max(0, Math.min(c.startSec, duration - len));
            return { start, end: Math.min(duration, start + len), label: c.reason, score: c.score };
        });
        return { segments: fitToLength(segments, target), usedAi: true };
    }

    if (template.strategy === 'longest-speech' && analysis?.keepSegments?.length) {
        const longest = [...analysis.keepSegments].sort((a, b) => b.endSec - b.startSec - (a.endSec - a.startSec))[0];
        const len = Math.min(maxLen, target || maxLen, longest.endSec - longest.startSec);
        return { segments: [{ start: longest.startSec, end: longest.startSec + len, label: 'Best segment' }], usedAi: true };
    }

    if (template.strategy === 'tidy' && analysis?.silenceSegments) {
        // Keep everything except pauses longer than 0.6s, leaving a little breathing room either side.
        const pad = 0.12;
        const pauses = analysis.silenceSegments.filter((s) => s.endSec - s.startSec >= 0.6).sort((a, b) => a.startSec - b.startSec);
        const segments: Segment[] = [];
        let cursor = 0;
        for (const p of pauses) {
            const end = Math.min(duration, p.startSec + pad);
            if (end - cursor >= Math.max(minLen, 0.3)) segments.push({ start: cursor, end, label: `Part ${segments.length + 1}` });
            cursor = Math.max(cursor, p.endSec - pad);
        }
        if (duration - cursor >= 0.3) segments.push({ start: cursor, end: duration, label: `Part ${segments.length + 1}` });
        if (segments.length) return { segments: fitToLength(segments, target), usedAi: true };
    }

    // Even spacing: the default for montage templates and the fallback for everything else.
    if (template.strategy === 'longest-speech' || template.strategy === 'tidy') {
        const len = Math.min(duration, target || duration);
        return { segments: [{ start: Math.max(0, (duration - len) / 2), end: Math.max(0, (duration - len) / 2) + len, label: 'Clip' }], usedAi: false };
    }
    const len = Math.min(maxLen, duration);
    const count = Math.max(1, Math.min(Math.floor((target || duration) / len), Math.floor(duration / Math.max(len, 0.5))));
    return { segments: evenSegments(duration, count, len), usedAi: false };
}

function framingFor(template: AutoCutTemplate, index: number, base: number): ClipTransform {
    const t: ClipTransform = { ...DEFAULT_TRANSFORM, scale: base };
    switch (template.framing) {
        case 'punch':
            // Alternate a tighter crop on every other cut: hides jump cuts and adds energy.
            return { ...t, scale: index % 2 ? base * 1.12 : base };
        case 'kenburns':
            return { ...t, animation: index % 2 ? 'zoom-out' : 'zoom-in', animationAmount: 0.12 };
        case 'slow-zoom':
            return { ...t, animation: 'zoom-in', animationAmount: 0.08 };
        default:
            return t;
    }
}

export interface ApplyOptions {
    sourceIds?: string[];
    pace?: number;
    hookText?: string;
    ctaText?: string;
    lowerThird?: string;
    /** Music choice: undefined keeps the template default, null means no music. */
    music?: Pick<TemplateMusic, 'genre' | 'vocals'> | null;
    allowAi: boolean;
    onStage?: (stage: string, progress: number) => void;
    signal?: AbortSignal;
}

export async function applyTemplate(template: AutoCutTemplate, mediaId: string, opts: ApplyOptions): Promise<string> {
    const media = useMediaStore.getState().getItem(mediaId);
    if (!media || (template.recipe ? !['video', 'image'].includes(media.type) : media.type !== 'video')) throw new Error('Choose footage for this template.');
    const initialProject = useProjectStore.getState();
    const projectKey = initialProject.projectKey;
    if (!projectKey) throw new Error('The project is still loading.');
    const initialTracks = useTimelineStore.getState().tracks;
    const check = () => {
        if (opts.signal?.aborted) throw new Error('Cancelled');
        const current = useProjectStore.getState();
        if (current.projectKey !== projectKey || current.ratio !== initialProject.ratio || useTimelineStore.getState().tracks !== initialTracks) {
            throw new Error('Your project changed while the template was being prepared. Apply again to use the latest edit.');
        }
        if (!useMediaStore.getState().getItem(mediaId)) throw new Error('The source was removed. Choose footage again.');
    };
    check();
    const report = opts.onStage || (() => {});
    const music: TemplateMusic | null = opts.music === undefined ? template.music || null : opts.music === null ? null : { ...(template.music || UNDERSCORE), ...opts.music };
    const automaticallyAssigned = arrangeClips(template.recipe || [], useMediaStore.getState().items);
    const sources = (template.recipe || []).map((_, i) => {
        const id = opts.sourceIds?.[i] || automaticallyAssigned[i] || mediaId;
        const source = useMediaStore.getState().getItem(id);
        if (!source) throw new Error('A template source is missing. Choose footage again.');
        return source;
    });
    let analysis: Awaited<ReturnType<typeof runAnalysis>> | null = null;
    let analysisError: string | null = null;
    if (!template.recipe && opts.allowAi && (template.strategy !== 'even' || !!template.captions)) {
        try {
            const mode: AnalysisMode = template.strategy === 'highlights' ? 'viral' : 'auto-edit';
            analysis = await runAnalysis(mediaId, mode, { ...DEFAULT_AUTO_EDIT, minClipLength: template.clipSeconds[0], maxClipLength: template.clipSeconds[1] }, (stage, p) => report(`Analysing: ${stage}`, Math.min(60, p * 0.6)), opts.signal);
        } catch (error) {
            if (opts.signal?.aborted || (error as Error).message === 'Cancelled') throw new Error('Cancelled');
            analysisError = (error as Error).message;
        }
    }
    check();
    report('Preparing cuts', 65);
    const canvas = getCanvasSize(template.ratio);
    const recipe = template.recipe ? buildRecipe(template, sources, opts, opts.pace) : null;
    const { segments, usedAi } = recipe ? { segments: [], usedAi: false } : chooseSegments(template, media.duration, analysis);
    const base = template.fill ? fillScale(media.width || 0, media.height || 0, canvas.width, canvas.height) : 1;
    let cursor = 0;
    const mainElements: MediaElement[] = recipe?.main || segments.map((seg, i) => {
        const el: MediaElement = {
            id: generateId('clip'), type: 'media', mediaId, name: seg.label || `Cut ${i + 1}`,
            duration: media.duration, startTime: cursor, trimStart: seg.start, trimEnd: Math.max(0, media.duration - seg.end),
            volume: 1, speed: 1, filter: LOOK_NAMES[template.filter] ? 'none' : template.filter,
            color: templateColor(template), effects: template.effects,
            transitionIn: i > 0 && template.transition ? template.transition : null,
            transform: framingFor(template, i, base),
        };
        cursor += seg.end - seg.start;
        return el;
    });
    if (!mainElements.length) throw new Error('The clip is too short for this template.');
    const total = recipe?.duration ?? cursor;

    // All asynchronous work finishes before the first timeline mutation.
    let musicItem: MediaItem | null = null;
    let musicNote = '';
    let downloaded: { file: File; title: string; credit: string; artist: string } | null = null;
    if (music) {
        report('Preparing music', 80);
        try {
            const track = await musicApi.pickSong({ genre: music.genre, vocals: music.vocals, minSeconds: total });
            check();
            if (track) {
                const blob = await musicApi.download(track);
                check();
                downloaded = { file: new File([blob], `${track.artist} - ${track.title}`.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60) + '.mp3', { type: 'audio/mpeg' }), title: track.title, credit: track.credit, artist: track.artist };
            } else musicNote = ' No matching music was available; original audio was kept.';
        } catch (error) {
            check();
            musicNote = ` Music could not be added (${(error as Error).message}); original audio was kept.`;
        }
    }
    check();
    if (downloaded) {
        const [item] = await useMediaStore.getState().addFiles([downloaded.file], projectKey, {
            signal: opts.signal,
            isCurrent: () => useProjectStore.getState().projectKey === projectKey && useTimelineStore.getState().tracks === initialTracks,
        });
        musicItem = item || null;
        musicNote = item ? ` Music: ${downloaded.title} by ${downloaded.artist}. Credit: ${downloaded.credit}` : ' Music import failed; original audio was kept.';
    }
    check();
    for (const source of sources) if (!useMediaStore.getState().getItem(source.id)) throw new Error('A source was removed while preparing this template.');
    if (musicItem && music) mainElements.forEach((el) => { el.volume = music.originalVolume; });
    const extraTracks: TimelineTrack[] = [...(recipe?.tracks || [])];
    if (musicItem && music) extraTracks.push({ id: generateId('track'), name: 'Template music', type: 'audio', elements: [{
        id: generateId('clip'), type: 'media', mediaId: musicItem.id, name: `${TEMPLATE_MUSIC}${downloaded?.title || musicItem.name}`,
        duration: musicItem.duration, startTime: 0, trimStart: 0, trimEnd: Math.max(0, musicItem.duration - total),
        volume: music.volume, speed: 1, filter: 'none',
    }] });
    const before = useTimelineStore.getState();
    const kept = before.tracks.filter((t) => t.isMain || !(t.elements.length && t.elements.every((e) => e.name.startsWith('Template:') || e.name.startsWith(TEMPLATE_MUSIC))));
    const nextTracks = sortTracks([...extraTracks, ...kept.map((t) => t.isMain ? { ...t, elements: mainElements } : t)]);
    // One synchronous transaction. Existing user caption/overlay tracks remain editable.
    usePlaybackStore.getState().pause();
    before.pushHistory();
    const oneHistory = useTimelineStore.getState().history;
    let captionCount = 0;
    try {
        useProjectStore.getState().setRatio(template.ratio);
        useTimelineStore.setState({ tracks: nextTracks, selected: [] });
        if (!recipe) {
            const addText = (content: string | undefined, start: number, duration: number, partial: Partial<TextElement>) => {
                if (content?.trim()) useTimelineStore.getState().addTextAtTime(start, { content, name: `Template: ${content.slice(0, 20)}`, duration, ...partial });
            };
            const unit = Math.min(canvas.width, canvas.height);
            addText(opts.hookText ?? template.hookText, 0, Math.min(2.5, total), { fontSize: Math.round(unit * 0.085), fontWeight: 'bold', y: -Math.round(canvas.height * 0.3), color: '#ffffff' });
            addText(opts.ctaText ?? template.ctaText, Math.max(0, total - 2.5), Math.min(2.5, total), { fontSize: Math.round(unit * 0.07), fontWeight: 'bold', backgroundColor: '#e4e4e7', color: '#0a0a0b', y: Math.round(canvas.height * 0.28) });
            addText(opts.lowerThird ?? template.lowerThird, 0.5, Math.min(4, Math.max(0.1, total - 0.5)), { fontSize: Math.round(unit * 0.045), backgroundColor: 'rgba(0,0,0,0.6)', y: Math.round(canvas.height * 0.3) });
            if (template.captions && analysis?.transcription?.words?.length) {
                captionCount = useTimelineStore.getState().addCaptions(mapWordsToTimeline(mediaId, analysis.transcription.words), template.captions, canvas.height);
            }
        }
        useTimelineStore.setState({ selected: [], history: oneHistory, future: [] });
    } catch (error) {
        useTimelineStore.setState({ tracks: before.tracks, history: before.history, future: before.future, selected: before.selected });
        useProjectStore.setState({ ratio: initialProject.ratio, backgroundColor: initialProject.backgroundColor });
        throw error;
    }
    usePlaybackStore.getState().seek(0);
    report('Done', 100);
    const parts = [`${template.name}: ${mainElements.length} cuts, ${Math.round(total)}s`];
    if (captionCount) parts.push(`${captionCount} captions`);
    if (!recipe && !usedAi && template.strategy !== 'even') parts.push(analysisError ? `fallback cuts (AI analysis failed: ${analysisError})` : 'fallback cuts (AI analysis needs a paid plan)');
    return `${parts.join(', ')}.${musicNote} Ctrl+Z restores the previous edit and canvas.`;
}
