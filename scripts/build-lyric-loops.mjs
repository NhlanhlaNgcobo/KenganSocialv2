#!/usr/bin/env node
/**
 * Renders the lyric-video background loops (server/src/remotion/launch/LyricLoop.jsx) into
 * client/public/lyric-loops: one seamless 8-second MP4 per preset and orientation, a poster
 * frame, and manifest.json for the editor. Run when a preset changes:
 *   node scripts/build-lyric-loops.mjs            # all presets
 *   node scripts/build-lyric-loops.mjs aurora     # one preset
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(root, 'server');
const outDir = path.join(root, 'client/public/lyric-loops');
process.chdir(serverDir);
const load = (p) => import(pathToFileURL(path.join(serverDir, p)).href);
const { getBundle } = await load('src/services/brag/render.js');
const { FFMPEG } = await load('src/services/ffmpeg-runner.js');
const { renderMedia, renderStill, selectComposition } = await import(pathToFileURL(path.join(serverDir, 'node_modules/@remotion/renderer/dist/index.js')).href);

// Presets and names, read from the composition source (it is JSX, so not importable from Node).
const source = fs.readFileSync(path.join(serverDir, 'src/remotion/launch/LyricLoop.jsx'), 'utf8');
const PRESETS = [...source.matchAll(/^\s+'?([a-z-]+)'?: \{ name: '([^']+)'/gm)].map(([, id, name]) => ({ id, name }));
const only = process.argv[2];
const FORMATS = { vertical: '9:16', landscape: '16:9' };

fs.mkdirSync(outDir, { recursive: true });
const serveUrl = await getBundle();
const manifest = [];
for (const preset of PRESETS) {
    const entry = { id: preset.id, name: preset.name, seconds: 8, files: {} };
    for (const format of Object.keys(FORMATS)) {
        const base = `${preset.id}-${format}`;
        if (only && only !== preset.id) {
            // Keep files built earlier.
            if (fs.existsSync(path.join(outDir, `${base}.mp4`))) entry.files[format] = { video: `/lyric-loops/${base}.mp4`, poster: `/lyric-loops/${base}.jpg` };
            continue;
        }
        const inputProps = { preset: preset.id, format };
        const composition = await selectComposition({ serveUrl, id: 'LyricLoop', inputProps });
        const raw = path.join(outDir, `${base}.raw.mp4`);
        await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation: raw, inputProps, crf: 18, pixelFormat: 'yuv420p', concurrency: 4 });
        // Smaller file for the web: no audio, faststart, a keyframe at frame 0 so the loop seams cleanly.
        execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p', '-g', '60', '-movflags', '+faststart', path.join(outDir, `${base}.mp4`)]);
        fs.rmSync(raw, { force: true });
        await renderStill({ composition, serveUrl, inputProps, frame: 60, output: path.join(outDir, `${base}.jpg`), imageFormat: 'jpeg', jpegQuality: 78, scale: 0.25 });
        entry.files[format] = { video: `/lyric-loops/${base}.mp4`, poster: `/lyric-loops/${base}.jpg` };
        console.log('rendered', base, `${Math.round(fs.statSync(path.join(outDir, `${base}.mp4`)).size / 1024)} KB`);
    }
    manifest.push(entry);
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('wrote', path.relative(root, path.join(outDir, 'manifest.json')));
process.exit(0);
