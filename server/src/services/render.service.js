import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let bundled = null;

/**
 * Get or create the Remotion bundle (cached).
 */
async function getBundle() {
    if (bundled) return bundled;

    const entryPoint = path.join(__dirname, '../remotion/Root.jsx');

    console.log('[Remotion] Bundling compositions...');
    bundled = await bundle({
        entryPoint,
        // Enable React
        webpackOverride: (config) => config,
    });
    console.log('[Remotion] Bundle ready');

    return bundled;
}

/**
 * Render a video to vertical (9:16) format.
 * 
 * @param {object} options
 * @param {string} options.inputVideoUrl - URL or local path to the source video
 * @param {number} [options.durationInFrames] - Duration in frames (30fps)
 * @param {number} [options.startFrom] - Frame to start from
 * @param {string} [options.compositionId] - 'VerticalCrop' or 'CaptionedVideo'
 * @param {object} [options.extraProps] - Additional props for the composition
 * @returns {Promise<string>} - Path to the rendered output file
 */
export async function renderVerticalVideo(options) {
    const {
        inputVideoUrl,
        durationInFrames = 30 * 30, // default 30 seconds at 30fps
        startFrom = 0,
        compositionId = 'VerticalCrop',
        extraProps = {},
    } = options;

    const bundleLocation = await getBundle();

    const inputProps = {
        src: inputVideoUrl,
        ...extraProps,
    };

    const composition = await selectComposition({
        serveUrl: bundleLocation,
        id: compositionId,
        inputProps,
    });

    // Override duration if provided
    composition.durationInFrames = durationInFrames;

    const outputDir = path.join(os.tmpdir(), 'kengan-renders');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, `${uuidv4()}.mp4`);

    console.log(`[Remotion] Rendering ${compositionId} → ${outputPath}`);

    await renderMedia({
        composition,
        serveUrl: bundleLocation,
        codec: 'h264',
        outputLocation: outputPath,
        inputProps,
        ...(startFrom > 0 ? { frameRange: [startFrom, startFrom + durationInFrames] } : {}),
        onProgress: ({ progress }) => {
            if (Math.round(progress * 100) % 20 === 0) {
                console.log(`[Remotion] Render progress: ${Math.round(progress * 100)}%`);
            }
        },
    });

    console.log(`[Remotion] Render complete: ${outputPath}`);
    return outputPath;
}

/**
 * Quick utility to estimate frames from seconds.
 */
export function secondsToFrames(seconds, fps = 30) {
    return Math.ceil(seconds * fps);
}
