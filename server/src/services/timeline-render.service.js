import fs from 'fs';
import { buildTextAss, FONTS_DIR } from './timeline-text-ass.js';
import { evaluateTrack, normalizeKeyframes, trackExpression } from './keyframes.js';
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
import { TREND_XFADE } from './trend-transitions.js';

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
        // Keyframes (seconds from the element's start); they override the static/camera value per property.
        keyframes: normalizeKeyframes(item.keyframes, 'media'),
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
        elementStart: timelineStart,
        keyframes: normalizeKeyframes(item.keyframes, 'text'),
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

    // Exact preview: render only [start, end] of the timeline through the same pipeline.
    let range = null;
    if (config.range && typeof config.range === 'object') {
        const start = num(config.range.start, 0, 0, duration);
        const end = num(config.range.end, start + 3, 0, duration);
        if (!(end - start >= 0.1)) throw new RenderInputError('The preview range is empty.');
        if (end - start > 30) throw new RenderInputError('Exact preview covers at most 30 seconds.');
        range = { start, end };
    }

    return { ...preset, fps, background, duration, main, overlays, audio, text, luts, range };
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
        // Segments render in parallel: a mask being written is awaited, not written twice.
        if (!fs.existsSync(mask.path) && !maskWrites.has(mask.path)) {
            maskWrites.set(mask.path, writeVignetteMask(vig, spec, mask.path).finally(() => maskWrites.delete(mask.path)));
        }
        await maskWrites.get(mask.path);
    }
    return { lut, mask };
}

const maskWrites = new Map();
async function writeVignetteMask(vig, spec, file) {
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
    await sharp(px, { raw: { width: w, height: h, channels: 1 } }).resize(W, H, { kernel: 'cubic' }).toColourspace('srgb').png().toFile(file);
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
function transformFilters(t, W, H, length, bgHex, kf = null, headShift = 0, ctx = null) {
    if (!t && !kf) return '';
    t = t || { scaleStart: 1, scaleEnd: 1, x: 0, y: 0, xEnd: 0, yEnd: 0, rotation: 0, flipH: false, flipV: false };
    const parts = [];
    if (t.flipH) parts.push('hflip');
    if (t.flipV) parts.push('vflip');

    // Element time: segment time minus footage borrowed for a transition before the clip.
    const et = headShift > 1e-4 ? `(t-${headShift.toFixed(4)})` : 't';
    const progress = `clip(${et}/${Math.max(length, 0.04).toFixed(3)},0,1)`;
    const camera = Math.abs(t.scaleEnd - t.scaleStart) > 1e-4;
    const maxZoom = zoomCeiling(kf?.scale, [t.scaleStart, t.scaleEnd]);
    const zoom = kf?.scale
        ? `min(${trackExpression(kf.scale, et)},${maxZoom.toFixed(4)})`
        : camera
          ? `(${t.scaleStart.toFixed(4)}+${(t.scaleEnd - t.scaleStart).toFixed(4)}*${progress})`
          : t.scaleStart.toFixed(4);
    const animated = camera || !!kf?.scale;
    const travel = (a, b) => (Math.abs(b - a) > 1e-4 ? `${a.toFixed(1)}+${(b - a).toFixed(1)}*${progress}` : a.toFixed(1));
    const xExpr = kf?.x ? trackExpression(kf.x, et) : travel(t.x, t.xEnd ?? t.x);
    const yExpr = kf?.y ? trackExpression(kf.y, et) : travel(t.y, t.yEnd ?? t.y);
    const moving = animated || kf?.x || kf?.y || t.scaleStart !== 1 || t.x || t.y || t.xEnd || t.yEnd;
    if (moving) {
        const extent = (track, fallback) => (track ? Math.max(...track.map((k) => Math.abs(k.v))) : fallback);
        const reach = Math.max(extent(kf?.x, Math.max(Math.abs(t.x), Math.abs(t.xEnd || 0))), extent(kf?.y, Math.max(Math.abs(t.y), Math.abs(t.yEnd || 0))));
        const margin = 2 * Math.ceil(reach / 2) + 2;
        // 4:4:4 while moving: with 4:2:0 colour, crop snaps to even pixels (and truncates), which made
        // animated positions lag and step by up to 2 px. Positions round to the nearest pixel. The
        // format filter sits after scale: scale would otherwise negotiate 4:2:0 output.
        parts.push(`scale=w='trunc(${W}*${zoom}/2)*2':h='trunc(${H}*${zoom}/2)*2'${animated ? ':eval=frame' : ''}`);
        parts.push('format=yuv444p');
        // A constant padded size for every frame: with an animated zoom each scaled frame has a
        // different size, and filters after it (crop) keep the first frame's size, so the picture
        // drifted off-centre as the zoom changed. Pad evaluates per frame and centres each one.
        const PW = 2 * Math.ceil((W * Math.max(1, maxZoom)) / 2) + 2 * margin;
        const PH = 2 * Math.ceil((H * Math.max(1, maxZoom)) / 2) + 2 * margin;
        parts.push(`pad=w=${PW}:h=${PH}:x='(ow-iw)/2':y='(oh-ih)/2':color=0x${bgHex}${animated ? ':eval=frame' : ''}`);
        parts.push(`crop=${W}:${H}:x='round(${(PW - W) / 2}-(${xExpr}))':y='round(${(PH - H) / 2}-(${yExpr}))'`);
    }
    if (kf?.rotation) parts.push(`rotate=a='(${trackExpression(kf.rotation, et)})*PI/180':fillcolor=0x${bgHex}`);
    else if (t.rotation) parts.push(`rotate=a=${t.rotation.toFixed(3)}*PI/180:fillcolor=0x${bgHex}`);
    if (kf?.opacity) {
        // Fade towards the background colour.
        const [r, g, b] = [0, 2, 4].map((i) => parseInt(bgHex.slice(i, i + 2), 16));
        const fade = opacityFilters(kf.opacity, { ...ctx, shift: headShift, from: 0, to: length + headShift + 1, channels: { r, g, b } });
        if (fade) parts.push(fade);
    }
    return parts.length ? `,${parts.join(',')}` : '';
}

let opacitySeq = 0;
/**
 * Keyframed opacity as per-frame commands: sendcmd re-sets a 256-entry lookup table at each output
 * frame to the value keyframes.js gives for that frame (what the preview shows). A per-pixel
 * expression (geq) did the same about 20× slower. Stream time − `shift` = element time.
 * channels {r,g,b}: blend the picture towards that colour (main track); null: scale alpha (overlays).
 * Returns '' when the opacity is 1 throughout.
 */
function opacityFilters(track, { fps, dir, shift, from, to, channels }) {
    const valueAt = (time) => Math.min(1, Math.max(0, evaluateTrack(track, time - shift)));
    const first = Math.max(0, Math.ceil(from * fps - 1e-6));
    const last = Math.floor(to * fps + 1e-6);
    opacitySeq += 1;
    const name = `${channels ? 'lutrgb' : 'lutyuv'}@op${opacitySeq}`;
    const set = (o) =>
        channels
            ? ['r', 'g', 'b'].map((c) => [c, `val*${o.toFixed(5)}+${(channels[c] * (1 - o)).toFixed(4)}`])
            : [['a', `val*${o.toFixed(5)}`]];
    const start = valueAt(first / fps);
    const lines = [];
    let current = start;
    let opaque = start > 0.9999;
    for (let k = first + 1; k <= last; k += 1) {
        const o = valueAt(k / fps);
        if (Math.abs(o - current) < 1e-5) continue;
        current = o;
        if (o <= 0.9999) opaque = false;
        // From half a frame before output frame k: the source frames fps= picks for frame k.
        lines.push(`${((k - 0.5) / fps).toFixed(4)} ${set(o).map(([c, v]) => `${name} ${c} ${v}`).join(', ')};`);
    }
    if (opaque) return '';
    const options = set(start).map(([c, v]) => `${c}='${v}'`).join(':');
    const filter = channels ? `${name}=${options}` : `${name}=y=val:u=val:v=val:${options}`;
    if (!lines.length) return filter;
    const file = path.join(dir, `opacity_${opacitySeq}.cmd`);
    fs.writeFileSync(file, lines.join('\n'));
    return `sendcmd=f='${filterPath(file)}',${filter}`;
}

/**
 * Framing in the SOURCE picture for a zoomed or moving main-track clip: crop the part of the
 * source that can ever be visible, then scale only that to the zoom. The preview's geometry (fit
 * inside the canvas, zoom about the centre, move) is unchanged, but nothing is scaled down and
 * back up, and a fill zoom no longer scales the whole letterboxed canvas (≈3× the pixels for 16:9
 * footage on a 9:16 canvas). Returns null when the source size is unknown (callers fall back).
 * src: { w, h } display size of the source.
 */
function sourceFraming(t, W, H, length, bgHex, kf, headShift, src, colour) {
    if (!src?.w || !src?.h) return null;
    const et = headShift > 1e-4 ? `(t-${headShift.toFixed(4)})` : 't';
    const progress = `clip(${et}/${Math.max(length, 0.04).toFixed(3)},0,1)`;
    const camera = Math.abs(t.scaleEnd - t.scaleStart) > 1e-4;
    const maxZoom = zoomCeiling(kf?.scale, [t.scaleStart, t.scaleEnd]);
    const minZoom = zoomFloor(kf?.scale, [t.scaleStart, t.scaleEnd]);
    const zoom = kf?.scale
        ? `clip(${trackExpression(kf.scale, et)},${minZoom.toFixed(4)},${maxZoom.toFixed(4)})`
        : camera
          ? `(${t.scaleStart.toFixed(4)}+${(t.scaleEnd - t.scaleStart).toFixed(4)}*${progress})`
          : t.scaleStart.toFixed(4);
    const animated = camera || !!kf?.scale;
    const travel = (a, b) => (Math.abs(b - a) > 1e-4 ? `${a.toFixed(1)}+${(b - a).toFixed(1)}*${progress}` : a.toFixed(1));
    const xExpr = kf?.x ? trackExpression(kf.x, et) : travel(t.x, t.xEnd ?? t.x);
    const yExpr = kf?.y ? trackExpression(kf.y, et) : travel(t.y, t.yEnd ?? t.y);
    const extent = (track, fallback) => (track ? Math.max(...track.map((k) => Math.abs(k.v))) * 1.4 : fallback);
    const reachX = extent(kf?.x, Math.max(Math.abs(t.x), Math.abs(t.xEnd || 0)));
    const reachY = extent(kf?.y, Math.max(Math.abs(t.y), Math.abs(t.yEnd || 0)));

    // Fit factor (source px → canvas px at zoom 1) and the source area ever visible (centred).
    const k = Math.min(W / src.w, H / src.h);
    const need = (canvas, reach) => (canvas / 2 + reach) / (minZoom * k);
    const span = (size, half) => {
        // Centred crop whose offset (size − span)/2 is even (4:2:0 crops snap to even pixels).
        const wanted = Math.min(size, 2 * Math.ceil(half) + 4);
        return Math.min(size, size - 4 * Math.floor((size - wanted) / 4));
    };
    const cw = span(src.w, need(W, reachX));
    const ch = span(src.h, need(H, reachY));
    const s = `(${zoom})*${k.toFixed(6)}`;
    const sMax = maxZoom * k;
    const margin = 2 * Math.ceil(Math.max(reachX, reachY) / 2) + 2;
    const PW = 2 * Math.ceil(Math.max(W, cw * sMax) / 2) + 2 * margin;
    const PH = 2 * Math.ceil(Math.max(H, ch * sMax) / 2) + 2 * margin;
    const parts = [];
    if (t.flipH) parts.push('hflip');
    if (t.flipV) parts.push('vflip');
    if (cw < src.w || ch < src.h) parts.push(`crop=${cw}:${ch}:${(src.w - cw) / 2}:${(src.h - ch) / 2}`);
    if (colour) parts.push(colour);
    parts.push(`scale=w='max(2,trunc(${cw}*${s}/2)*2)':h='max(2,trunc(${ch}*${s}/2)*2)'${animated ? ':eval=frame' : ''}`);
    parts.push('format=yuv444p');
    parts.push(`pad=w=${PW}:h=${PH}:x='(ow-iw)/2':y='(oh-ih)/2':color=0x${bgHex}${animated ? ':eval=frame' : ''}`);
    parts.push(`crop=${W}:${H}:x='round(${(PW - W) / 2}-(${xExpr}))':y='round(${(PH - H) / 2}-(${yExpr}))'`);
    return parts.join(',');
}

/** Smallest zoom an animated scale reaches (keyframes, with room for undershooting easings). */
function zoomFloor(track, fixed = []) {
    if (!track) return Math.max(1e-3, Math.min(...fixed.filter((v) => Number.isFinite(v))));
    const values = track.map((k) => k.v);
    const lo = Math.min(...values);
    const overshoots = track.slice(0, -1).some((k) => /^(back|elastic)/.test(k.ease));
    return Math.max(0.05, overshoots ? lo - 0.4 * (Math.max(...values) - lo) : lo);
}

/**
 * Picture filters of a main-track clip: fit + colour + transform. Zoomed or moving clips frame in
 * the source (sourceFraming); others fit, then rotate/fade as before.
 */
function pictureFilters(segment, W, H, bgHex, lut, fullLength, ctx, src) {
    const t = segment.transform;
    const kf = segment.keyframes;
    const headShift = segment.headShift || 0;
    const moving = !!(kf?.scale || kf?.x || kf?.y || (t && (t.scaleStart !== 1 || Math.abs(t.scaleEnd - t.scaleStart) > 1e-4 || t.x || t.y || t.xEnd || t.yEnd)));
    // KENGAN_FRAMING=canvas forces the older canvas-zoom path (scripts compare the two).
    if (moving && src && process.env.KENGAN_FRAMING !== 'canvas') {
        const preset = segment.filter && segment.filter !== 'none' ? `${FILTER_PRESETS[segment.filter]}` : '';
        const colour = [preset, gradeFilters(segment.grade).replace(/^,/, ''), lut ? `lut3d=file='${filterPath(lut)}':interp=tetrahedral` : ''].filter(Boolean).join(',');
        const framed = sourceFraming(t || { scaleStart: 1, scaleEnd: 1, x: 0, y: 0, xEnd: 0, yEnd: 0, rotation: 0 }, W, H, fullLength, bgHex, kf, headShift, src, colour);
        if (framed) {
            // Rotation and opacity act on the framed canvas, exactly as in transformFilters.
            const rest = transformFilters({ scaleStart: 1, scaleEnd: 1, x: 0, y: 0, xEnd: 0, yEnd: 0, rotation: t?.rotation || 0, flipH: false, flipV: false }, W, H, fullLength, bgHex, kf ? { rotation: kf.rotation, opacity: kf.opacity } : null, headShift, ctx);
            return `${framed}${rest}`;
        }
    }
    return `${fitFilter(W, H, bgHex, segment.filter, segment.grade, lut)}${transformFilters(t, W, H, fullLength, bgHex, kf, headShift, ctx)}`;
}

/** Display size of a clip's picture (rotation applied), or null when unknown or non-square pixels. */
function displaySize(info) {
    if (!info?.width || !info?.height || info.squarePixels === false) return null;
    const turned = Math.abs(Math.round(info.rotation || 0)) % 180 === 90;
    return turned ? { w: info.height, h: info.width } : { w: info.width, h: info.height };
}

/** Rotation for overlays keeps transparency, growing the frame to fit the rotated picture. */
function overlayRotation(t) {
    if (!t?.rotation) return '';
    const a = `${t.rotation.toFixed(3)}*PI/180`;
    return `,rotate=a=${a}:ow='rotw(${a})':oh='roth(${a})':c=none`;
}

/** Overlay-track version: zoom resizes the picture (below 100% = picture-in-picture). */
/**
 * Largest zoom an animated scale reaches: the highest keyframe plus room for easing overshoot
 * (back/elastic curves pass the target by up to ~40% of the change). Zoom is clamped to it.
 */
function zoomCeiling(track, fixed = []) {
    if (!track) return Math.max(1e-3, ...fixed.filter((v) => Number.isFinite(v)));
    const values = track.map((k) => k.v);
    const hi = Math.max(...values);
    // Only back/elastic curves leave the keyframe range.
    const overshoots = track.slice(0, -1).some((k) => /^(back|elastic)/.test(k.ease));
    return overshoots ? hi + 0.4 * (hi - Math.min(...values)) : hi;
}

/** Overlay keyframes (scale, rotation, opacity) in terms of the overlay's element time `et`. */
function overlayKeyframeFilters(kf, et, ctx) {
    if (!kf) return '';
    const parts = [];
    if (kf.scale) {
        // Constant-size output (transparent pad), so rotate and overlay see one frame size.
        const maxZoom = zoomCeiling(kf.scale);
        const z = `min(${trackExpression(kf.scale, et)},${maxZoom.toFixed(4)})`;
        // Pad in 4:4:4 (exact centring) to canvas + a multiple of 4 px, so the overlay offset (W-w)/2
        // stays even: overlay positions snap to even pixels on a 4:2:0 picture.
        const grow = (size) => size + 4 * Math.ceil(Math.max(0, size * maxZoom - size) / 4) + 4;
        parts.push(`scale=w='trunc(iw*(${z})/2)*2':h='trunc(ih*(${z})/2)*2':eval=frame`, 'format=yuva444p');
        parts.push(`pad=w=${grow(ctx.width)}:h=${grow(ctx.height)}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame`);
    }
    if (kf.rotation) parts.push(`rotate=a='(${trackExpression(kf.rotation, et)})*PI/180':ow='hypot(iw,ih)':oh='hypot(iw,ih)':c=none`);
    if (kf.opacity) {
        const fade = opacityFilters(kf.opacity, { ...ctx, shift: ctx.start, from: ctx.start, to: ctx.end, channels: null });
        if (fade) parts.push(fade);
    }
    return parts.length ? `,${parts.join(',')}` : '';
}

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
    // Whole frames, added as N/(fps·TB) so it is exact in any time base: a photo's time base is
    // 1/fps, where "+0.433333/TB" truncated to 12 frames instead of 13.
    const offsetFrames = segment.offset ? Math.round(segment.offset * fps) : 0;
    const offset = offsetFrames / fps;
    const offsetPts = `${offsetFrames}/(${fps}*TB)`;
    // Animation progress runs over the clip's own length (as in the preview), not the length after
    // transitions borrowed footage or an exact-preview range cut it.
    const fullLength = segment.elementLength || segment.length;
    const et = segment.headShift > 1e-4 ? `(t-${segment.headShift.toFixed(4)})` : 't';
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
        const src = displaySize(await probe(segment.path).catch(() => null));
        graph.push(`[0:v]${offset ? `setpts=PTS-STARTPTS+${offsetPts},` : ''}${pictureFilters(segment, W, H, background.hex, assets.lut, fullLength, { fps, dir: path.dirname(outPath) }, src)}${effectFilters(segment.effects, W, H, fps, et)},fps=${fps}${offset ? ',setpts=PTS-STARTPTS' : ''},format=yuv420p,setsar=1[v]`);
        audioLabel = '1:a';
    } else {
        const info = await probe(segment.path);
        // A partial render (exact preview) starts `offset` seconds into the segment but keeps the
        // segment's time base, so camera moves, keyframes and effects evaluate exactly as in a full render.
        const srcFrom = segment.sourceStart + offset * segment.speed;
        const srcLen = (segment.sourceEnd - srcFrom).toFixed(3);
        args.push('-ss', srcFrom.toFixed(3), '-t', srcLen, '-i', segment.path);
        if (info.hasVideo) {
            graph.push(`[0:v]setpts=(PTS-STARTPTS)/${segment.speed}${offset ? `+${offsetPts}` : ''},${pictureFilters(segment, W, H, background.hex, assets.lut, fullLength, { fps, dir: path.dirname(outPath) }, displaySize(info))}${effectFilters(segment.effects, W, H, fps, et)}${padFilter(segment)},fps=${fps}${offset ? ',setpts=PTS-STARTPTS' : ''},format=yuv420p,setsar=1[v]`);
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
    // KENGAN_RENDER_DEBUG=1 prints each segment's filter graph (diagnosing export differences).
    if (process.env.KENGAN_RENDER_DEBUG) console.log(`[render] segment ${path.basename(outPath)}: ${graph.join(';')}`);
    args.push('-map', '[v]', '-map', audioLabel === 'a' ? '[a]' : audioLabel);
    // Exactly `frames` pictures and the same length of sound. "-t <seconds to 3 decimals>" let in an
    // extra frame for lengths like 1.5667 s, so later cuts drifted a frame behind titles and music.
    const frames = segment.frameCount || Math.round(segment.length * fps);
    args.push('-t', (frames / fps).toFixed(6), '-frames:v', String(frames), '-r', String(fps), ...ENCODE_VIDEO, ...ENCODE_AUDIO, '-video_track_timescale', '90000', outPath);
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
        // From the clips' own lengths, so an exact-preview range (which renders only part of a clip)
        // gets the same transition as the full export.
        const d = Math.min(t.duration, (a.elementLength || a.length) * 0.9, (b.elementLength || b.length) * 0.9);
        if (d < 0.15) continue;
        const h = d / 2;
        for (const [seg, side] of [[a, 'tail'], [b, 'head']]) {
            if (seg.kind === 'image') {
                // A photo held longer at its head: its animation still starts at the clip's own start.
                if (side === 'head') seg.headShift = (seg.headShift || 0) + h;
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
                // Footage borrowed before the clip: its time 0 now lies this far into the segment.
                seg.headShift = (seg.headShift || 0) + extra / seg.speed;
                seg.padHead = (seg.padHead || 0) + (need - extra) / seg.speed;
            }
            seg.length += h;
        }
        boundaries.push({ index: i, id: t.type, type: TRANSITIONS[t.type], duration: d });
    }
    return boundaries;
}

/**
 * Transitions rendered at half size over their own frames only (see joinSegments).
 * KENGAN_FULL_RES_TRANSITIONS=1 renders them at full size (for comparing).
 */
const HALF_RES_TRANSITIONS = new Set(Object.keys(TREND_XFADE));

/**
 * Joins rendered segments. Runs without a transition are stream-copied (concat demuxer); runs are
 * then joined with xfade (picture) and acrossfade (sound).
 */
async function joinSegments(segmentPaths, boundaries, workDir, spec, frameCounts = []) {
    const cuts = new Map(boundaries.map((b) => [b.index, b]));
    const groups = [[]];
    segmentPaths.forEach((p, i) => {
        if (cuts.has(i)) groups.push([]);
        groups[groups.length - 1].push({ file: p, frames: frameCounts[i] });
    });
    const groupFiles = [];
    for (const [g, files] of groups.entries()) {
        const list = `group_${g}.txt`;
        // Each file lasts exactly its picture: without "duration", concat starts the next file after
        // the container length, which includes AAC padding (up to 21 ms), so every plain cut pushed the
        // rest of the picture later than titles, overlays and music. outpoint drops the padding.
        const entries = files.map(({ file, frames }) => {
            const entry = `file '${path.basename(file)}'`;
            if (!frames) return entry;
            const seconds = (frames / spec.fps).toFixed(6);
            return `${entry}\nduration ${seconds}\noutpoint ${seconds}`;
        });
        fs.writeFileSync(path.join(workDir, list), entries.join('\n'));
        const out = `group_${g}.mp4`;
        await run(FFMPEG, ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], { cwd: workDir });
        groupFiles.push(out);
    }
    if (groupFiles.length === 1) {
        // Concat starts the picture after the audio's AAC encoder delay (~21 ms), which put every title,
        // overlay and music cue that far out of step with the picture. Shift the video back to 0
        // (stream copy, no re-encode).
        const start = (await probe(path.join(workDir, groupFiles[0]))).videoStart;
        if (start > 0.0005) {
            await run(FFMPEG, ['-hide_banner', '-y', '-itsoffset', (-start).toFixed(6), '-i', groupFiles[0], '-i', groupFiles[0], '-map', '0:v', '-map', '1:a?', '-c', 'copy', 'base.mp4'], { cwd: workDir });
        } else {
            fs.renameSync(path.join(workDir, groupFiles[0]), path.join(workDir, 'base.mp4'));
        }
        return;
    }
    const lengths = [];
    // xfade offsets are picture time: use the video stream's length (the container length includes AAC
    // padding and would start every transition a frame late).
    for (const f of groupFiles) {
        const info = await probe(path.join(workDir, f));
        lengths.push(info.videoDuration || info.duration);
    }
    const args = ['-hide_banner', '-y'];
    for (const f of groupFiles) args.push('-i', f);
    const graph = [];
    // Each joined run starts at time 0 in the filter graph (stream copies can carry encoder-delay offsets).
    groupFiles.forEach((_, i) => {
        graph.push(`[${i}:v]settb=AVTB,setpts=PTS-STARTPTS,fps=${spec.fps}[gv${i}]`);
        graph.push(`[${i}:a]asetpts=PTS-STARTPTS,atrim=duration=${lengths[i].toFixed(4)},apad=whole_dur=${lengths[i].toFixed(4)}[ga${i}]`);
    });
    let v = '[gv0]';
    let a = '[ga0]';
    let merged = lengths[0];
    boundaries.forEach((b, k) => {
        const offset = Math.max(0, merged - b.duration);
        const startFrame = Math.round(offset * spec.fps);
        const frames = Math.round(b.duration * spec.fps);
        if (HALF_RES_TRANSITIONS.has(b.id) && startFrame > 0 && frames > 1 && !process.env.KENGAN_FULL_RES_TRANSITIONS) {
            // The Kengan motion transitions sample each source pixel several times in an FFmpeg
            // expression (about 1-2 s per 1080p frame). Only the transition's frames go through
            // xfade, at half size, then are scaled back and spliced between the untouched picture.
            const n = k + 1;
            const half = 'scale=trunc(iw/4)*2:trunc(ih/4)*2';
            graph.push(`${v}split[xa${n}][xb${n}]`);
            graph.push(`[xa${n}]trim=end_frame=${startFrame},setpts=PTS-STARTPTS[xpre${n}]`);
            // Two cloned frames in case rounding left the outgoing side a frame short; xfade drops extras.
            graph.push(`[xb${n}]trim=start_frame=${startFrame},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=2,${half}[xw${n}]`);
            graph.push(`[gv${n}]split[ya${n}][yb${n}]`);
            graph.push(`[ya${n}]trim=end_frame=${frames},setpts=PTS-STARTPTS,${half}[yw${n}]`);
            graph.push(`[yb${n}]trim=start_frame=${frames},setpts=PTS-STARTPTS[ypost${n}]`);
            graph.push(`[xw${n}][yw${n}]xfade=transition=${b.type}:duration=${(frames / spec.fps).toFixed(6)}:offset=0,scale=${spec.width}:${spec.height}[tw${n}]`);
            // concat outputs microsecond timestamps; the next xfade needs the 1/fps time base of the others.
            graph.push(`[xpre${n}][tw${n}][ypost${n}]concat=n=3:v=1:a=0,settb=1/${spec.fps}[v${n}]`);
        } else {
            graph.push(`${v}[gv${k + 1}]xfade=transition=${b.type}:duration=${b.duration.toFixed(3)}:offset=${offset.toFixed(3)}[v${k + 1}]`);
        }
        graph.push(`${a}[ga${k + 1}]acrossfade=d=${b.duration.toFixed(3)}:c1=tri:c2=tri[a${k + 1}]`);
        v = `[v${k + 1}]`;
        a = `[a${k + 1}]`;
        merged = merged + lengths[k + 1] - b.duration;
    });
    args.push('-filter_complex', graph.join(';'), '-map', v, '-map', a, '-r', String(spec.fps), ...ENCODE_VIDEO, ...ENCODE_AUDIO, 'base.mp4');
    await run(FFMPEG, args, { cwd: workDir });
}

/** Segments rendered at once: SEGMENT_CONCURRENCY, or half the CPU cores (1-3). */
function segmentConcurrency() {
    const configured = Number(process.env.SEGMENT_CONCURRENCY);
    if (Number.isInteger(configured) && configured > 0) return configured;
    return Math.max(1, Math.min(3, Math.floor(os.cpus().length / 2)));
}

/** Seconds of context rendered around an exact-preview range (covers any transition half). */
const RANGE_MARGIN = 1.05;

/**
 * Exact preview: keeps only the main-track work the range needs. Segments outside become gaps,
 * a segment reaching into the range renders from `offset` (same time base), work after the range
 * is dropped, and transitions on cuts away from the range are skipped. Also trims the other tracks.
 */
function limitToRange(segments, spec) {
    // Whole frames, so the gap before a partial segment adds no rounding.
    const from = Math.max(0, Math.floor((spec.range.start - RANGE_MARGIN) * spec.fps) / spec.fps);
    // After the end: enough of the next clip for any transition that reaches into the range
    // (its length limits the transition to 90% of it; transitions last at most 2 s).
    const to = Math.min(spec.duration, Math.ceil((spec.range.end + RANGE_MARGIN + 2.25) * spec.fps) / spec.fps);
    const out = [];
    let cursor = 0;
    for (const seg of segments) {
        const s = cursor;
        const e = cursor + seg.length;
        cursor = e;
        if (s >= to) break;
        if (e <= from || seg.kind === 'gap') {
            out.push({ kind: 'gap', length: Math.min(e, to) - s });
            continue;
        }
        const next = { ...seg };
        // Transitions only on cuts inside the rendered window.
        if (s < from - 1e-6 || (next.transitionIn && s > to)) next.transitionIn = null;
        const head = Math.max(0, from - s);
        const tail = Math.max(0, e - to);
        if (head > 0.01) {
            out.push({ kind: 'gap', length: head });
            next.offset = head;
            next.transitionIn = null;
        }
        next.length = seg.length - (head > 0.01 ? head : 0) - tail;
        if (seg.kind !== 'image') next.sourceEnd = seg.sourceEnd - tail * seg.speed;
        out.push(next);
    }
    spec.duration = to;
    spec.overlays = spec.overlays.filter((o) => o.timelineStart < to && o.timelineStart + o.length > from);
    spec.audio = spec.audio.filter((a) => a.timelineStart < to && a.timelineStart + a.length > from);
    spec.text = spec.text.filter((t) => t.timelineStart < to && t.timelineEnd > from);
    return out;
}

/** Lays out the main track; overlapping clips are pushed back rather than dropped. Extends spec.duration if needed. */
function planMainTrack(spec) {
    const segments = [];
    let cursor = 0;
    const sorted = [...spec.main].sort((a, b) => a.timelineStart - b.timelineStart);
    for (const clip of sorted) {
        const start = Math.max(clip.timelineStart, cursor);
        if (start - cursor > 0.02) segments.push({ kind: 'gap', length: start - cursor });
        segments.push({ ...clip, elementLength: clip.length });
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
            graph.push(`[${k}:v]setpts=PTS-STARTPTS+${t0}/TB,scale=${W}:${H}:force_original_aspect_ratio=decrease${filter}${overlayTransformFilters(ov.transform)},format=yuva420p${overlayRotation(ov.transform)}${overlayKeyframeFilters(ov.keyframes, `(t-${t0})`, { fps: spec.fps, dir: workDir, start: ov.timelineStart, end: ov.timelineStart + ov.length, width: W, height: H })}[ov${i}]`);
        } else {
            const info = await probe(ov.path);
            args.push('-ss', ov.sourceStart.toFixed(3), '-t', (ov.sourceEnd - ov.sourceStart).toFixed(3), '-i', ov.path);
            if (!info.hasVideo) continue;
            graph.push(`[${k}:v]setpts=(PTS-STARTPTS)/${ov.speed}+${t0}/TB,scale=${W}:${H}:force_original_aspect_ratio=decrease${filter}${overlayTransformFilters(ov.transform)},format=yuva420p${overlayRotation(ov.transform)}${overlayKeyframeFilters(ov.keyframes, `(t-${t0})`, { fps: spec.fps, dir: workDir, start: ov.timelineStart, end: ov.timelineStart + ov.length, width: W, height: H })}[ov${i}]`);
            if (info.hasAudio && ov.volume > 0) {
                const tempo = atempoChain(ov.speed);
                const delay = Math.round(ov.timelineStart * 1000);
                graph.push(`[${k}:a]asetpts=PTS-STARTPTS${tempo.length ? `,${tempo.join(',')}` : ''},volume=${ov.volume.toFixed(3)},aresample=48000,aformat=channel_layouts=stereo,adelay=${delay}:all=1[oa${i}]`);
                mixInputs.push(`[oa${i}]`);
            }
        }
        const ovX = ov.keyframes?.x ? trackExpression(ov.keyframes.x, `(t-${t0})`) : (ov.transform?.x || 0).toFixed(1);
        const ovY = ov.keyframes?.y ? trackExpression(ov.keyframes.y, `(t-${t0})`) : (ov.transform?.y || 0).toFixed(1);
        graph.push(`${current}[ov${i}]overlay=x='(W-w)/2+(${ovX})':y='(H-h)/2+(${ovY})':enable='between(t,${t0},${t1})':eof_action=pass[vo${i}]`);
        current = `[vo${i}]`;
    }

    // All text in one libass pass when FFmpeg has it (fast, outlines, boxes, animations, fonts).
    if (spec.text.length && (await hasLibass())) {
        fs.writeFileSync(path.join(workDir, 'text.ass'), buildTextAss(spec.text, W, H, spec.fps), 'utf8');
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

    if (!graph.length && !spec.range) {
        fs.copyFileSync(basePath, outPath);
        return;
    }

    let videoOut = current === '[0:v]' ? '0:v' : current;
    let window = ['-t', spec.duration.toFixed(3)];
    if (spec.range) {
        // Exact preview: cut to the range by frame number after every filter (frame-exact).
        const first = Math.round(spec.range.start * spec.fps);
        const last = Math.round(spec.range.end * spec.fps);
        graph.push(`${current}trim=start_frame=${first}:end_frame=${last},setpts=PTS-STARTPTS[vrange]`);
        graph.push(`${audioOut.startsWith('[') ? audioOut : `[${audioOut}]`}atrim=start=${(first / spec.fps).toFixed(4)}:end=${(last / spec.fps).toFixed(4)},asetpts=PTS-STARTPTS[arange]`);
        videoOut = '[vrange]';
        audioOut = '[arange]';
        window = [];
    }
    args.push('-filter_complex', graph.join(';'));
    args.push('-map', videoOut, '-map', audioOut);
    args.push(...window, ...ENCODE_VIDEO, ...ENCODE_AUDIO, '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outPath);
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
        const planned = planMainTrack(spec);
        const segments = spec.range ? limitToRange(planned, spec) : planned;
        const boundaries = await prepareTransitions(segments);
        if (process.env.KENGAN_RENDER_DEBUG) console.log('[render] plan', JSON.stringify(segments.map((x) => ({ kind: x.kind, length: +x.length.toFixed(4), offset: x.offset, tr: x.transitionIn?.type || null }))), 'transitions', JSON.stringify(boundaries));
        const segmentPaths = [];
        // Whole frames per segment with the rounding carried forward, so every cut lands on the frame
        // nearest its timeline time however many clips there are.
        let carry = 0;
        for (const segment of segments) {
            const exact = segment.length * spec.fps + carry;
            segment.frameCount = Math.max(1, Math.round(exact));
            carry = exact - segment.frameCount;
        }
        // Several segments at once: each one's filters mostly use a single core.
        let done = 0;
        let next = 0;
        const worker = async () => {
            while (next < segments.length) {
                const i = next++;
                const out = path.join(workDir, `seg_${String(i).padStart(4, '0')}.mp4`);
                segmentPaths[i] = out;
                await renderSegment(segments[i], spec, out);
                done += 1;
                report((done / segments.length) * 0.6);
            }
        };
        await Promise.all(Array.from({ length: Math.min(segmentConcurrency(), segments.length) }, worker));

        const basePath = path.join(workDir, 'base.mp4');
        await joinSegments(segmentPaths, boundaries, workDir, spec, segments.map((s) => s.frameCount));
        report(0.65);

        const outPath = path.join(RENDER_DIR, `export_${uuidv4()}.mp4`);
        await composite(basePath, spec, workDir, outPath, (f) => report(0.65 + f * 0.34));
        onProgress(100);
        return outPath;
    } finally {
        if (process.env.KENGAN_KEEP_WORKDIR) console.log(`[render] kept ${workDir}`);
        else fs.rm(workDir, { recursive: true, force: true }, () => {});
    }
}

export { RenderInputError };
