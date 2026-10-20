/**
 * Caption templates: how auto captions look and move. Applied to every caption on the Captions
 * track (font, colours, outline, box, animation, position, words per caption, case).
 */
import type { TextElement } from '../types';
import { TREND_CAPTIONS } from './trend-captions';

export interface CaptionTemplate {
    id: string;
    name: string;
    description?: string;
    style: Partial<TextElement>;
    /** Words per caption. */
    words: number;
    uppercase?: boolean;
    /** Vertical position, 0 = top, 1 = bottom of the canvas. */
    y: number;
    /** Colour for captions with an emphasis word (numbers, money, long key words). */
    emphasis?: string;
    /** Alternate caption colours, one per caption in turn. */
    alternate?: string[];
}

const pop = { animation: 'pop' as const };
const fade = { animation: 'fade' as const };

export const CAPTION_TEMPLATES: CaptionTemplate[] = [
    ...TREND_CAPTIONS,
    // Originals (kept for existing projects).
    { id: 'bold', name: 'Bold', style: { fontSize: 76, fontWeight: 'bold', color: '#ffffff', backgroundColor: 'transparent', fontFamily: 'Impact', strokeColor: '#000000', strokeWidth: 6, ...pop }, words: 3, y: 0.77 },
    { id: 'minimal', name: 'Minimal', style: { fontSize: 56, fontWeight: 'normal', color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.55)', fontFamily: 'Inter', strokeWidth: 0, ...fade }, words: 4, y: 0.8 },
    { id: 'karaoke', name: 'Karaoke', style: { fontSize: 72, fontWeight: 'bold', color: '#facc15', backgroundColor: 'transparent', fontFamily: 'Arial', strokeColor: '#000000', strokeWidth: 5, ...pop }, words: 3, y: 0.77 },
    { id: 'neon', name: 'Neon', style: { fontSize: 72, fontWeight: 'bold', color: '#22d3ee', backgroundColor: 'rgba(0,0,0,0.35)', fontFamily: 'Arial', strokeWidth: 0, ...pop }, words: 3, y: 0.77 },
    { id: 'impact', name: 'Impact', style: { fontSize: 88, fontWeight: 'bold', color: '#ffffff', backgroundColor: 'transparent', fontFamily: 'Impact', strokeColor: '#000000', strokeWidth: 7, ...pop }, words: 2, uppercase: true, y: 0.72 },
    { id: 'highlighter', name: 'Highlighter', style: { fontSize: 60, fontWeight: 'bold', color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.65)', fontFamily: 'Arial', strokeWidth: 0, ...fade }, words: 4, y: 0.8 },
    { id: 'accent', name: 'Accent', style: { fontSize: 64, fontWeight: 'bold', color: '#ffffff', backgroundColor: '#e04a18', fontFamily: 'Arial', strokeWidth: 0, ...pop }, words: 3, y: 0.78 },
    // 15 new templates.
    { id: 'hormozi', name: 'Hormozi', style: { fontSize: 84, fontWeight: 'bold', color: '#ffffff', backgroundColor: 'transparent', fontFamily: 'Anton', strokeColor: '#000000', strokeWidth: 8, ...pop }, words: 2, uppercase: true, y: 0.62, emphasis: '#facc15' },
    { id: 'beast', name: 'Beast', style: { fontSize: 104, fontWeight: 'bold', color: '#ffffff', backgroundColor: 'transparent', fontFamily: 'Anton', strokeColor: '#000000', strokeWidth: 10, ...pop }, words: 1, uppercase: true, y: 0.56, alternate: ['#ffffff', '#ffe600'] },
    { id: 'podcast-clean', name: 'Podcast clean', style: { fontSize: 54, fontWeight: 'bold', color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.62)', fontFamily: 'Poppins', strokeWidth: 0, ...fade }, words: 6, y: 0.86 },
    { id: 'cinema', name: 'Cinema subtitle', style: { fontSize: 48, fontWeight: 'normal', color: '#ffffff', backgroundColor: 'transparent', fontFamily: 'Inter', strokeColor: '#000000', strokeWidth: 2, animation: 'none' }, words: 7, y: 0.9 },
    { id: 'neon-pop', name: 'Neon pop', style: { fontSize: 74, fontWeight: 'bold', color: '#67e8f9', backgroundColor: 'transparent', fontFamily: 'Poppins', strokeColor: '#0e7490', strokeWidth: 5, ...pop }, words: 3, uppercase: true, y: 0.66, emphasis: '#f0abfc' },
    { id: 'yellow-box', name: 'Yellow box', style: { fontSize: 62, fontWeight: 'bold', color: '#111111', backgroundColor: '#facc15', fontFamily: 'Poppins', strokeWidth: 0, ...pop }, words: 3, uppercase: true, y: 0.7 },
    { id: 'green-flip', name: 'Green flip', style: { fontSize: 82, fontWeight: 'bold', color: '#ffffff', backgroundColor: 'transparent', fontFamily: 'Anton', strokeColor: '#000000', strokeWidth: 8, ...pop }, words: 2, uppercase: true, y: 0.6, alternate: ['#ffffff', '#4ade80'] },
    { id: 'typewriter', name: 'Typewriter', style: { fontSize: 50, fontWeight: 'bold', color: '#f5f5f4', backgroundColor: 'rgba(0,0,0,0.75)', fontFamily: 'Courier New', strokeWidth: 0, ...fade }, words: 4, y: 0.8 },
    { id: 'comic', name: 'Comic', style: { fontSize: 96, fontWeight: 'bold', color: '#fde047', backgroundColor: 'transparent', fontFamily: 'Bebas Neue', strokeColor: '#111111', strokeWidth: 9, ...pop }, words: 2, uppercase: true, y: 0.64, emphasis: '#fb7185' },
    { id: 'subtle', name: 'Subtle', style: { fontSize: 44, fontWeight: 'normal', color: '#ffffff', backgroundColor: 'transparent', fontFamily: 'Inter', strokeColor: 'rgba(0,0,0,0.6)', strokeWidth: 2, ...fade }, words: 5, y: 0.88 },
    { id: 'pink-punch', name: 'Pink punch', style: { fontSize: 76, fontWeight: 'bold', color: '#f472b6', backgroundColor: 'transparent', fontFamily: 'Poppins', strokeColor: '#000000', strokeWidth: 6, ...pop }, words: 3, uppercase: true, y: 0.66, emphasis: '#ffffff' },
    { id: 'breaking', name: 'Breaking news', style: { fontSize: 70, fontWeight: 'bold', color: '#ffffff', backgroundColor: '#dc2626', fontFamily: 'Anton', strokeWidth: 0, ...pop }, words: 3, uppercase: true, y: 0.75 },
    { id: 'storybook', name: 'Storybook', style: { fontSize: 58, fontWeight: 'normal', fontStyle: 'italic', color: '#fff7ed', backgroundColor: 'transparent', fontFamily: 'Georgia', strokeColor: 'rgba(0,0,0,0.7)', strokeWidth: 3, ...fade }, words: 5, y: 0.8 },
    { id: 'sky-flip', name: 'Sky flip', style: { fontSize: 100, fontWeight: 'bold', color: '#ffffff', backgroundColor: 'transparent', fontFamily: 'Anton', strokeColor: '#0c4a6e', strokeWidth: 9, ...pop }, words: 1, uppercase: true, y: 0.5, alternate: ['#ffffff', '#38bdf8'] },
    { id: 'heavy-outline', name: 'Heavy outline', style: { fontSize: 104, fontWeight: 'bold', color: '#ffffff', backgroundColor: 'transparent', fontFamily: 'Bebas Neue', strokeColor: '#000000', strokeWidth: 14, ...pop }, words: 2, uppercase: true, y: 0.62 },
    { id: 'top-banner', name: 'Top banner', style: { fontSize: 62, fontWeight: 'bold', color: '#ffffff', backgroundColor: 'rgba(17,17,20,0.8)', fontFamily: 'Poppins', strokeWidth: 0, ...fade }, words: 4, y: 0.18 },
];

export const CAPTION_TEMPLATE_MAP: Record<string, CaptionTemplate> = Object.fromEntries(CAPTION_TEMPLATES.map((t) => [t.id, t]));

const EMPHASIS = /(\d|\$|R\d|%|!)/;

/**
 * Caption elements' look for template `id`: the shared style plus per-caption colour
 * (alternating or emphasis), position for the canvas and case.
 */
export function captionLook(id: string, index: number, text: string, canvasHeight: number): Partial<TextElement> {
    const t = CAPTION_TEMPLATE_MAP[id] || CAPTION_TEMPLATE_MAP.bold;
    const alt = t.alternate ? t.alternate[index % t.alternate.length] : undefined;
    const emphasised = t.emphasis && (EMPHASIS.test(text) || text.split(/\s+/).some((w) => w.replace(/\W/g, '').length >= 8));
    return {
        captionMotion: undefined,
        accentColor: undefined,
        ...t.style,
        ...(alt ? { color: alt } : {}),
        ...(emphasised ? { color: t.emphasis } : {}),
        y: Math.round((t.y - 0.5) * canvasHeight),
        textAlign: 'center',
    };
}

export const captionText = (id: string, text: string) => (CAPTION_TEMPLATE_MAP[id]?.uppercase ? text.toUpperCase().replace(/[.,;:]+(\s|$)/g, '$1').trim() : text);
