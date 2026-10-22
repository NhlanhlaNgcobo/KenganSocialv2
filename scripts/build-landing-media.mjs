// Builds the landing page's real footage (client/public/landing): Pexels sample videos run through
// KenganSocial's own clip renderer (face framing, captions, hook card). Needs FFmpeg, the video
// service (for face framing) and network access to Pexels. Run from server/:
//   npx tsx ../scripts/build-landing-media.mjs <workDir> ../client/public/landing
// Pexels licence: free for commercial use, no attribution needed; people shown must not appear to
// endorse KenganSocial (the landing page labels the footage as sample footage).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const [stock, out] = process.argv.slice(2);
if (!stock || !out) {
    console.error('Usage: npx tsx ../scripts/build-landing-media.mjs <workDir> <outDir>');
    process.exit(2);
}
fs.mkdirSync(stock, { recursive: true });
fs.mkdirSync(out, { recursive: true });

// Pexels videos used (pexels.com/video/<id>): two hosts at a desk (two camera angles), a host,
// a host reading, a creator with a mic (vertical).
const PEXELS = ['37874129', '37874132', '38630316', '37874094', '6892735'];
for (const id of PEXELS) {
    const file = path.join(stock, `p${id}.mp4`);
    if (fs.existsSync(file)) continue;
    const res = await fetch(`https://www.pexels.com/download/video/${id}/`, { headers: { 'User-Agent': 'Mozilla/5.0 KenganSocial landing media' } });
    if (!res.ok) throw new Error(`Pexels video ${id}: HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log(`downloaded ${id}`);
}
const work = path.join(stock, 'work');
fs.mkdirSync(work, { recursive: true });
const ff = (args) => {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
    if (r.status) throw new Error(r.stderr);
};
const size = (f) => `${Math.round(fs.statSync(f).size / 1024)} KB`;

// Sources at 1080p, cut to the part used. The studio's neon sign (a third-party name) is blurred.
function source(id, from, len, { vertical = false, blurSign = false } = {}) {
    const dst = path.join(work, `src_${id}.mp4`);
    if (fs.existsSync(dst)) return dst;
    const scale = vertical ? 'scale=1080:-2' : 'scale=1920:-2';
    // The neon "#StoryEla" sign behind the hosts: x 810-1070, y 440-505 at 1920x1080.
    const graph = blurSign ? `[0:v]${scale},split[a][b];[b]crop=300:100:795:425,boxblur=16:3[sb];[a][sb]overlay=795:425[v]` : `[0:v]${scale}[v]`;
    ff(['-ss', String(from), '-t', String(len), '-i', path.join(stock, `p${id}.mp4`), '-f', 'lavfi', '-t', String(len), '-i', 'anullsrc=r=48000:cl=stereo', '-filter_complex', graph, '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', dst]);
    return dst;
}

/** Web loop: muted H.264, small, starts instantly. */
function webLoop(input, name, { width, from = 0, len, fps = 24, crf = 30 }) {
    const mp4 = path.join(out, `${name}.mp4`);
    ff(['-ss', String(from), ...(len ? ['-t', String(len)] : []), '-i', input, '-an', '-vf', `scale=${width}:-2,fps=${fps}`, '-c:v', 'libx264', '-profile:v', 'main', '-crf', String(crf), '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
    const jpg = path.join(out, `${name}.jpg`);
    ff(['-ss', String(Math.min(1.2, (len || 4) / 2)), '-i', mp4, '-frames:v', '1', '-q:v', '4', '-update', '1', jpg]);
    console.log(`${name}: ${size(mp4)} video, ${size(jpg)} poster`);
}

function still(input, name, at, width) {
    const jpg = path.join(out, `${name}.jpg`);
    ff(['-ss', String(at), '-i', input, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', '-update', '1', jpg]);
    console.log(`${name}: ${size(jpg)}`);
}

const words = (text, start = 0.25, step = 0.36) =>
    text.split(' ').map((t, i) => ({ text: t, start: start + i * step, end: start + i * step + step * 0.9 }));

const { renderClip } = await import(pathToFileURL(path.resolve('src/services/clips/render-clip.js')).href);
// The launch card's clip (launch.mp4) is a launch video made in the app (Launch video > Describe it).

async function clip(name, src, { layout, captionStyle, hook, line, len = 6, platform = 'tiktok' }) {
    const r = await renderClip({
        sourcePath: src,
        clip: { start: 0, end: len, hook },
        words: words(line),
        ratio: '9:16',
        layout,
        captionStyle,
        hookTitle: Boolean(hook),
        progressBar: true,
        platform,
    });
    console.log(`${name}: framed ${r.reframe} (${r.layout})`);
    webLoop(r.outputPath, name, { width: 360, len });
}

// 1. The long "podcast" source (two hosts), wide.
const studio = source('37874129', 8, 7, { blurSign: true });
webLoop(studio, 'studio-wide', { width: 960, len: 6, crf: 31 });
still(studio, 'studio-still', 2, 1280);

// 2. Real outputs of the clip engine.
await clip('clip-split', studio, { layout: 'split', captionStyle: 'bold', hook: 'Nobody saw this coming', line: 'we almost quit before the first episode went live and then everything changed' });
const host = source('38630316', 2, 7);
await clip('clip-track', host, { layout: 'track', captionStyle: 'highlighter', hook: '', line: 'the one habit that doubled our audience in a month', platform: 'reels' });
const reader = source('37874094', 6, 7);
await clip('clip-karaoke', reader, { layout: 'track', captionStyle: 'karaoke', hook: 'Read this before you post', line: 'nobody tells you this about starting a podcast', platform: 'shorts' });
const creator = source('6892735', 8, 7, { vertical: true });
await clip('clip-neon', creator, { layout: 'fit', captionStyle: 'neon', hook: '', line: 'this mic changed how my whole show sounds' });

// 3. Thumbnails for "moments" (16:9 frames from the source at different times) and caption backdrop.
still(studio, 'moment-1', 1.0, 320);
still(source('37874132', 14, 6, { blurSign: true }), 'moment-2', 2.5, 320);
still(host, 'moment-3', 4.5, 320);
webLoop(host, 'captions-bg', { width: 960, len: 6, crf: 32 });
console.log('done');
process.exit(0);
