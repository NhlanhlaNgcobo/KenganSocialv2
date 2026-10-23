import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { getBundle, retryBrowserStart } from '../brag/render.js';

const RENDER_DIR = path.join(os.tmpdir(), 'kengan-renders');

/**
 * Renders a product ad (remotion/launch/ProductAd.jsx).
 * @param {object} opts
 * @param {object} opts.draft    prepareDraft() result
 * @param {object} opts.settings normalizeRender() result
 * @param {string|null} opts.music      mp3 data URL
 * @param {number[]} opts.beats         beat times in the music (seconds)
 * @param {string|null} opts.narration  mp3 data URL
 * @param {object[]} opts.captions
 * @param {Record<string,string>} opts.sfx  getSfx() result
 */
export async function renderProductAd({ draft, settings, music = null, beats = [], narration = null, captions = [], sfx = {}, onProgress = () => {} }) {
    const serveUrl = await getBundle();
    const { input } = draft;
    const inputProps = {
        format: input.format,
        preset: input.preset,
        seconds: input.duration,
        palette: draft.palette,
        fontFamily: draft.fontFamily,
        name: input.name,
        tagline: input.tagline,
        points: input.points,
        offer: input.offer,
        cta: input.cta,
        website: input.website,
        photos: draft.photos,
        music,
        narration,
        captions: settings.captions ? captions : [],
        sfx,
        sfxOn: settings.sfx !== false,
        beats,
    };
    const composition = await retryBrowserStart(() => selectComposition({ serveUrl, id: 'ProductAd', inputProps, timeoutInMilliseconds: 120000 }));
    const id = randomUUID();
    const outputPath = path.join(RENDER_DIR, `product_${id}.mp4`);
    await retryBrowserStart(() =>
        renderMedia({
            composition,
            serveUrl,
            codec: 'h264',
            outputLocation: outputPath,
            inputProps,
            crf: 18,
            pixelFormat: 'yuv420p',
            timeoutInMilliseconds: 120000,
            concurrency: Number(process.env.RENDER_CONCURRENCY) || 2,
            onProgress: ({ progress }) => onProgress(progress),
        })
    );
    // Poster: the hero angle settled after the intro.
    const posterPath = path.join(RENDER_DIR, `product_${id}.jpg`);
    const frame = Math.min(composition.durationInFrames - 1, Math.round(composition.fps * 2.4));
    await retryBrowserStart(() => renderStill({ composition, serveUrl, output: posterPath, inputProps, frame, imageFormat: 'jpeg', jpegQuality: 80, scale: 0.5, timeoutInMilliseconds: 120000 }));
    return { outputPath, posterPath, width: composition.width, height: composition.height };
}
