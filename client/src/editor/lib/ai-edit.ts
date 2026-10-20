/**
 * AI Edit: learn an editing style from a reference video, then edit footage in that style.
 * Server calls plus applying the returned edit plan to the timeline.
 */
import { apiClient } from '../../lib/api';
import { DEFAULT_TEXT } from '../constants';
import { useMediaStore } from '../stores/media-store';
import { useProjectStore } from '../stores/project-store';
import { useTimelineStore } from '../stores/timeline-store';
import type { AspectRatio, ColorGrade, MediaElement, TextAnimation, TextElement } from '../types';
import { generateId } from './time';
import { colorFromLegacy } from './grade';

export interface StyleProfile {
    id: string;
    name: string;
    summary: string;
    thumbnail?: string | null;
    source?: { type: 'preset' | 'link' | 'upload'; url?: string | null; title?: string | null; platform?: string | null };
    format: { ratio: AspectRatio };
    pacing: { label: 'fast' | 'medium' | 'slow'; maxPauseSec: number; avgShotSec: number; cutsPerMinute?: number };
    zooms: { punchIns: boolean; perMinute: number; amount: number; slowZoom: boolean };
    color: { look: string; stats?: Record<string, number> | null; target?: ColorGrade | null };
    captions: {
        enabled: boolean;
        y: number;
        wordsPerCaption: number;
        uppercase: boolean;
        font: string;
        size: number;
        color: string;
        highlight: string | null;
        background: boolean;
        outline: boolean;
        animation: TextAnimation;
    };
    hook: { title: boolean; coldOpen: boolean };
    callouts: { enabled: boolean; perMinute: number };
    measured?: Record<string, number | null> | null;
}

export interface EditOptions {
    ratio: 'auto' | AspectRatio;
    mode: 'full' | 'highlights';
    targetSeconds: 30 | 60 | 90;
    focus: string;
    captions: boolean;
    hook: boolean;
    zooms: boolean;
    callouts: boolean;
    colorMatch: boolean;
    removeSilence: boolean;
    removeFillers: boolean;
}

export const DEFAULT_EDIT_OPTIONS: EditOptions = {
    ratio: 'auto',
    mode: 'full',
    targetSeconds: 60,
    focus: '',
    captions: true,
    hook: true,
    zooms: true,
    callouts: true,
    colorMatch: true,
    removeSilence: true,
    removeFillers: true,
};

interface PlanText {
    content: string;
    start: number;
    end: number;
    role: 'hook' | 'callout';
    fontSize: number;
    fontFamily: string;
    color: string;
    backgroundColor: string;
    strokeColor: string;
    strokeWidth: number;
    y: number;
    animation: TextAnimation;
}

export interface EditPlan {
    ratio: AspectRatio;
    sourceDuration: number;
    duration: number;
    pieces: {
        srcStart: number;
        srcEnd: number;
        outStart: number;
        label: string;
        transform: { scale: number; x: number; y: number; animation: 'none' | 'zoom-in' | 'zoom-out'; animationAmount: number };
    }[];
    captions: {
        style: Partial<TextElement> & { y: number };
        highlightColor: string | null;
        items: { text: string; start: number; end: number; highlight: boolean }[];
    };
    titles: PlanText[];
    grade: ColorGrade | null;
    highlight: { start: number; end: number; title: string } | null;
    summary: {
        cuts: number;
        removedSec: number;
        punchIns: number;
        captions: number;
        callouts: number;
        hookTitle: string | null;
        coldOpenSec: number;
        speakers: number;
        graded: boolean;
    };
}

export interface AiEditJob {
    id: string;
    type: 'style' | 'edit';
    status: 'processing' | 'completed' | 'failed';
    stage: string;
    progress: number;
    error?: string;
    errorCode?: string;
    styleId?: string;
    plan?: EditPlan;
}

export const aiEditApi = {
    async presets(): Promise<StyleProfile[]> {
        return (await apiClient('/ai-edit/presets')).presets;
    },
    async styles(): Promise<StyleProfile[]> {
        return (await apiClient('/ai-edit/styles')).styles;
    },
    async analyzeLink(url: string): Promise<string> {
        return (await apiClient('/ai-edit/styles/analyze', { method: 'POST', body: { url } })).jobId;
    },
    async analyzeFile(file: File): Promise<string> {
        const form = new FormData();
        form.append('video', file, file.name);
        return (await apiClient('/ai-edit/styles/analyze', { method: 'POST', body: form })).jobId;
    },
    async updateStyle(id: string, patch: Partial<StyleProfile>): Promise<StyleProfile> {
        return (await apiClient(`/ai-edit/styles/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })).style;
    },
    async deleteStyle(id: string): Promise<void> {
        await apiClient(`/ai-edit/styles/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async startEdit(body: { sourceUploadId: string; styleId?: string; presetId?: string; options: EditOptions }): Promise<string> {
        return (await apiClient('/ai-edit/edits', { method: 'POST', body })).jobId;
    },
    async job(id: string): Promise<AiEditJob> {
        return (await apiClient(`/ai-edit/jobs/${encodeURIComponent(id)}`)).job;
    },
};

/** Polls a job until it completes or fails. */
export async function waitForJob(id: string, onUpdate: (job: AiEditJob) => void, signal: AbortSignal): Promise<AiEditJob> {
    for (;;) {
        if (signal.aborted) throw new Error('Cancelled');
        const job = await aiEditApi.job(id);
        onUpdate(job);
        if (job.status === 'failed') throw Object.assign(new Error(job.error || 'AI Edit failed.'), { code: job.errorCode });
        if (job.status === 'completed') return job;
        await new Promise((r) => setTimeout(r, 2500));
    }
}

/**
 * Puts the edit on the timeline: footage pieces on the main track (cuts, punch-ins, framing,
 * grade), captions on a Captions track and the hook and callouts on an "AI titles" track.
 * One undo step; everything stays editable in the manual editor.
 */
export function applyEditPlan(plan: EditPlan, mediaId: string) {
    const item = useMediaStore.getState().getItem(mediaId);
    if (!item) throw new Error('The footage is no longer in this project. Add it again.');
    const duration = item.duration || plan.sourceDuration;
    useProjectStore.getState().setRatio(plan.ratio);

    const main: MediaElement[] = plan.pieces.map((p) => ({
        id: generateId('clip'),
        type: 'media',
        mediaId,
        name: p.label,
        duration,
        startTime: p.outStart,
        trimStart: Math.max(0, p.srcStart),
        trimEnd: Math.max(0, duration - p.srcEnd),
        muted: false,
        volume: 1,
        speed: 1,
        filter: 'none',
        // The quick grade becomes Lumetri settings: exact GPU preview, editable in Colour.
        color: plan.grade ? colorFromLegacy(plan.grade) : null,
        transform: { scale: p.transform.scale, x: p.transform.x, y: p.transform.y, rotation: 0, flipH: false, flipV: false, animation: p.transform.animation, animationAmount: p.transform.animationAmount },
    }));

    const { y: captionY, ...captionStyle } = plan.captions.style;
    const captions: TextElement[] = plan.captions.items.map((c) => ({
        ...DEFAULT_TEXT,
        ...captionStyle,
        id: generateId('cap'),
        name: c.text.slice(0, 24),
        content: c.text,
        startTime: c.start,
        duration: Math.max(0.2, c.end - c.start),
        x: 0,
        y: captionY,
        color: c.highlight && plan.captions.highlightColor ? plan.captions.highlightColor : (captionStyle.color as string) || '#ffffff',
        isCaption: true,
    }));

    const titles: TextElement[] = plan.titles.map((t) => ({
        ...DEFAULT_TEXT,
        id: generateId('ttl'),
        name: t.role === 'hook' ? 'Hook title' : `Callout: ${t.content.slice(0, 16)}`,
        content: t.content,
        startTime: t.start,
        duration: Math.max(0.3, t.end - t.start),
        fontSize: t.fontSize,
        fontFamily: t.fontFamily,
        fontWeight: 'bold',
        color: t.color,
        backgroundColor: t.backgroundColor,
        strokeColor: t.strokeColor,
        strokeWidth: t.strokeWidth,
        textAlign: 'center',
        x: 0,
        y: t.y,
        animation: t.animation,
    }));

    useTimelineStore.getState().applyGeneratedEdit(main, [
        { name: 'AI titles', elements: titles },
        { name: 'Captions', elements: captions },
    ]);
}

export const formatDuration = (s: number) => {
    const total = Math.max(0, Math.round(s));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
