import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { FFMPEG, probe, run } from '../ffmpeg-runner.js';
import { enhanceVideo } from '../video-enhance.service.js';
import { buildAss, CAPTION_TEMPLATES, templateAccent } from './caption-templates.js';
import { DEFAULT_SAFE, PLATFORMS } from './platforms.js';

/**
 * Renders one clip: cut from the source → reframe to the target ratio with a face-aware
 * layout → one FFmpeg pass that sizes the frame, burns in the caption template and hook
 * card (libass) and draws the progress bar.
 */

const RENDER_DIR = path.join(os.tmpdir(), 'kengan-renders');
const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts');

export const RATIOS = {
    '9:16': { width: 1080, height: 1920 },
    '1:1': { width: 1080, height: 1080 },
    '16:9': { width: 1920, height: 1080 },
};

/** Kept under the old name: the clips API calls these caption styles. */
export const CAPTION_STYLES = CAPTION_TEMPLATES;

export const LAYOUTS = {
    auto: { label: 'Auto', description: 'Stacks two speakers, otherwise follows the main face' },
    track: { label: 'Follow face', description: 'One crop that follows whoever is on screen' },
    split: { label: 'Split speakers', description: 'Two people side by side, stacked top and bottom' },
    fit: { label: 'Full frame', description: 'The whole shot over a blurred background' },
};

/** Path for FFmpeg filter options (drive colons and quotes escaped). */
function filterPath(p) {
    return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");
}

async function cut(sourcePath, start, end, outPath) {
    await run(FFMPEG, [
        '-hide_banner', '-y',
        '-ss', start.toFixed(3), '-i', sourcePath, '-t', (end - start).toFixed(3),
        '-map', '0:v:0', '-map', '0:a?',
        // Clips are at most 1080x1920: a 4K source is cut at up to 1440p (a 9:16 crop of 1440p
        // landscape still has 810 px of width), which made each 4K clip several minutes faster on
        // the beta server. Smaller sources keep their size.
        '-vf', "scale='if(gte(iw,ih),min(2560,trunc(iw/2)*2),-2)':'if(gte(iw,ih),-2,min(2560,trunc(ih/2)*2))'",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart', outPath,
    ]);
    return outPath;
}

async function poster(videoPath, at) {
    const out = path.join(RENDER_DIR, `poster_${uuidv4()}.jpg`);
    try {
        await run(FFMPEG, ['-hide_banner', '-y', '-ss', at.toFixed(2), '-i', videoPath, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', out]);
        return `data:image/jpeg;base64,${fs.readFileSync(out).toString('base64')}`;
    } catch {
        return null;
    } finally {
        fs.rm(out, { force: true }, () => {});
    }
}

/** Final pass: cover-scale to the output size, burn captions, draw the progress bar. */
async function finish({ framedPath, workDir, ass, width: W, height: H, length, progressBar, accent, logoPath = null, safe, onProgress }) {
    const chain = [`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30`];
    if (ass) {
        fs.writeFileSync(path.join(workDir, 'captions.ass'), ass, 'utf8');
        chain.push(`subtitles=filename=captions.ass:fontsdir='${filterPath(FONTS_DIR)}'`);
    }
    let graph = `${chain.join(',')}[base]`;
    let last = '[base]';
    if (progressBar) {
        const barH = Math.max(6, Math.round(Math.min(W, H) * 0.011));
        const color = `0x${accent.replace('#', '')}`;
        graph += `;color=c=${color}:s=${W}x${barH}:r=30:d=${length.toFixed(3)}[bar];[base][bar]overlay=x='-w+w*t/${length.toFixed(3)}':y=${H - barH}:eof_action=pass[v]`;
        last = '[v]';
    }
    const inputs = ['-i', framedPath];
    if (logoPath) {
        // Brand logo in the top-right corner, below the app's own top bar (safe zone).
        const logoW = Math.round(Math.min(W, H) * 0.16);
        const margin = Math.round(Math.min(W, H) * 0.04);
        const y = Math.round(H * Math.max(0.04, (safe?.safeTop || 0.1) * 0.55));
        inputs.push('-i', logoPath);
        graph += `;[1:v]scale=${logoW}:-1,format=rgba,colorchannelmixer=aa=0.92[logo];${last}[logo]overlay=x=W-w-${margin}:y=${y}[vl]`;
        last = '[vl]';
    }
    const outPath = path.join(RENDER_DIR, `export_${uuidv4()}.mp4`);
    await run(
        FFMPEG,
        [
            '-hide_banner', '-y', ...inputs,
            '-filter_complex', graph,
            '-map', last, '-map', '0:a:0?',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
            '-t', length.toFixed(3), '-movflags', '+faststart',
            '-progress', 'pipe:1', '-nostats', outPath,
        ],
        { cwd: workDir, duration: length, onProgress }
    );
    return outPath;
}

/**
 * @param {object} opts
 * @param {string} opts.layout         auto | track | split | fit
 * @param {string} opts.captionStyle   CAPTION_TEMPLATES id
 * @param {string|null} opts.platform  tiktok | shorts | reels (sets the UI safe zones)
 * @param {object|null} opts.brand     loadClipBrand() result: { accent, logoPath }
 * @returns {Promise<{ outputPath: string, poster: string|null, reframe: string, layout: string }>}
 */
export async function renderClip({
    sourcePath, clip, words, ratio, layout = 'auto', captionStyle, hookTitle, progressBar = false, platform = null, brand = null, onProgress = () => {},
}) {
    const spec = RATIOS[ratio] || RATIOS['9:16'];
    fs.mkdirSync(RENDER_DIR, { recursive: true });
    const workDir = fs.mkdtempSync(path.join(RENDER_DIR, 'clip-'));
    const cutPath = path.join(workDir, 'cut.mp4');
    const temp = [];
    try {
        await cut(sourcePath, clip.start, clip.end, cutPath);
        onProgress(20);

        const info = await probe(cutPath);
        const length = info.duration || clip.end - clip.start;
        const sourceAspect = info.width && info.height ? info.width / info.height : spec.width / spec.height;
        const targetAspect = spec.width / spec.height;

        let framedPath = cutPath;
        let reframe = 'none';
        let usedLayout = 'none';
        if (Math.abs(sourceAspect - targetAspect) > 0.02) {
            try {
                const { outputPath, summary } = await enhanceVideo({
                    inputPath: cutPath,
                    stabilize: null,
                    autoframe: { ratio, layout: LAYOUTS[layout] ? layout : 'auto' },
                    onProgress: (p) => onProgress(20 + Math.round((p / 100) * 40)),
                });
                framedPath = outputPath;
                temp.push(outputPath);
                usedLayout = summary.autoframe?.applied ? summary.autoframe.layout || 'track' : 'centre';
                reframe = usedLayout === 'track' ? 'tracked' : usedLayout;
            } catch (error) {
                // The video service is down: the final pass centre-crops instead.
                console.warn('[Clips] Auto-frame skipped:', error.message);
            }
            if (framedPath === cutPath) reframe = usedLayout = 'centre';
        }
        onProgress(60);

        const safe = PLATFORMS[platform] || (ratio === '16:9' ? { safeTop: 0.06, safeBottom: 0.1 } : DEFAULT_SAFE);
        const ass = buildAss({
            words,
            clip,
            length,
            width: spec.width,
            height: spec.height,
            template: captionStyle,
            hookTitle,
            // On a split layout the seam between the two speakers is the one place without a face.
            position: usedLayout === 'split' ? 'middle' : 'bottom',
            safe,
            brand,
        });
        const outputPath = await finish({
            framedPath,
            workDir,
            ass,
            width: spec.width,
            height: spec.height,
            length,
            progressBar,
            accent: brand?.accent || templateAccent(captionStyle),
            logoPath: brand?.logoPath || null,
            safe,
            onProgress: (f) => onProgress(60 + Math.round(f * 38)),
        });
        const posterUrl = await poster(outputPath, Math.min(1.2, length / 2));
        onProgress(100);
        return { outputPath, poster: posterUrl, reframe, layout: usedLayout };
    } finally {
        for (const file of temp) fs.rm(file, { force: true }, () => {});
        fs.rm(workDir, { recursive: true, force: true }, () => {});
    }
}
