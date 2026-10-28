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

/**
 * Remotion refuses a concurrency above the cores it can use. A CPU-capped container (the beta
 * API has 1.5 CPUs) reports 1, so a fixed 2 failed every render there.
 */
export function renderConcurrency(wanted) {
    const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
    return Math.max(1, Math.min(wanted, cores));
}

let bundlePromise = null;
/** One Remotion bundle for launch videos, tutorials and product ads. */
export function getBundle() {
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

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Where a launch scene's camera goes: the element the plan names (`focus`), else a real call to
 * action, else the main heading. A heading becomes the section it introduces (the heading and
 * what sits under it), so the zoom shows the feature, not just its title.
 */
function pickTarget(elements = [], scene) {
    if (!elements.length) return null;
    const focus = norm(scene.focus);
    const named = focus
        ? elements.find((e) => norm(e.text) === focus) || elements.find((e) => focus.length > 6 && (norm(e.text).startsWith(focus.slice(0, 40)) || focus.startsWith(norm(e.text).slice(0, 40))))
        : null;
    const cta = elements.find((e) => e.kind === 'button' && e.priority >= 5);
    const heading = elements.find((e) => e.tag === 'h1') || elements.find((e) => e.kind === 'heading' && e.y > 2 && e.y < 70);
    const el = named || (focus ? null : cta) || heading || null;
    if (!el) return null;
    if (el.kind === 'heading') {
        // At least 70% wide: the section's text and visuals usually sit beside and under its heading.
        const w = Math.min(100, Math.max(el.w + 6, 70));
        const x = Math.min(100 - w, Math.max(0, el.x + el.w / 2 - w / 2));
        const y = Math.max(0, el.y - 4);
        return { x, y, w, h: Math.min(100 - y, Math.max(el.h + 44, 40)), kind: 'region', text: el.text };
    }
    return { x: el.x, y: el.y, w: el.w, h: el.h, kind: el.kind, text: el.text };
}

/** For a product described in words only (no site to take colours from): quiet graphite and silver. */
const NEUTRAL = { bg: '#0c0c0e', fg: '#f4f4f6', accent: '#dcdce2', accent2: '#8d8d97', accentText: '#0c0c0e', monochrome: true, sources: [] };

const hasBrandSource = (source) =>
    !!(source.screenshots?.length || source.iconData || source.logoData || Object.entries(source.colors || {}).some(([k, v]) => k !== 'candidates' && v) || source.colors?.candidates?.length);

// Chrome Headless Shell sometimes takes longer than Remotion's fixed 25 s to start (a cold start,
// or antivirus scanning the browser on Windows); one more try almost always works.
const BROWSER_START = /Timed out after \d+ ms while trying to connect to the browser|Failed to launch the browser process/i;
export async function retryBrowserStart(step) {
    try {
        return await step();
    } catch (error) {
        if (!BROWSER_START.test(error?.message || '')) throw error;
        console.warn('[Brag] Chrome was slow to start; trying again.');
        return step();
    }
}

/**
 * @param {object} opts
 * @param {'launch'|'tutorial'} opts.kind
 * @param {object} opts.music   chooseSoundtrack() result (dataUrl, beats)
 * @param {object} opts.sfx     getSfx() result
 */
export async function renderLaunchVideo({ plan, source, format, music, sfx = {}, kind = 'launch', narration = null, captions = [], onProgress = () => {} }) {
    const serveUrl = await getBundle();
    const host = source.url ? new URL(source.url).hostname.replace(/^www\./, '') : '';
    const scenes =
        kind === 'tutorial'
            ? plan.scenes
            : plan.scenes.map((s) => {
                  const shot = s.screenshot != null ? source.screenshots[s.screenshot] : null;
                  const target = shot && s.type !== 'hook' && s.type !== 'outro' && s.type !== 'reveal' ? pickTarget(source.shotElements?.[s.screenshot], s) : null;
                  return { ...s, screenshotData: shot, target };
              });
    const palette = hasBrandSource(source) ? await brandPalette(source) : NEUTRAL;
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
        narration,
        captions,
        productPhotos: !!source.productPhotos,
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
    const composition = await retryBrowserStart(() => selectComposition({ serveUrl, id: 'LaunchVideo', inputProps, timeoutInMilliseconds: 120000 }));
    const id = uuidv4();
    const outputPath = path.join(RENDER_DIR, `launch_${id}.mp4`);
    await retryBrowserStart(() => renderMedia({
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
        concurrency: renderConcurrency(Number(process.env.RENDER_CONCURRENCY) || (kind === 'tutorial' ? 1 : 2)),
        onProgress: ({ progress }) => onProgress(progress),
    }));

    // Poster: a settled frame of the hook (text fully in, before it leaves), per /brag's delivery rules.
    const hookFrames = Math.round(plan.scenes[0].duration * composition.fps);
    // Tutorials: a frame from the first step, mid-action; launch videos: the settled hook.
    const posterFrame =
        kind === 'tutorial' && plan.scenes[1]
            ? hookFrames + Math.round(plan.scenes[1].duration * composition.fps * 0.6)
            : Math.max(0, hookFrames - Math.round(composition.fps * 0.5));
    const posterPath = path.join(RENDER_DIR, `launch_${id}.jpg`);
    await retryBrowserStart(() => renderStill({ composition, serveUrl, output: posterPath, inputProps, frame: Math.min(posterFrame, composition.durationInFrames - 1), imageFormat: 'jpeg', jpegQuality: 80, scale: 0.5, timeoutInMilliseconds: 120000 }));

    return { outputPath, posterPath, width: composition.width, height: composition.height, durationInFrames: composition.durationInFrames, fps: composition.fps };
}
