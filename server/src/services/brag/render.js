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

const isTransparent = (c) => !c || /^rgba\([^)]*,\s*0\)$/.test(c) || c === 'transparent' || /\/\s*0\)$/.test(c);

/** Builds a palette from the site's own colours, falling back to Kengan defaults. */
export function buildPalette(colors = {}) {
    const bg = isTransparent(colors.background) ? '#ffffff' : colors.background;
    const bgL = lightness(bg) ?? 1;
    const fg = !isTransparent(colors.text) && Math.abs((lightness(colors.text) ?? (bgL > 0.5 ? 0 : 1)) - bgL) > 0.35 ? colors.text : bgL > 0.5 ? '#111114' : '#ffffff';
    let accent = [colors.accent, colors.heading].find((c) => !isTransparent(c) && c !== bg && Math.abs((lightness(c) ?? 0.5) - bgL) > 0.15);
    if (!accent) accent = '#e04a18';
    const accentText = (lightness(accent) ?? 0) > 0.6 ? '#111114' : '#ffffff';
    return { bg, fg, accent, accentText };
}

export async function renderLaunchVideo({ plan, source, format, music, onProgress = () => {} }) {
    const serveUrl = await getBundle();
    const host = source.url ? new URL(source.url).hostname.replace(/^www\./, '') : '';
    const inputProps = {
        format,
        tone: plan.tone,
        palette: buildPalette(source.colors),
        fontFamily: (source.fonts?.heading || source.fonts?.body || 'Inter').split(',')[0].replace(/["']/g, '').trim() || 'Inter',
        productName: plan.productName,
        host,
        iconData: source.iconData || null,
        music: music?.dataUrl || null,
        scenes: plan.scenes.map((s) => ({ ...s, screenshotData: s.screenshot != null ? source.screenshots[s.screenshot] : null })),
    };

    const composition = await selectComposition({ serveUrl, id: 'LaunchVideo', inputProps });
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
        timeoutInMilliseconds: 60000,
        onProgress: ({ progress }) => onProgress(progress),
    });

    // Poster: a settled frame of the hook (text fully in, before it leaves), per /brag's delivery rules.
    const hookFrames = Math.round(plan.scenes[0].duration * composition.fps);
    const posterPath = path.join(RENDER_DIR, `launch_${id}.jpg`);
    await renderStill({ composition, serveUrl, output: posterPath, inputProps, frame: Math.max(0, hookFrames - Math.round(composition.fps * 0.5)), imageFormat: 'jpeg', jpegQuality: 80, scale: 0.5 });

    return { outputPath, posterPath, width: composition.width, height: composition.height, durationInFrames: composition.durationInFrames, fps: composition.fps };
}
