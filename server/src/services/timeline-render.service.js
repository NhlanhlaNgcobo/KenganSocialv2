import fs from 'fs';
import { buildTextAss, FONTS_DIR } from './timeline-text-ass.js';
import { effectFilters, gradeFilters, LOOKS, normalizeEffects, normalizeGrade, normalizeTransition, TRANSITIONS } from './timeline-fx.js';
import crypto from 'crypto';
import sharp from 'sharp';
import { buildLut, isNeutralColor, lutToCube, normalizeColor, vignetteAt } from './color-pipeline.js';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { FFMPEG, probe, run } from './ffmpeg-runner.js';
import { getUploadPath } from './manual-edit.service.js';
import { CAPTION_MOTIONS, TEXT_ANIMATIONS } from './caption-motion.js';

/**
 * Renders a multi-track editor timeline (edit config v2) to a single MP4.
 *
 * Pass 1 builds the main track as uniform segments (clips, stills and background
 * gaps) and concatenates them. Pass 2 composites overlay tracks, burns in text and
 * mixes audio tracks on top, all at timeline time.
 *
 * Sources are only ever resolved from server-side upload IDs owned by the caller;
 * user text reaches FFmpeg through files, never inline in the filter graph.
 */

const RENDER_DIR = path.join(os.tmpdir(), 'kengan-renders');
if (!fs.existsSync(RENDER_DIR)) fs.mkdirSync(RENDER_DIR, { recursive: true });

export const EXPORT_PRESETS = {
    tiktok: { width: 1080, height: 1920 },
    reels: { width: 1080, height: 1920 },
    instagram: { width: 1080, height: 1080 },
    youtube: { width: 1920, height: 1080 },
};

const FILTER_PRESETS = LOOKS;

const LIMITS = {
    maxDuration: 3 * 60 * 60,
    maxMain: 2500,
    maxOverlays: 40,
    maxAudio: 40,
    maxText: 4000,
    maxTextLength: 500,
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

class RenderInputError extends Error {
    constructor(message) {
        super(message);
        this.status = 400;
    }
}

const num = (value, fallback, min = -Infinity, max = Infinity) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
};

/** Accepts #rgb, #rrggbb, rgb()/rgba() and 'transparent'. Returns { hex, alpha } or null. */
export function parseColor(input) {
    if (typeof input !== 'string') return null;
    const value = input.trim().toLowerCase();
    if (value === 'transparent') return { hex: '000000', alpha: 0 };
    let m = value.match(/^#([0-9a-f]{3})$/);
    if (m) return { hex: m[1].split('').map((c) => c + c).join(''), alpha: 1 };
    m = value.match(/^#([0-9a-f]{6})$/);
    if (m) return { hex: m[1], alpha: 1 };
    m = value.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/);
    if (m) {
        const hex = [m[1], m[2], m[3]].map((c) => Math.min(255, Number(c)).toString(16).padStart(2, '0')).join('');
        return { hex, alpha: m[4] === undefined ? 1 : num(m[4], 1, 0, 1) };
    }
    return null;
}

function resolveSource(source, ownerId) {
    if (typeof source !== 'string' || !source) throw new RenderInputError('Every clip needs an uploaded source.');
    const filePath = getUploadPath(source, ownerId);
    if (!filePath || !fs.existsSync(filePath)) {
        throw new RenderInputError(`Source not found for upload ID: ${source}. Upload the media again.`);
    }
    return filePath;
}

/** Clip framing from the editor; null when it changes nothing. */
function normalizeTransform(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const t = {
        scaleStart: num(raw.scaleStart, 1, 0.1, 4),
        scaleEnd: num(raw.scaleEnd, num(raw.scaleStart, 1, 0.1, 4), 0.1, 4),
        xEnd: num(raw.xEnd, num(raw.x, 0, -5000, 5000), -5000, 5000),
        yEnd: num(raw.yEnd, num(raw.y, 0, -5000, 5000), -5000, 5000),
        x: num(raw.x, 0, -5000, 5000),
        y: num(raw.y, 0, -5000, 5000),
        rotation: num(raw.rotation, 0, -360, 360),
        flipH: !!raw.flipH,
        flipV: !!raw.flipV,
    };
    const identity = t.scaleStart === 1 && t.scaleEnd === 1 && !t.x && !t.y && !t.xEnd && !t.yEnd && !t.rotation && !t.flipH && !t.flipV;
    return identity ? null : t;
}

function normalizeMedia(item, ownerId) {
    const kind = ['video', 'image', 'audio'].includes(item?.kind) ? item.kind : 'video';
    const speed = num(item.speed, 1, 0.25, 4);
    const sourceStart = num(item.sourceStart, 0, 0);
    let sourceEnd = num(item.sourceEnd, sourceStart + 1, 0);
    if (sourceEnd <= sourceStart) sourceEnd = sourceStart + 0.1;
    const timelineStart = num(item.timelineStart, 0, 0, LIMITS.maxDuration);
    const length = kind === 'image' ? num(item.timelineEnd, timelineStart + 5, 0) - timelineStart : (sourceEnd - sourceStart) / speed;
    return {
        path: resolveSource(item.source, ownerId),
        kind,
        speed: kind === 'image' ? 1 : speed,
        sourceStart,
        sourceEnd,
        timelineStart,
        length: Math.max(0.05, Math.min(length, LIMITS.maxDuration)),
        volume: num(item.volume, 1, 0, 2),
        filter: FILTER_PRESETS[item.filter] ? item.filter : 'none',
        grade: normalizeGrade(item.grade),
        transform: normalizeTransform(item.transform),
        effects: normalizeEffects(item.effects),
        transitionIn: normalizeTransition(item.transitionIn),
        color: item.color && typeof item.color === 'object' ? normalizeColor(item.color) : null,
    };
}

function normalizeText(item) {
    const content = String(item?.content ?? '').slice(0, LIMITS.maxTextLength);
    const timelineStart = num(item.timelineStart, 0, 0, LIMITS.maxDuration);
    const timelineEnd = num(item.timelineEnd, timelineStart + 3, timelineStart + 0.05, LIMITS.maxDuration);
    if ([...CAPTION_MOTIONS, ...TEXT_ANIMATIONS.map((a) => a.id)].includes(item.captionMotion) && num(item.captionDuration, timelineEnd - timelineStart, 0.05, 600) > 30) {
        throw new RenderInputError('Animated captions must be 30 seconds or shorter. Split the caption first.');
    }
    return {
        content,
        timelineStart,
        timelineEnd,
        fontSize: Math.round(num(item.fontSize, 64, 8, 400)),
        fontFamily: typeof item.fontFamily === 'string' ? item.fontFamily : 'Arial',
        color: parseColor(item.color) || { hex: 'ffffff', alpha: 1 },
        background: parseColor(item.backgroundColor) || { hex: '000000', alpha: 0 },
        bold: !!item.bold,
        align: ['left', 'center', 'right'].includes(item.align) ? item.align : 'center',
        x: num(item.x, 0, -5000, 5000),
        y: num(item.y, 0, -5000, 5000),
        opacity: num(item.opacity, 1, 0, 1),
        rotation: num(item.rotation, 0, -360, 360),
        stroke: { color: parseColor(item.strokeColor) || { hex: '000000', alpha: 0 }, width: Math.round(num(item.strokeWidth, 0, 0, 40)) },
        animation: ['fade', 'pop'].includes(item.animation) ? item.animation : 'none',
        captionMotion: [...CAPTION_MOTIONS, ...TEXT_ANIMATIONS.map((a) => a.id)].includes(item.captionMotion) ? item.captionMotion : null,
        captionWords: Array.isArray(item.captionWords) ? item.captionWords.slice(0, 100).map((w) => ({
            text: String(w?.text ?? '').slice(0, 100),
            start: num(w?.start, 0, 0, 600),
            end: num(w?.end, 0, 0, 600),
        })) : [],
        captionOffset: num(item.captionOffset, 0, 0, 600),
        captionDuration: num(item.captionDuration, timelineEnd - timelineStart, 0.05, 600),
        accentColor: parseColor(item.accentColor) || { hex: 'a3e635', alpha: 1 },
    };
}

export function normalizeTimelineConfig(config, ownerId) {
    if (!config || config.version !== 2) throw new RenderInputError('Unsupported edit config version.');
    const preset = EXPORT_PRESETS[config.exportFormat] || EXPORT_PRESETS.tiktok;
    const fps = Math.round(num(config.fps, 30, 12, 60));
    const background = parseColor(config.backgroundColor) || { hex: '000000', alpha: 1 };

    const list = (value, max, label) => {
        if (value === undefined) return [];
        if (!Array.isArray(value)) throw new RenderInputError(`${label} must be a list.`);
        if (value.length > max) throw new RenderInputError(`Too many ${label} items (max ${max}).`);
        return value;
    };

    const mainRaw = list(config.main, LIMITS.maxMain, 'main track');
    const main = [];
    const audio = list(config.audio, LIMITS.maxAudio, 'audio').map((a) => normalizeMedia(a, ownerId));
    for (const item of mainRaw) {
        const media = normalizeMedia(item, ownerId);
        // Audio files never belong on the picture track; mix them instead.
        if (media.kind === 'audio') audio.push(media);
        else main.push(media);
    }
    const overlays = list(config.overlays, LIMITS.maxOverlays, 'overlay')
        .map((o) => normalizeMedia(o, ownerId))
        .filter((o) => o.kind !== 'audio');
    const text = list(config.text, LIMITS.maxText, 'text')
        .map(normalizeText)
        .filter((t) => t.content.trim().length > 0);

    const ends = [
        ...main.map((m) => m.timelineStart + m.length),
        ...overlays.map((m) => m.timelineStart + m.length),
        ...audio.map((m) => m.timelineStart + m.length),
        ...text.map((t) => t.timelineEnd),
    ];
    const duration = Math.min(LIMITS.maxDuration, Math.max(num(config.duration, 0, 0), ...ends, 0));
    if (duration <= 0.05) throw new RenderInputError('The timeline is empty.');

    // Imported .cube LUTs referenced by clips (creative.look = 'lut:<id>'), as { size, data: [r,g,b,...] }.
    const luts = {};
    for (const [id, lut] of Object.entries(config.luts && typeof config.luts === 'object' ? config.luts : {}).slice(0, 20)) {
        const size = Math.round(Number(lut?.size));
        if (!/^[\w-]{1,64}$/.test(id) || !(size >= 2 && size <= 65) || !Array.isArray(lut.data) || lut.data.length !== size * size * size * 3) continue;
        luts[id] = { size, data: Float32Array.from(lut.data, (v) => Math.min(1, Math.max(0, Number(v) || 0))) };
    }

    return { ...preset, fps, background, duration, main, overlays, audio, text, luts };
}

/**
 * Colour grade files for a clip: a .cube LUT (lut3d) and, with a vignette, a mask image.
 * Cached per work folder by settings, so repeated looks are built once.
 */
async function colorAssets(color, spec, workDir) {
    if (!color) return { lut: null, mask: null };
    const key = crypto.createHash('sha1').update(JSON.stringify(color)).digest('hex').slice(0, 16);
    let lut = null;
    if (!isNeutralColor(color)) {
        lut = path.join(workDir, `grade_${key}.cube`);
        if (!fs.existsSync(lut)) fs.writeFileSync(lut, lutToCube(buildLut(color, spec.luts)));
    }
    let mask = null;
    const vig = color.vignette;
    if (vig?.amount) {
        mask = { path: path.join(workDir, `vignette_${key}.png`), mode: vig.amount < 0 ? 'multiply' : 'screen' };
        if (!fs.existsSync(mask.path)) {
            const { width: W, height: H } = spec;
            // Built at a quarter size and scaled up: vignettes are smooth.
            const w = Math.ceil(W / 4);
            const h = Math.ceil(H / 4);
            const px = Buffer.alloc(w * h);
            for (let y = 0; y < h; y += 1) {
                for (let x = 0; x < w; x += 1) {
                    const { dark, light } = vignetteAt(vig, (x + 0.5) / w, (y + 0.5) / h, W / H);
                    px[y * w + x] = Math.round((vig.amount < 0 ? dark : light) * 255);
                }
            }
            await sharp(px, { raw: { width: w, height: h, channels: 1 } }).resize(W, H, { kernel: 'cubic' }).toColourspace('srgb').png().toFile(mask.path);
        }
    }
    return { lut, mask };
}

// ---------------------------------------------------------------------------
// FFmpeg helpers
// ---------------------------------------------------------------------------

let libassAvailable = null;
async function hasLibass() {
    if (libassAvailable === null) {
        const filters = await run(FFMPEG, ['-hide_banner', '-filters']).catch(() => '');
        libassAvailable = /\bsubtitles\b/.test(String(filters));
    }
    return libassAvailable;
}

let drawtextCaps = null;
async function getDrawtextCaps() {
    if (!drawtextCaps) {
        const help = await run(FFMPEG, ['-hide_banner', '-h', 'filter=drawtext']).catch(() => '');
        drawtextCaps = { yAlign: /y_align/.test(help) };
    }
    return drawtextCaps;
}

/** atempo accepts 0.5–2.0 per instance, so larger changes are chained. */
function atempoChain(speed) {
    const parts = [];
    let s = speed;
    while (s > 2) {
        parts.push('atempo=2.0');
        s /= 2;
    }
    while (s < 0.5) {
        parts.push('atempo=0.5');
        s /= 0.5;
    }
    if (Math.abs(s - 1) > 1e-3) parts.push(`atempo=${s.toFixed(4)}`);
    return parts;
}

/** Escapes a value for use inside a single-quoted filter option. */
function filterPath(p) {
    return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");
}

const FONT_CANDIDATES = {
    win32: {
        arial: ['arial.ttf', 'arialbd.ttf'],
        georgia: ['georgia.ttf', 'georgiab.ttf'],
        impact: ['impact.ttf', 'impact.ttf'],
        'courier new': ['cour.ttf', 'courbd.ttf'],
    },
    linux: {
        default: ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'],
        serif: ['DejaVuSerif.ttf', 'DejaVuSerif-Bold.ttf'],
        mono: ['DejaVuSansMono.ttf', 'DejaVuSansMono-Bold.ttf'],
    },
};

function resolveFont(family, bold) {
    if (process.env.EDITOR_FONT_FILE && fs.existsSync(process.env.EDITOR_FONT_FILE)) return process.env.EDITOR_FONT_FILE;
    const key = String(family || '').toLowerCase();
    const BUNDLED = { anton: ['Anton-Regular.ttf', 'Anton-Regular.ttf'], 'bebas neue': ['BebasNeue-Regular.ttf', 'BebasNeue-Regular.ttf'], poppins: ['Poppins-Bold.ttf', 'Poppins-Black.ttf'] };
    const bundled = BUNDLED[key] || (process.platform !== 'win32' && key === 'impact' ? BUNDLED.anton : null);
    if (bundled) {
        const file = path.join(FONTS_DIR, bundled[bold ? 1 : 0]);
        if (fs.existsSync(file)) return file;
    }
    const pick = (dir, pair) => {
        const file = path.join(dir, pair[bold ? 1 : 0]);
        return fs.existsSync(file) ? file : null;
    };
    if (process.platform === 'win32') {
        const dir = path.join(process.env.WINDIR || 'C:/Windows', 'Fonts');
        const pair = FONT_CANDIDATES.win32[key] || FONT_CANDIDATES.win32.arial;
        return pick(dir, pair) || pick(dir, FONT_CANDIDATES.win32.arial);
    }
    const dirs = ['/usr/share/fonts/truetype/dejavu', '/usr/share/fonts/dejavu', '/usr/share/fonts/TTF'];
    const pair = key.includes('georgia') ? FONT_CANDIDATES.linux.serif : key.includes('courier') ? FONT_CANDIDATES.linux.mono : FONT_CANDIDATES.linux.default;
    for (const dir of dirs) {
        const found = pick(dir, pair);
        if (found) return found;
    }
    return null; // fall back to fontconfig's default
}

const ENCODE_VIDEO = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
const ENCODE_AUDIO = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'];

// ---------------------------------------------------------------------------
// Pass 1: main track segments
// ---------------------------------------------------------------------------

/** Scale to fit, apply the colour filter to the picture only, then letterbox with the background. */
function fitFilter(W, H, bgHex, filterName, grade = null, lutPath = null) {
    const filter = filterName && filterName !== 'none' ? `,${FILTER_PRESETS[filterName]}` : '';
    const lut = lutPath ? `,lut3d=file='${filterPath(lutPath)}':interp=tetrahedral` : '';
    return `scale=${W}:${H}:force_original_aspect_ratio=decrease${filter}${gradeFilters(grade)}${lut},pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x${bgHex}`;
}

/**
 * Filters applying a clip transform to a canvas-sized frame (W×H). Order matches the editor
 * preview: flip, zoom about the centre (animated over the clip), move, rotate about the centre.
 * Padding before the crop lets zoom-out and large moves reveal the background colour.
 */
function transformFilters(t, W, H, length, bgHex) {
    if (!t) return '';
    const parts = [];
    if (t.flipH) parts.push('hflip');
    if (t.flipV) parts.push('vflip');

    const animated = Math.abs(t.scaleEnd - t.scaleStart) > 1e-4;
    const zoom = animated
        ? `(${t.scaleStart.toFixed(4)}+${(t.scaleEnd - t.scaleStart).toFixed(4)}*min(t/${Math.max(length, 0.04).toFixed(3)},1))`
        : t.scaleStart.toFixed(4);
    if (animated || t.scaleStart !== 1 || t.x || t.y || t.xEnd || t.yEnd) {
        const margin = 2 * Math.ceil(Math.max(Math.abs(t.x), Math.abs(t.y), Math.abs(t.xEnd), Math.abs(t.yEnd)) / 2) + 2;
        parts.push(`scale=w='trunc(${W}*${zoom}/2)*2':h='trunc(${H}*${zoom}/2)*2'${animated ? ':eval=frame' : ''}`);
        parts.push(`pad=w='max(iw,${W})+${2 * margin}':h='max(ih,${H})+${2 * margin}':x='(ow-iw)/2':y='(oh-ih)/2':color=0x${bgHex}${animated ? ':eval=frame' : ''}`);
        const travel = (a, b) => `${a.toFixed(1)}+${(b - a).toFixed(1)}*min(t/${Math.max(length, 0.04).toFixed(3)},1)`;
        parts.push(`crop=${W}:${H}:x='(iw-${W})/2-(${travel(t.x, t.xEnd)})':y='(ih-${H})/2-(${travel(t.y, t.yEnd)})'`);
    }
    if (t.rotation) parts.push(`rotate=a=${t.rotation.toFixed(3)}*PI/180:fillcolor=0x${bgHex}`);
    return parts.length ? `,${parts.join(',')}` : '';
}

/** Rotation for overlays keeps transparency, growing the frame to fit the rotated picture. */
function overlayRotation(t) {
    if (!t?.rotation) return '';
    const a = `${t.rotation.toFixed(3)}*PI/180`;
    return `,rotate=a=${a}:ow='rotw(${a})':oh='roth(${a})':c=none`;
}

/** Overlay-track version: zoom resizes the picture (below 100% = picture-in-picture). */
function overlayTransformFilters(t) {
    if (!t) return '';
    const parts = [];
    if (t.flipH) parts.push('hflip');
    if (t.flipV) parts.push('vflip');
    if (t.scaleStart !== 1) parts.push(`scale='trunc(iw*${t.scaleStart.toFixed(4)}/2)*2':'trunc(ih*${t.scaleStart.toFixed(4)}/2)*2'`);
    return parts.length ? `,${parts.join(',')}` : '';
}

async function renderSegment(segment, spec, outPath) {
    const { width: W, height: H, fps, background } = spec;
    const assets = segment.kind === 'gap' ? { lut: null, mask: null } : await colorAssets(segment.color, spec, path.dirname(outPath));
    const len = segment.length.toFixed(3);
    const args = ['-hide_banner', '-y'];
    const graph = [];
    let audioLabel = null;

    if (segment.kind === 'gap') {
        args.push('-f', 'lavfi', '-i', `color=c=0x${background.hex}:s=${W}x${H}:r=${fps}:d=${len}`);
        args.push('-f', 'lavfi', '-t', len, '-i', 'anullsrc=r=48000:cl=stereo');
        graph.push('[0:v]format=yuv420p,setsar=1[v]');
        audioLabel = '1:a';
    } else if (segment.kind === 'image') {
        args.push('-loop', '1', '-framerate', String(fps), '-t', len, '-i', segment.path);
        args.push('-f', 'lavfi', '-t', len, '-i', 'anullsrc=r=48000:cl=stereo');
        graph.push(`[0:v]${fitFilter(W, H, background.hex, segment.filter, segment.grade, assets.lut)}${transformFilters(segment.transform, W, H, segment.length, background.hex)}${effectFilters(segment.effects, W, H, fps)},fps=${fps},format=yuv420p,setsar=1[v]`);
        audioLabel = '1:a';
    } else {
        const info = await probe(segment.path);
        const srcLen = (segment.sourceEnd - segment.sourceStart).toFixed(3);
        args.push('-ss', segment.sourceStart.toFixed(3), '-t', srcLen, '-i', segment.path);
        if (info.hasVideo) {
            graph.push(`[0:v]setpts=(PTS-STARTPTS)/${segment.speed},${fitFilter(W, H, background.hex, segment.filter, segment.grade, assets.lut)}${transformFilters(segment.transform, W, H, segment.length, background.hex)}${effectFilters(segment.effects, W, H, fps)}${padFilter(segment)},fps=${fps},format=yuv420p,setsar=1[v]`);
        } else {
            args.push('-f', 'lavfi', '-i', `color=c=0x${background.hex}:s=${W}x${H}:r=${fps}:d=${len}`);
            graph.push(`[1:v]format=yuv420p,setsar=1[v]`);
        }
        if (info.hasAudio && segment.volume > 0) {
            const tempo = atempoChain(segment.speed);
            graph.push(`[0:a]asetpts=PTS-STARTPTS${tempo.length ? `,${tempo.join(',')}` : ''},volume=${segment.volume.toFixed(3)},aresample=48000,aformat=channel_layouts=stereo${audioPadFilter(segment)}[a]`);
            audioLabel = 'a';
        } else {
            const idx = info.hasVideo ? 1 : 2;
            args.push('-f', 'lavfi', '-t', len, '-i', 'anullsrc=r=48000:cl=stereo');
            audioLabel = `${idx}:a`;
        }
    }

    if (assets.mask) {
        // Vignette: blend the mask over the finished picture (multiply darkens, screen lightens).
        const k = args.filter((a) => a === '-i').length;
        args.push('-loop', '1', '-i', assets.mask.path);
        const end = `,fps=${fps},format=yuv420p,setsar=1[v]`;
        const i = graph.findIndex((g) => g.endsWith(end));
        if (i >= 0) {
            graph[i] = `${graph[i].slice(0, -end.length)},fps=${fps},format=gbrp[pre];[${k}:v]scale=${W}:${H},format=gbrp[vm];[pre][vm]blend=all_mode=${assets.mask.mode}:shortest=1,format=yuv420p,setsar=1[v]`;
        }
    }
    args.push('-filter_complex', graph.join(';'));
    args.push('-map', '[v]', '-map', audioLabel === 'a' ? '[a]' : audioLabel);
    args.push('-t', len, '-r', String(fps), ...ENCODE_VIDEO, ...ENCODE_AUDIO, '-video_track_timescale', '90000', outPath);
    await run(FFMPEG, args);
}

/** Frozen frames where a transition needs more picture than the source has (tpad clone). */
function padFilter(segment) {
    const head = segment.padHead || 0;
    const tail = segment.padTail || 0;
    if (head < 0.01 && tail < 0.01) return '';
    return `,tpad=start_mode=clone:start_duration=${head.toFixed(3)}:stop_mode=clone:stop_duration=${tail.toFixed(3)}`;
}

/** Silence matching padFilter, so picture and sound stay in sync. */
function audioPadFilter(segment) {
    const head = segment.padHead || 0;
    const tail = segment.padTail || 0;
    const parts = [];
    if (head >= 0.01) parts.push(`adelay=${Math.round(head * 1000)}:all=1`);
    if (tail >= 0.01) parts.push(`apad=pad_dur=${tail.toFixed(3)}`);
    return parts.length ? `,${parts.join(',')}` : '';
}

/**
 * Transitions are centred on the cut: half the duration comes from footage after the outgoing
 * clip, half from footage before the incoming clip (frozen frames when the source has none), so
 * the timeline length and every later element keep their positions. Mutates the segments
 * (extends source windows / pads) and returns the boundaries with a transition.
 */
async function prepareTransitions(segments) {
    const boundaries = [];
    for (let i = 1; i < segments.length; i += 1) {
        const a = segments[i - 1];
        const b = segments[i];
        const t = b.transitionIn;
        if (!t || a.kind === 'gap' || b.kind === 'gap') continue;
        const d = Math.min(t.duration, a.length * 0.9, b.length * 0.9);
        if (d < 0.15) continue;
        const h = d / 2;
        for (const [seg, side] of [[a, 'tail'], [b, 'head']]) {
            if (seg.kind === 'image') {
                seg.length += h;
                continue;
            }
            const sourceDuration = (await probe(seg.path)).duration || seg.sourceEnd;
            const need = h * seg.speed;
            if (side === 'tail') {
                const extra = Math.max(0, Math.min(need, sourceDuration - seg.sourceEnd));
                seg.sourceEnd += extra;
                seg.padTail = (seg.padTail || 0) + (need - extra) / seg.speed;
            } else {
                const extra = Math.max(0, Math.min(need, seg.sourceStart));
                seg.sourceStart -= extra;
                seg.padHead = (seg.padHead || 0) + (need - extra) / seg.speed;
            }
            seg.length += h;
        }
        boundaries.push({ index: i, type: TRANSITIONS[t.type], duration: d });
    }
    return boundaries;
}

/**
 * Joins rendered segments. Runs without a transition are stream-copied (concat demuxer); runs are
 * then joined with xfade (picture) and acrossfade (sound).
 */
async function joinSegments(segmentPaths, boundaries, workDir, spec) {
    const cuts = new Map(boundaries.map((b) => [b.index, b]));
    const groups = [[]];
    segmentPaths.forEach((p, i) => {
        if (cuts.has(i)) groups.push([]);
        groups[groups.length - 1].push(p);
    });
    const groupFiles = [];
    for (const [g, files] of groups.entries()) {
        const list = `group_${g}.txt`;
        fs.writeFileSync(path.join(workDir, list), files.map((f) => `file '${path.basename(f)}'`).join('\n'));
        const out = `group_${g}.mp4`;
        await run(FFMPEG, ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], { cwd: workDir });
        groupFiles.push(out);
    }
    if (groupFiles.length === 1) {
        fs.renameSync(path.join(workDir, groupFiles[0]), path.join(workDir, 'base.mp4'));
        return;
    }
    const lengths = [];
    for (const f of groupFiles) lengths.push((await probe(path.join(workDir, f))).duration);
    const args = ['-hide_banner', '-y'];
    for (const f of groupFiles) args.push('-i', f);
    const graph = [];
    let v = '[0:v]';
    let a = '[0:a]';
    let merged = lengths[0];
    boundaries.forEach((b, k) => {
        const offset = Math.max(0, merged - b.duration);
        graph.push(`${v}[${k + 1}:v]xfade=transition=${b.type}:duration=${b.duration.toFixed(3)}:offset=${offset.toFixed(3)}[v${k + 1}]`);
        graph.push(`${a}[${k + 1}:a]acrossfade=d=${b.duration.toFixed(3)}:c1=tri:c2=tri[a${k + 1}]`);
        v = `[v${k + 1}]`;
        a = `[a${k + 1}]`;
        merged = merged + lengths[k + 1] - b.duration;
    });
    args.push('-filter_complex', graph.join(';'), '-map', v, '-map', a, '-r', String(spec.fps), ...ENCODE_VIDEO, ...ENCODE_AUDIO, 'base.mp4');
    await run(FFMPEG, args, { cwd: workDir });
}

/** Lays out the main track; overlapping clips are pushed back rather than dropped. Extends spec.duration if needed. */
function planMainTrack(spec) {
    const segments = [];
    let cursor = 0;
    const sorted = [...spec.main].sort((a, b) => a.timelineStart - b.timelineStart);
    for (const clip of sorted) {
        const start = Math.max(clip.timelineStart, cursor);
        if (start - cursor > 0.02) segments.push({ kind: 'gap', length: start - cursor });
        segments.push({ ...clip });
        cursor = start + clip.length;
    }
    spec.duration = Math.min(LIMITS.maxDuration, Math.max(spec.duration, cursor));
    if (spec.duration - cursor > 0.02) segments.push({ kind: 'gap', length: spec.duration - cursor });
    return segments;
}

// ---------------------------------------------------------------------------
// Pass 2: overlays, text and audio
// ---------------------------------------------------------------------------

async function composite(basePath, spec, workDir, outPath, onProgress) {
    const { width: W, height: H } = spec;
    const args = ['-hide_banner', '-y', '-i', basePath];
    const graph = [];
    const mixInputs = ['[0:a]'];
    let current = '[0:v]';
    let inputIndex = 1;

    for (const [i, ov] of spec.overlays.entries()) {
        const k = inputIndex++;
        const t0 = ov.timelineStart.toFixed(3);
        const t1 = (ov.timelineStart + ov.length).toFixed(3);
        const ovAssets = await colorAssets(ov.color ? { ...ov.color, vignette: { amount: 0 } } : null, spec, workDir);
        const filter = `${ov.filter !== 'none' ? `,${FILTER_PRESETS[ov.filter]}` : ''}${gradeFilters(ov.grade)}${ovAssets.lut ? `,lut3d=file='${filterPath(ovAssets.lut)}':interp=tetrahedral` : ''}`;
        if (ov.kind === 'image') {
            args.push('-loop', '1', '-framerate', String(spec.fps), '-t', ov.length.toFixed(3), '-i', ov.path);
            graph.push(`[${k}:v]setpts=PTS-STARTPTS+${t0}/TB,scale=${W}:${H}:force_original_aspect_ratio=decrease${filter}${overlayTransformFilters(ov.transform)},format=yuva420p${overlayRotation(ov.transform)}[ov${i}]`);
        } else {
            const info = await probe(ov.path);
            args.push('-ss', ov.sourceStart.toFixed(3), '-t', (ov.sourceEnd - ov.sourceStart).toFixed(3), '-i', ov.path);
            if (!info.hasVideo) continue;
            graph.push(`[${k}:v]setpts=(PTS-STARTPTS)/${ov.speed}+${t0}/TB,scale=${W}:${H}:force_original_aspect_ratio=decrease${filter}${overlayTransformFilters(ov.transform)},format=yuva420p${overlayRotation(ov.transform)}[ov${i}]`);
            if (info.hasAudio && ov.volume > 0) {
                const tempo = atempoChain(ov.speed);
                const delay = Math.round(ov.timelineStart * 1000);
                graph.push(`[${k}:a]asetpts=PTS-STARTPTS${tempo.length ? `,${tempo.join(',')}` : ''},volume=${ov.volume.toFixed(3)},aresample=48000,aformat=channel_layouts=stereo,adelay=${delay}:all=1[oa${i}]`);
                mixInputs.push(`[oa${i}]`);
            }
        }
        graph.push(`${current}[ov${i}]overlay=x='(W-w)/2+(${(ov.transform?.x || 0).toFixed(1)})':y='(H-h)/2+(${(ov.transform?.y || 0).toFixed(1)})':enable='between(t,${t0},${t1})':eof_action=pass[vo${i}]`);
        current = `[vo${i}]`;
    }

    // All text in one libass pass when FFmpeg has it (fast, outlines, boxes, animations, fonts).
    if (spec.text.length && (await hasLibass())) {
        fs.writeFileSync(path.join(workDir, 'text.ass'), buildTextAss(spec.text, W, H), 'utf8');
        graph.push(`${current}subtitles=filename=text.ass:fontsdir='${filterPath(FONTS_DIR)}'[vtext]`);
        current = '[vtext]';
    }
    const drawtextItems = current === '[vtext]' ? [] : spec.text;
    if (drawtextItems.some((t) => t.captionMotion)) throw new RenderInputError('Animated captions require FFmpeg with libass. Install subtitle support before exporting this project.');

    // Fallback: one drawtext per line. FFmpeg renders "\n" in a textfile as a missing-glyph box
    // with common fonts, and per-line placement lets us honour alignment.
    const caps = drawtextItems.length ? await getDrawtextCaps() : null;
    let textIndex = 0;
    for (const t of drawtextItems) {
        const font = resolveFont(t.fontFamily, t.bold);
        const color = `0x${t.color.hex}@${(t.color.alpha * t.opacity).toFixed(3)}`;
        const lines = t.content.split(/\r?\n/);
        const lineHeight = Math.round(t.fontSize * 1.15);
        const blockTop = H / 2 + t.y - (lines.length * lineHeight) / 2;
        // drawtext cannot measure the block, so left/right alignment uses an estimated width.
        const blockWidth = Math.max(...lines.map((l) => l.length)) * t.fontSize * 0.52;
        const enable = `enable='between(t,${t.timelineStart.toFixed(3)},${t.timelineEnd.toFixed(3)})'`;

        for (const [lineNo, line] of lines.entries()) {
            if (!line.trim()) continue;
            const textFile = `text_${textIndex}.txt`;
            fs.writeFileSync(path.join(workDir, textFile), line, 'utf8');
            const centreX = W / 2 + t.x;
            const x =
                t.align === 'left'
                    ? `${(centreX - blockWidth / 2).toFixed(1)}`
                    : t.align === 'right'
                      ? `${(centreX + blockWidth / 2).toFixed(1)}-text_w`
                      : `${centreX.toFixed(1)}-text_w/2`;
            const opts = [
                ...(font ? [`fontfile='${filterPath(font)}'`] : []),
                `textfile='${textFile}'`,
                'expansion=none',
                `fontsize=${t.fontSize}`,
                `fontcolor=${color}`,
                `x=${x}`,
                `y=${(blockTop + lineNo * lineHeight + (lineHeight - t.fontSize) / 2).toFixed(1)}`,
                ...(caps?.yAlign ? ['y_align=font'] : []),
                enable,
            ];
            if (t.stroke.width > 0 && t.stroke.color.alpha > 0 && t.background.alpha === 0) {
                opts.push(`borderw=${t.stroke.width}`, `bordercolor=0x${t.stroke.color.hex}@${(t.stroke.color.alpha * t.opacity).toFixed(3)}`);
            }
            if (t.animation !== 'none') opts.push(`alpha='min(1,max(0,(t-${t.timelineStart.toFixed(3)})/${t.animation === 'pop' ? '0.12' : '0.25'}))'`);
            if (t.background.alpha > 0) {
                opts.push('box=1', `boxcolor=0x${t.background.hex}@${(t.background.alpha * t.opacity).toFixed(3)}`, `boxborderw=${Math.round(t.fontSize * 0.18)}`);
            } else {
                opts.push(`shadowcolor=black@${(0.6 * t.opacity).toFixed(2)}`, 'shadowx=0', `shadowy=${Math.max(1, Math.round(t.fontSize / 30))}`);
            }
            graph.push(`${current}drawtext=${opts.join(':')}[vt${textIndex}]`);
            current = `[vt${textIndex}]`;
            textIndex += 1;
        }
    }

    for (const [i, a] of spec.audio.entries()) {
        const info = await probe(a.path);
        if (!info.hasAudio || a.volume <= 0) continue;
        const k = inputIndex++;
        args.push('-ss', a.sourceStart.toFixed(3), '-t', (a.sourceEnd - a.sourceStart).toFixed(3), '-i', a.path);
        const tempo = atempoChain(a.speed);
        const delay = Math.round(a.timelineStart * 1000);
        graph.push(`[${k}:a]asetpts=PTS-STARTPTS${tempo.length ? `,${tempo.join(',')}` : ''},volume=${a.volume.toFixed(3)},aresample=48000,aformat=channel_layouts=stereo,adelay=${delay}:all=1[aa${i}]`);
        mixInputs.push(`[aa${i}]`);
    }

    let audioOut = '0:a';
    if (mixInputs.length > 1) {
        graph.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0:normalize=0[aout]`);
        audioOut = '[aout]';
    }

    if (!graph.length) {
        fs.copyFileSync(basePath, outPath);
        return;
    }

    const videoOut = current === '[0:v]' ? '0:v' : current;
    args.push('-filter_complex', graph.join(';'), '-map', videoOut, '-map', audioOut);
    args.push('-t', spec.duration.toFixed(3), ...ENCODE_VIDEO, ...ENCODE_AUDIO, '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outPath);
    await run(FFMPEG, args, { cwd: workDir, duration: spec.duration, onProgress });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function renderTimeline(config, ownerId, onProgress = () => {}) {
    const spec = normalizeTimelineConfig(config, ownerId);
    const workDir = fs.mkdtempSync(path.join(RENDER_DIR, 'job-'));
    const report = (fraction) => onProgress(Math.min(99, Math.round(fraction * 100)));

    try {
        const segments = planMainTrack(spec);
        const boundaries = await prepareTransitions(segments);
        const segmentPaths = [];
        for (const [i, segment] of segments.entries()) {
            const out = path.join(workDir, `seg_${String(i).padStart(4, '0')}.mp4`);
            await renderSegment(segment, spec, out);
            segmentPaths.push(out);
            report(((i + 1) / segments.length) * 0.6);
        }

        const basePath = path.join(workDir, 'base.mp4');
        await joinSegments(segmentPaths, boundaries, workDir, spec);
        report(0.65);

        const outPath = path.join(RENDER_DIR, `export_${uuidv4()}.mp4`);
        await composite(basePath, spec, workDir, outPath, (f) => report(0.65 + f * 0.34));
        onProgress(100);
        return outPath;
    } finally {
        fs.rm(workDir, { recursive: true, force: true }, () => {});
    }
}

export { RenderInputError };
