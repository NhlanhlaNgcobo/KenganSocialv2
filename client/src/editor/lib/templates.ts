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
import { useTimelineStore } from '../stores/timeline-store';
import type { AspectRatio, ClipTransform, MediaElement, TextElement, VideoFilter } from '../types';
import { DEFAULT_AUTO_EDIT, mapWordsToTimeline, runAnalysis, type AnalysisMode } from './ai';
import { musicApi, type SongQuery } from '../../lib/music-api';
import { DEFAULT_TRANSFORM, fillScale } from './transform';

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
}

export interface TemplateMusic {
    genre: string;
    vocals: NonNullable<SongQuery['vocals']>;
    volume: number;
    originalVolume: number;
}

/** Levels used when music is added to a template that has none by default: keep speech on top. */
const UNDERSCORE = { volume: 0.3, originalVolume: 1 };

export const TEMPLATES: AutoCutTemplate[] = [
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
    if (!media || media.type !== 'video') throw new Error('Choose a video to cut.');
    const projectKey = useProjectStore.getState().projectKey;
    if (!projectKey) throw new Error('The project is still loading.');
    const report = opts.onStage || (() => {});
    const music: TemplateMusic | null =
        opts.music === undefined ? template.music || null : opts.music === null ? null : { ...(template.music || UNDERSCORE), ...opts.music };

    // 1. Analyse (when the template benefits and the plan allows).
    const wantsAnalysis = opts.allowAi && (template.strategy !== 'even' || !!template.captions);
    let analysis: Awaited<ReturnType<typeof runAnalysis>> | null = null;
    let analysisError: string | null = null;
    if (wantsAnalysis) {
        const mode: AnalysisMode = template.strategy === 'highlights' ? 'viral' : 'auto-edit';
        try {
            analysis = await runAnalysis(mediaId, mode, { ...DEFAULT_AUTO_EDIT, minClipLength: template.clipSeconds[0], maxClipLength: template.clipSeconds[1] }, (stage, p) => report(`Analysing: ${stage}`, Math.min(60, p * 0.6)), opts.signal);
        } catch (error) {
            if ((error as Error).message === 'Cancelled') throw error;
            analysisError = (error as Error).message;
        }
    }

    // 2. Cut.
    report('Cutting', 65);
    const { segments, usedAi } = chooseSegments(template, media.duration, analysis);
    if (!segments.length) throw new Error('The clip is too short for this template.');

    useProjectStore.getState().setRatio(template.ratio);
    const canvas = getCanvasSize(template.ratio);
    const base = template.fill ? fillScale(media.width || 0, media.height || 0, canvas.width, canvas.height) : 1;

    // Everything below becomes one undo step: remember the state before the template.
    const { history: historyBefore, tracks: tracksBefore } = useTimelineStore.getState();
    let cursor = 0;
    const mainElements: MediaElement[] = segments.map((seg, i) => {
        const el: MediaElement = {
            id: `clip_${Date.now().toString(36)}_${i}`,
            type: 'media',
            mediaId,
            name: seg.label || `Cut ${i + 1}`,
            duration: media.duration,
            startTime: cursor,
            trimStart: seg.start,
            trimEnd: Math.max(0, media.duration - seg.end),
            volume: music ? music.originalVolume : 1,
            speed: 1,
            filter: template.filter,
            transform: framingFor(template, i, base),
        };
        cursor += seg.end - seg.start;
        return el;
    });
    const total = cursor;

    // Replace the main track and any previous template text; keep other user tracks.
    const tracks = useTimelineStore.getState().tracks
        .map((t) => (t.isMain ? { ...t, elements: mainElements } : t))
        .filter((t) => !(t.type === 'text' && t.elements.every((e) => e.type === 'text' && (e.isCaption || e.name.startsWith('Template:')))))
        // Music added by an earlier template goes too; music the user added stays.
        .filter((t) => !(t.type === 'audio' && t.elements.length > 0 && t.elements.every((e) => e.name.startsWith(TEMPLATE_MUSIC))));
    useTimelineStore.setState({ tracks, selected: [] });

    // 3. Text cards.
    const addText = (content: string, start: number, duration: number, partial: Partial<TextElement>) => {
        if (!content.trim()) return;
        useTimelineStore.getState().addTextAtTime(start, { content, name: `Template: ${content.slice(0, 20)}`, duration, ...partial });
    };
    const hook = opts.hookText ?? template.hookText;
    const cta = opts.ctaText ?? template.ctaText;
    const lower = opts.lowerThird ?? template.lowerThird;
    const unit = Math.min(canvas.width, canvas.height);
    if (hook) addText(hook, 0, Math.min(2.5, total), { fontSize: Math.round(unit * 0.085), fontWeight: 'bold', y: -Math.round(canvas.height * 0.3), color: '#ffffff' });
    if (cta) addText(cta, Math.max(0, total - 2.5), Math.min(2.5, total), { fontSize: Math.round(unit * 0.07), fontWeight: 'bold', backgroundColor: '#e4e4e7', color: '#0a0a0b', y: Math.round(canvas.height * 0.28) });
    if (lower) addText(lower, 0.5, Math.min(4, total), { fontSize: Math.round(unit * 0.045), backgroundColor: 'rgba(0,0,0,0.6)', y: Math.round(canvas.height * 0.3) });

    // 4. Captions from the transcript, mapped onto the new cuts.
    let captionCount = 0;
    if (template.captions && analysis?.transcription?.words?.length) {
        report('Adding captions', 75);
        captionCount = useTimelineStore.getState().addCaptions(mapWordsToTimeline(mediaId, analysis.transcription.words), template.captions);
    }

    // 5. Music.
    let musicNote = '';
    if (music) {
        report('Adding music', 85);
        try {
            const track = await musicApi.pickSong({ genre: music.genre, vocals: music.vocals, minSeconds: total });
            if (track) {
                const blob = await musicApi.download(track);
                const [item] = await useMediaStore.getState().addFiles([new File([blob], `${track.artist} - ${track.title}`.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60) + '.mp3', { type: 'audio/mpeg' })], projectKey);
                if (item) {
                    const store = useTimelineStore.getState();
                    const audioTrackId = store.addTrack('audio');
                    store.addElementToTrack(audioTrackId, {
                        type: 'media',
                        mediaId: item.id,
                        name: `${TEMPLATE_MUSIC}${track.title}`,
                        duration: item.duration,
                        startTime: 0,
                        trimStart: 0,
                        trimEnd: Math.max(0, item.duration - total),
                        muted: false,
                        volume: music.volume,
                        speed: 1,
                        filter: 'none',
                    });
                    musicNote = ` Music: “${track.title}” by ${track.artist}. Credit it in your caption: ${track.credit}`;
                }
            }
        } catch (error) {
            musicNote = ` Music could not be added (${(error as Error).message}).`;
        }
    }

    useTimelineStore.setState({ selected: [], history: [...historyBefore, tracksBefore].slice(-100), future: [] });
    usePlaybackStore.getState().seek(0);
    report('Done', 100);

    const parts = [`${template.name}: ${mainElements.length} cut${mainElements.length === 1 ? '' : 's'}, ${Math.round(total)}s`];
    if (captionCount) parts.push(`${captionCount} captions`);
    if (!usedAi && template.strategy !== 'even') parts.push(analysisError ? `evenly spaced (AI analysis failed: ${analysisError})` : 'evenly spaced (AI analysis needs the Nano plan)');
    return `${parts.join(', ')}.${musicNote} Ctrl+Z to undo.`;
}
