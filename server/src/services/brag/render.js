import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { brandPalette } from './brand-colors.js';

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
    const palette = await brandPalette(source);
    console.log('[Brag] Brand palette:', JSON.stringify({ ...palette, sources: palette.sources.slice(0, 4) }));
    const inputProps = {
        format,
        kind,
        tone: plan.tone,
        palette,
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

    const mb = (v) => (JSON.stringify(v ?? null).length / 1048576).toFixed(1);
    console.log(
        `[Brag] Render input ${mb(inputProps)} MB (scenes ${mb(scenes)}, music ${mb(inputProps.music)}, sfx ${mb(sfx)}, icon ${mb(inputProps.iconData)})`
    );
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
        // Tutorial frames hold full-page app screenshots; rendering several tabs at once can exhaust
        // Chrome's memory ("Target closed" / ERR_INSUFFICIENT_RESOURCES), so they render one tab at a time.
        // RENDER_CONCURRENCY overrides both.
        concurrency: Number(process.env.RENDER_CONCURRENCY) || (kind === 'tutorial' ? 1 : 2),
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
