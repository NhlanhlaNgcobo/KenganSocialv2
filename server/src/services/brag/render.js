import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';

/** Step 3 of the launch-video pipeline: render the storyboard with Remotion. */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(__dirname, '../../remotion/launch/index.jsx');
const RENDER_DIR = path.join(os.tmpdir(), 'kengan-renders');
if (!fs.existsSync(RENDER_DIR)) fs.mkdirSync(RENDER_DIR, { recursive: true });

let bundlePromise = null;
function getBundle() {
    if (!bundlePromise) {
        bundlePromise = bundle({ entryPoint: ENTRY }).catch((error) => {
            bundlePromise = null;
            throw error;
        });
    }
    return bundlePromise;
}

/** Rough perceived lightness 0..1 for hex, rgb() and oklch() colours; null if unknown. */
export function lightness(color) {
    const c = String(color || '').trim().toLowerCase();
    let m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (m) {
        const hex = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
        const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    m = c.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/);
    if (m) return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
    m = c.match(/^oklch\(\s*([\d.]+)(%?)/);
    if (m) return Number(m[1]) / (m[2] ? 100 : 1);
    return null;
}

/** HSL-style saturation 0..1 for hex and rgb() colours; null if unknown. */
export function saturation(color) {
    const c = String(color || '').trim().toLowerCase();
    let rgb = null;
    const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (hex) {
        const h = hex[1].length === 3 ? hex[1].split('').map((x) => x + x).join('') : hex[1];
        rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    }
    const fn = c.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/);
    if (fn) rgb = [fn[1], fn[2], fn[3]].map((v) => Number(v) / 255);
    if (!rgb) return null;
    const max = Math.max(...rgb);
    const min = Math.min(...rgb);
    const l = (max + min) / 2;
    return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
}

const isTransparent =(c) => !c || /^rgba\([^)]*,\s*0\)$/.test(c) || c === 'transparent' || /\/\s*0\)$/.test(c);

/** Builds a palette from the site's own colours, falling back to Kengan defaults. */
export function buildPalette(colors = {}) {
    const bg = isTransparent(colors.background) ? '#ffffff' : colors.background;
    const bgL = lightness(bg) ?? 1;
    const fg = !isTransparent(colors.text) && Math.abs((lightness(colors.text) ?? (bgL > 0.5 ? 0 : 1)) - bgL) > 0.35 ? colors.text : bgL > 0.5 ? '#111114' : '#ffffff';
    let accent = [colors.accent, colors.heading].find((c) => !isTransparent(c) && c !== bg && Math.abs((lightness(c) ?? 0.5) - bgL) > 0.15);
    if (!accent) accent = '#8b5cf6';
    // Black-and-white brands look grey and flat on video: give them a dark stage and one vivid accent.
    if ((saturation(accent) ?? 0) < 0.18) return { bg: '#0b0a10', fg: '#ffffff', accent: '#8b5cf6', accentText: '#ffffff' };
    const accentText = (lightness(accent) ?? 0) > 0.6 ? '#111114' : '#ffffff';
    return { bg, fg, accent, accentText };
}

/** Captured viewport shape (width / height) per format: launch capture (inspect.js) and tutorial explore (explore.js). */
const SHOT_ASPECT = {
    launch: { landscape: 1920 / 1080, vertical: 1080 / 1920, square: 1 },
    tutorial: { landscape: 1366 / 768, vertical: 430 / 760, square: 1 },
};

/** The element a launch scene's screen acts on: a real call to action, else the main heading. */
function pickTarget(elements = [], type) {
    if (!elements.length) return null;
    const cta = elements.find((e) => e.kind === 'button' && e.priority >= 5) || elements.find((e) => e.kind === 'button');
    const heading = elements.find((e) => e.tag === 'h1') || elements.find((e) => e.kind === 'heading');
    const el = type === 'reveal' ? heading || cta : cta || heading;
    return el ? { x: el.x, y: el.y, w: el.w, h: el.h, kind: el.kind, text: el.text } : null;
}

/**
 * @param {object} opts
 * @param {'launch'|'tutorial'} opts.kind
 * @param {object} opts.music   chooseSoundtrack() result (dataUrl, beats)
 * @param {object} opts.sfx     getSfx() result
 */
export async function renderLaunchVideo({ plan, source, format, music, sfx = {}, kind = 'launch', onProgress = () => {} }) {
    const serveUrl = await getBundle();
    const host = source.url ? new URL(source.url).hostname.replace(/^www\./, '') : '';
    const scenes =
        kind === 'tutorial'
            ? plan.scenes
            : plan.scenes.map((s) => {
                  const shot = s.screenshot != null ? source.screenshots[s.screenshot] : null;
                  const target = shot && s.type !== 'hook' && s.type !== 'outro' ? pickTarget(source.shotElements?.[s.screenshot], s.type) : null;
                  return { ...s, screenshotData: shot, target };
              });
    const inputProps = {
        format,
        kind,
        tone: plan.tone,
        palette: buildPalette(source.colors),
        fontFamily: (source.fonts?.heading || source.fonts?.body || 'Inter').split(',')[0].replace(/["']/g, '').trim() || 'Inter',
        productName: plan.productName,
        host,
        iconData: source.iconData || null,
        music: music?.dataUrl || null,
        beats: music?.beats || [],
        sfx,
        shotAspect: SHOT_ASPECT[kind][format] || SHOT_ASPECT[kind].landscape,
        totalSteps: scenes.filter((s) => s.type === 'step').length,
        square: format === 'square',
        scenes,
    };

    const composition = await selectComposition({ serveUrl, id: 'LaunchVideo', inputProps, timeoutInMilliseconds: 120000 });
    const id = uuidv4();
    const outputPath = path.join(RENDER_DIR, `launch_${id}.mp4`);
    await renderMedia({
        composition,
        serveUrl,
        codec: 'h264',
        outputLocation: outputPath,
        inputProps,
        crf: 18,
        pixelFormat: 'yuv420p',
        timeoutInMilliseconds: 120000,
        onProgress: ({ progress }) => onProgress(progress),
    });

    // Poster: a settled frame of the hook (text fully in, before it leaves), per /brag's delivery rules.
    const hookFrames = Math.round(plan.scenes[0].duration * composition.fps);
    // Tutorials: a frame from the first step, mid-action; launch videos: the settled hook.
    const posterFrame =
        kind === 'tutorial' && plan.scenes[1]
            ? hookFrames + Math.round(plan.scenes[1].duration * composition.fps * 0.6)
            : Math.max(0, hookFrames - Math.round(composition.fps * 0.5));
    const posterPath = path.join(RENDER_DIR, `launch_${id}.jpg`);
    await renderStill({ composition, serveUrl, output: posterPath, inputProps, frame: Math.min(posterFrame, composition.durationInFrames - 1), imageFormat: 'jpeg', jpegQuality: 80, scale: 0.5, timeoutInMilliseconds: 120000 });

    return { outputPath, posterPath, width: composition.width, height: composition.height, durationInFrames: composition.durationInFrames, fps: composition.fps };
}
