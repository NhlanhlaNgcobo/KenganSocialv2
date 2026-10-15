import { Instagram, Music2, SlidersHorizontal, Youtube } from 'lucide-react';

/**
 * Options shared by every long video → shorts entry point (Clips, Repurpose).
 * Mirrors the server options in server/src/services/clips (platforms.js, render-clip.js,
 * caption-templates.js).
 */

export const SHORT_PLATFORMS = [
    { id: 'tiktok', label: 'TikTok', icon: Music2, hint: '9:16, captions kept above the TikTok caption bar', maxLength: 'long', calendar: 'tiktok' },
    { id: 'shorts', label: 'YouTube Shorts', icon: Youtube, hint: '9:16, up to 60 seconds', maxLength: 'medium', calendar: 'youtube' },
    { id: 'reels', label: 'Instagram Reels', icon: Instagram, hint: '9:16, captions kept clear of the Reels buttons', maxLength: 'long', calendar: 'instagram' },
    { id: 'custom', label: 'Other format', icon: SlidersHorizontal, hint: 'Pick the shape yourself (square, landscape)', maxLength: 'long' },
];

export const SHORT_LENGTHS = [
    { id: 'short', label: '15–30s' },
    { id: 'medium', label: '30–60s' },
    { id: 'long', label: '60–90s' },
];

export const RATIOS = [
    { id: '9:16', hint: 'Vertical' },
    { id: '1:1', hint: 'Square feed' },
    { id: '16:9', hint: 'Landscape' },
];

export const LAYOUTS = [
    { id: 'auto', label: 'Auto', description: 'Stacks two speakers, otherwise follows the main face' },
    { id: 'track', label: 'Follow face', description: 'One crop that follows whoever is on screen' },
    { id: 'split', label: 'Split speakers', description: 'Two people side by side, stacked top and bottom' },
    { id: 'fit', label: 'Full frame', description: 'The whole shot over a blurred background' },
];

/** Preview looks for each caption template (the real render uses libass on the server). */
export const CAPTION_TEMPLATES = [
    { id: 'bold', label: 'Bold Pop', font: "'Kengan Poppins', sans-serif", weight: 900, upper: true, color: '#fff', active: '#ffe11a', stroke: '#000' },
    { id: 'impact', label: 'Impact', font: "'Kengan Anton', sans-serif", weight: 400, upper: true, color: '#fff', active: '#2bd86b', stroke: '#000' },
    { id: 'punch', label: 'One Word', font: "'Kengan Anton', sans-serif", weight: 400, upper: true, color: '#fff', stroke: '#000', single: true },
    { id: 'karaoke', label: 'Karaoke Fill', font: "'Kengan Poppins', sans-serif", weight: 900, upper: true, color: '#fff', active: '#ffcc00', stroke: '#000', fill: true },
    { id: 'highlighter', label: 'Highlighter', font: "'Kengan Poppins', sans-serif", weight: 700, color: '#fff', active: '#ff7a3d', box: 'rgba(0,0,0,0.65)' },
    { id: 'neon', label: 'Neon', font: "'Kengan Bebas', sans-serif", weight: 400, upper: true, color: '#bff7ff', active: '#fff', glow: '#00d4ff' },
    { id: 'accent', label: 'Accent', font: "'Kengan Poppins', sans-serif", weight: 700, color: '#fff', box: '#e04a18' },
    { id: 'clean', label: 'Clean', font: "'Kengan Poppins', sans-serif", weight: 700, color: '#fff', shadow: true },
    { id: 'none', label: 'No captions' },
];

export const DEFAULT_SHORTS_OPTIONS = {
    platform: null,
    count: 5,
    length: 'short',
    ratio: '9:16',
    layout: 'auto',
    captionStyle: 'bold',
    hookTitle: true,
    progressBar: false,
};

/** The request body fields the clips API expects. */
export function shortsRequest(options) {
    const custom = options.platform === 'custom';
    return {
        platform: custom ? null : options.platform,
        count: options.count,
        length: options.length,
        ratio: custom ? options.ratio : '9:16',
        layout: options.layout,
        captionStyle: options.captionStyle,
        hookTitle: options.hookTitle,
        progressBar: options.progressBar,
    };
}

