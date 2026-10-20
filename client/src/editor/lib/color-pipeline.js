/**
 * Kengan colour pipeline (Lumetri-style), shared by the editor preview and the export renderer.
 * THIS FILE IS DUPLICATED at server/src/services/color-pipeline.js; keep both identical
 * (scripts/check-shared.mjs verifies it).
 *
 * Every setting is compiled into one 3D LUT (33³). The preview applies it on the GPU (WebGL2,
 * trilinear), the export applies the same table with FFmpeg's lut3d, so they match.
 *
 * Order (as in Premiere Pro's Lumetri Color panel):
 *   Basic Correction  white balance (temperature, tint), exposure, contrast, highlights, shadows,
 *                     whites, blacks, saturation
 *   Creative          look (preset or imported .cube LUT) with intensity, faded film, vibrance,
 *                     saturation, shadow tint, highlight tint, tint balance
 *   Curves            master and R/G/B tone curves (monotone cubic, like Lumetri's RGB curves)
 *   Colour wheels     shadows / midtones / highlights: lift, gamma, gain per channel (ASC CDL style)
 *   HSL               eight colour bands: hue shift, saturation, luminance (hue/sat curve equivalent)
 * Vignette is spatial, so it is not in the LUT: see vignetteMask().
 *
 * Values are display-referred sRGB 0..1; white balance and exposure work in linear light.
 */

export const LUT_SIZE = 33;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055);
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smooth = (e0, e1, x) => {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
};

/** Neutral settings. Sliders follow Lumetri's ranges where it has one (mostly -100..100). */
export function neutralColor() {
    return {
        basic: { temperature: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 100 },
        creative: { look: null, intensity: 100, fadedFilm: 0, vibrance: 0, saturation: 100, shadowTint: { hue: 30, amount: 0 }, highlightTint: { hue: 210, amount: 0 }, tintBalance: 0 },
        curves: { master: [], red: [], green: [], blue: [] },
        wheels: { shadows: { x: 0, y: 0, luma: 0 }, midtones: { x: 0, y: 0, luma: 0 }, highlights: { x: 0, y: 0, luma: 0 } },
        hsl: {},
        vignette: { amount: 0, midpoint: 50, roundness: 0, feather: 50 },
    };
}

export const HSL_BANDS = [
    { id: 'red', hue: 0 },
    { id: 'orange', hue: 30 },
    { id: 'yellow', hue: 60 },
    { id: 'green', hue: 120 },
    { id: 'aqua', hue: 180 },
    { id: 'blue', hue: 225 },
    { id: 'purple', hue: 270 },
    { id: 'magenta', hue: 315 },
];

/** Fills missing fields with neutral values. */
export function normalizeColor(raw) {
    const n = neutralColor();
    if (!raw || typeof raw !== 'object') return n;
    const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
    const b = raw.basic || {};
    const c = raw.creative || {};
    const pts = (list) =>
        (Array.isArray(list) ? list : [])
            .filter((p) => Array.isArray(p) && p.length === 2)
            .map(([x, y]) => [num(x, 0, 0, 1), num(y, 0, 0, 1)])
            .sort((p, q) => p[0] - q[0])
            .slice(0, 12);
    const wheel = (w = {}) => ({ x: num(w.x, 0, -1, 1), y: num(w.y, 0, -1, 1), luma: num(w.luma, 0, -1, 1) });
    const tint = (t = {}, hue) => ({ hue: num(t.hue, hue, 0, 360), amount: num(t.amount, 0, 0, 100) });
    const hsl = {};
    for (const band of HSL_BANDS) {
        const v = raw.hsl?.[band.id];
        if (v) hsl[band.id] = { hue: num(v.hue, 0, -100, 100), saturation: num(v.saturation, 0, -100, 100), luminance: num(v.luminance, 0, -100, 100) };
    }
    return {
        basic: {
            temperature: num(b.temperature, 0, -100, 100),
            tint: num(b.tint, 0, -100, 100),
            exposure: num(b.exposure, 0, -4, 4),
            contrast: num(b.contrast, 0, -100, 100),
            highlights: num(b.highlights, 0, -100, 100),
            shadows: num(b.shadows, 0, -100, 100),
            whites: num(b.whites, 0, -100, 100),
            blacks: num(b.blacks, 0, -100, 100),
            saturation: num(b.saturation, 100, 0, 200),
        },
        creative: {
            look: typeof c.look === 'string' && c.look ? c.look.slice(0, 80) : null,
            intensity: num(c.intensity, 100, 0, 200),
            fadedFilm: num(c.fadedFilm, 0, 0, 100),
            vibrance: num(c.vibrance, 0, -100, 100),
            saturation: num(c.saturation, 100, 0, 200),
            shadowTint: tint(c.shadowTint, 30),
            highlightTint: tint(c.highlightTint, 210),
            tintBalance: num(c.tintBalance, 0, -100, 100),
        },
        curves: { master: pts(raw.curves?.master), red: pts(raw.curves?.red), green: pts(raw.curves?.green), blue: pts(raw.curves?.blue) },
        wheels: { shadows: wheel(raw.wheels?.shadows), midtones: wheel(raw.wheels?.midtones), highlights: wheel(raw.wheels?.highlights) },
        hsl,
        vignette: {
            amount: num(raw.vignette?.amount, 0, -100, 100),
            midpoint: num(raw.vignette?.midpoint, 50, 0, 100),
            roundness: num(raw.vignette?.roundness, 0, -100, 100),
            feather: num(raw.vignette?.feather, 50, 0, 100),
        },
    };
}

/** True when the settings change nothing (no LUT needed). */
export function isNeutralColor(raw) {
    if (!raw) return true;
    const a = JSON.stringify({ ...normalizeColor(raw), vignette: null });
    const b = JSON.stringify({ ...neutralColor(), vignette: null });
    return a === b;
}

/** Angle of pure red on the colour wheels (vectorscope convention). */
export const WHEEL_RED_ANGLE = 103;

/** Wheel puck position for a hue (0..360) and strength (0..1). */
export function wheelAt(hue, amount, lumaShift = 0) {
    const a = ((hue + WHEEL_RED_ANGLE) * Math.PI) / 180;
    return { x: Math.cos(a) * amount, y: Math.sin(a) * amount, luma: lumaShift };
}

// ---------------------------------------------------------------------------
// Looks (Creative presets), expressed in the same settings so intensity can blend them.
// ---------------------------------------------------------------------------

export const LOOK_PRESETS = {
    'teal-orange': { basic: { contrast: 18, saturation: 110 }, wheels: { shadows: wheelAt(185, 0.55), midtones: wheelAt(30, 0.12), highlights: wheelAt(30, 0.5) } },
    golden: { basic: { temperature: 45, exposure: 0.1, saturation: 110 }, creative: { highlightTint: { hue: 40, amount: 35 } } },
    moody: { basic: { contrast: 22, exposure: -0.2, saturation: 78, highlights: -25 }, wheels: { shadows: wheelAt(205, 0.45, -0.05) } },
    vintage: { basic: { contrast: -12, saturation: 85, temperature: 20 }, creative: { fadedFilm: 35, shadowTint: { hue: 200, amount: 25 }, highlightTint: { hue: 45, amount: 30 } } },
    'cross-process': { basic: { contrast: 25, saturation: 125 }, curves: { blue: [[0, 0.12], [1, 0.88]], red: [[0, 0], [0.5, 0.6], [1, 1]], green: [[0, 0], [0.5, 0.55], [1, 1]] } },
    'bleach-bypass': { basic: { contrast: 35, saturation: 45, highlights: -15 } },
    matte: { basic: { contrast: -10, saturation: 90 }, creative: { fadedFilm: 45 } },
    'film-warm': { basic: { temperature: 22, contrast: 8, saturation: 108 }, curves: { blue: [[0, 0.06], [0.5, 0.46], [1, 0.92]] }, creative: { fadedFilm: 12 } },
    'film-cool': { basic: { temperature: -25, contrast: 6, saturation: 104 }, curves: { red: [[0, 0], [0.5, 0.47], [1, 0.97]] }, creative: { fadedFilm: 10 } },
    noir: { basic: { contrast: 40, saturation: 0, exposure: -0.1 } },
    sepia: { basic: { saturation: 0, contrast: 8 }, wheels: { midtones: wheelAt(35, 0.45), highlights: wheelAt(40, 0.3) } },
    vivid: { basic: { saturation: 140, contrast: 12 }, creative: { vibrance: 25 } },
    faded: { basic: { saturation: 65, contrast: -15, exposure: 0.15 }, creative: { fadedFilm: 30 } },
    warm: { basic: { temperature: 40, tint: 8 } },
    cool: { basic: { temperature: -40 } },
    drama: { basic: { contrast: 45, exposure: -0.25, saturation: 118, highlights: -30, shadows: -10 } },
    neon: { basic: { saturation: 190, contrast: 30 }, hsl: { blue: { hue: -20, saturation: 30, luminance: 0 }, magenta: { hue: 0, saturation: 40, luminance: 10 } } },
    cyberpunk: { basic: { contrast: 18, saturation: 135, tint: 30 }, wheels: { shadows: wheelAt(265, 0.6), highlights: wheelAt(320, 0.45) } },
    pastel: { basic: { saturation: 75, contrast: -18, exposure: 0.25 }, creative: { fadedFilm: 20, highlightTint: { hue: 330, amount: 15 } } },
    'kodak-portra': { basic: { temperature: 14, contrast: -6, saturation: 92 }, hsl: { orange: { hue: 4, saturation: -8, luminance: 8 }, green: { hue: 10, saturation: -20, luminance: 0 } }, creative: { fadedFilm: 14 } },
    'fuji-velvia': { basic: { contrast: 20, saturation: 135 }, hsl: { green: { hue: -6, saturation: 25, luminance: -5 }, blue: { hue: 0, saturation: 30, luminance: -8 } } },
    blockbuster: { basic: { contrast: 28, highlights: -20, shadows: -15, saturation: 112 }, wheels: { shadows: wheelAt(190, 0.5, -0.05), highlights: wheelAt(32, 0.5) } },
    'day-for-night': { basic: { exposure: -1.2, temperature: -60, saturation: 60, contrast: 15 } },
};

export const LOOK_NAMES = {
    'teal-orange': 'Teal & orange',
    golden: 'Golden hour',
    moody: 'Moody',
    vintage: 'Vintage',
    'cross-process': 'Cross process',
    'bleach-bypass': 'Bleach bypass',
    matte: 'Matte',
    'film-warm': 'Warm film',
    'film-cool': 'Cool film',
    noir: 'Noir',
    sepia: 'Sepia',
    vivid: 'Vivid',
    faded: 'Faded',
    warm: 'Warm',
    cool: 'Cool',
    drama: 'Drama',
    neon: 'Neon',
    cyberpunk: 'Cyberpunk',
    pastel: 'Pastel',
    'kodak-portra': 'Portra film',
    'fuji-velvia': 'Velvia film',
    blockbuster: 'Blockbuster',
    'day-for-night': 'Day for night',
};

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** Monotone cubic (Fritsch–Carlson) through curve points, with the corners pinned. */
export function curveFunction(points) {
    const pts = [[0, 0], ...(points || []), [1, 1]]
        .sort((a, b) => a[0] - b[0])
        .filter((p, i, list) => i === 0 || p[0] - list[i - 1][0] > 1e-4);
    // Points the user placed at x=0 / x=1 replace the defaults.
    if (points?.some((p) => p[0] <= 1e-4)) pts.splice(0, 1);
    if (points?.some((p) => p[0] >= 1 - 1e-4)) pts.splice(pts.length - 1, 1);
    if (pts.length < 2) return (x) => x;
    const n = pts.length;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const d = [];
    for (let i = 0; i < n - 1; i += 1) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    const m = [d[0]];
    for (let i = 1; i < n - 1; i += 1) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
    m.push(d[n - 2]);
    for (let i = 0; i < n - 1; i += 1) {
        if (d[i] === 0) {
            m[i] = 0;
            m[i + 1] = 0;
            continue;
        }
        const a = m[i] / d[i];
        const b = m[i + 1] / d[i];
        const s = a * a + b * b;
        if (s > 9) {
            const t = 3 / Math.sqrt(s);
            m[i] = t * a * d[i];
            m[i + 1] = t * b * d[i];
        }
    }
    return (x) => {
        if (x <= xs[0]) return ys[0];
        if (x >= xs[n - 1]) return ys[n - 1];
        let i = 0;
        while (i < n - 2 && x > xs[i + 1]) i += 1;
        const h = xs[i + 1] - xs[i];
        const t = (x - xs[i]) / h;
        const t2 = t * t;
        const t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    };
}

/** Pure hue (0..360) as RGB, minus its mean: a colour direction for tints and wheels. */
function hueDirection(hue) {
    const h = (((hue % 360) + 360) % 360) / 60;
    const x = 1 - Math.abs((h % 2) - 1);
    const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
    const mean = (r + g + b) / 3;
    return [r - mean, g - mean, b - mean];
}

/** Wheel puck (x right, y up on the disc) → colour direction scaled by distance from centre. */
function wheelDirection(w) {
    const r = Math.min(1, Math.hypot(w.x, w.y));
    if (r < 1e-4) return [0, 0, 0];
    // Vectorscope layout (as in Lumetri): angle counter-clockwise from the right, red at ~103°.
    const hue = ((Math.atan2(w.y, w.x) * 180) / Math.PI - WHEEL_RED_ANGLE + 720) % 360;
    return hueDirection(hue).map((v) => v * r);
}

function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
    return [h, s, l];
}

function hslToRgb(h, s, l) {
    if (s <= 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
        t = ((t % 1) + 1) % 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const hh = h / 360;
    return [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)];
}

/** Samples a LUT ({ size, data: Float32Array of r,g,b }) trilinearly. */
export function sampleLut(lut, r, g, b) {
    const n = lut.size - 1;
    const fx = clamp01(r) * n;
    const fy = clamp01(g) * n;
    const fz = clamp01(b) * n;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const z0 = Math.floor(fz);
    const x1 = Math.min(n, x0 + 1);
    const y1 = Math.min(n, y0 + 1);
    const z1 = Math.min(n, z0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const tz = fz - z0;
    const at = (x, y, z, c) => lut.data[((z * lut.size + y) * lut.size + x) * 3 + c];
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c += 1) {
        const c00 = at(x0, y0, z0, c) * (1 - tx) + at(x1, y0, z0, c) * tx;
        const c10 = at(x0, y1, z0, c) * (1 - tx) + at(x1, y1, z0, c) * tx;
        const c01 = at(x0, y0, z1, c) * (1 - tx) + at(x1, y0, z1, c) * tx;
        const c11 = at(x0, y1, z1, c) * (1 - tx) + at(x1, y1, z1, c) * tx;
        out[c] = (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Per-pixel pipeline
// ---------------------------------------------------------------------------

/**
 * Builds the per-pixel function for settings `s` (already normalized).
 * @param {object} s
 * @param {object} [luts] imported LUTs by id ({ size, data }) for creative.look = 'lut:<id>'
 * @param {boolean} [nested] internal: looks are applied without their own creative look
 */
function compile(s, luts = {}, nested = false) {
    const B = s.basic;
    const C = s.creative;
    const temp = B.temperature / 100;
    const tint = B.tint / 100;
    // White balance gains in linear light, normalised so overall brightness holds.
    let wr = 1 + 0.22 * temp + 0.05 * tint;
    let wg = 1 - 0.14 * tint;
    let wb = 1 - 0.22 * temp + 0.05 * tint;
    const wl = luma(wr, wg, wb);
    wr /= wl;
    wg /= wl;
    wb /= wl;
    const exposure = Math.pow(2, B.exposure);
    const k = 1 + (B.contrast / 100) * 1.1;
    const hi = B.highlights / 100;
    const sh = B.shadows / 100;
    const wh = B.whites / 100;
    const bl = B.blacks / 100;
    const sat1 = B.saturation / 100;

    const look = C.look;
    let lookFn = null;
    if (!nested && look) {
        if (look.startsWith('lut:') && luts[look.slice(4)]) {
            const lut = luts[look.slice(4)];
            lookFn = (r, g, b) => sampleLut(lut, r, g, b);
        } else if (LOOK_PRESETS[look]) {
            lookFn = compile(normalizeColor(LOOK_PRESETS[look]), luts, true);
        }
    }
    const intensity = C.intensity / 100;
    const faded = C.fadedFilm / 100;
    const vib = C.vibrance / 100;
    const sat2 = C.saturation / 100;
    const shadowTint = hueDirection(C.shadowTint.hue).map((v) => (v * C.shadowTint.amount) / 100);
    const highlightTint = hueDirection(C.highlightTint.hue).map((v) => (v * C.highlightTint.amount) / 100);
    const balance = C.tintBalance / 100;

    const curveM = s.curves.master.length ? curveFunction(s.curves.master) : null;
    const curveR = s.curves.red.length ? curveFunction(s.curves.red) : null;
    const curveG = s.curves.green.length ? curveFunction(s.curves.green) : null;
    const curveB = s.curves.blue.length ? curveFunction(s.curves.blue) : null;

    const W = s.wheels;
    const liftDir = wheelDirection(W.shadows);
    const gammaDir = wheelDirection(W.midtones);
    const gainDir = wheelDirection(W.highlights);
    const lift = [0, 1, 2].map((c) => 0.12 * W.shadows.luma + 0.1 * liftDir[c]);
    const gamma = [0, 1, 2].map((c) => Math.max(0.2, 1 + 0.5 * W.midtones.luma + 0.35 * gammaDir[c]));
    const gain = [0, 1, 2].map((c) => Math.max(0, 1 + 0.4 * W.highlights.luma + 0.3 * gainDir[c]));
    const wheelsOn = lift.some((v) => v) || gamma.some((v) => v !== 1) || gain.some((v) => v !== 1);

    const bands = HSL_BANDS.filter((band) => s.hsl[band.id]).map((band) => ({ center: band.hue, shift: s.hsl[band.id].hue, saturation: s.hsl[band.id].saturation, luminance: s.hsl[band.id].luminance }));

    return (r0, g0, b0) => {
        let r = r0;
        let g = g0;
        let b = b0;

        // Basic: white balance and exposure in linear light.
        if (wr !== 1 || wg !== 1 || wb !== 1 || exposure !== 1) {
            r = toSrgb(toLinear(r) * wr * exposure);
            g = toSrgb(toLinear(g) * wg * exposure);
            b = toSrgb(toLinear(b) * wb * exposure);
        }
        // Contrast: S-curve around mid grey.
        if (k !== 1) {
            const sc = (x) => {
                x = clamp01(x);
                return x < 0.5 ? 0.5 * Math.pow(2 * x, k) : 1 - 0.5 * Math.pow(2 - 2 * x, k);
            };
            r = sc(r);
            g = sc(g);
            b = sc(b);
        }
        // Highlights, shadows, whites, blacks: tonal ranges weighted by luminance.
        if (hi || sh || wh || bl) {
            const L = clamp01(luma(r, g, b));
            const shadowW = 6.75 * L * (1 - L) * (1 - L);
            const highlightW = 6.75 * L * L * (1 - L);
            const dL = 0.22 * (sh * shadowW + hi * highlightW) + 0.18 * (bl * Math.pow(1 - L, 3) + wh * Math.pow(L, 3));
            r += dL;
            g += dL;
            b += dL;
        }
        if (sat1 !== 1) {
            const L = luma(r, g, b);
            r = L + (r - L) * sat1;
            g = L + (g - L) * sat1;
            b = L + (b - L) * sat1;
        }

        // Creative.
        if (lookFn && intensity > 0) {
            const [lr, lg, lb] = lookFn(clamp01(r), clamp01(g), clamp01(b));
            r += (lr - r) * intensity;
            g += (lg - g) * intensity;
            b += (lb - b) * intensity;
        }
        if (faded) {
            r = 0.1 * faded + r * (1 - 0.16 * faded);
            g = 0.1 * faded + g * (1 - 0.16 * faded);
            b = 0.1 * faded + b * (1 - 0.16 * faded);
        }
        if (vib) {
            const L = luma(r, g, b);
            const s0 = Math.max(r, g, b) - Math.min(r, g, b);
            const f = 1 + vib * (vib > 0 ? 1 - clamp01(s0) : 1);
            r = L + (r - L) * f;
            g = L + (g - L) * f;
            b = L + (b - L) * f;
        }
        if (sat2 !== 1) {
            const L = luma(r, g, b);
            r = L + (r - L) * sat2;
            g = L + (g - L) * sat2;
            b = L + (b - L) * sat2;
        }
        if (C.shadowTint.amount || C.highlightTint.amount) {
            const L = clamp01(luma(r, g, b));
            const pivot = 0.5 + 0.35 * balance;
            const sw = 0.35 * Math.pow(1 - smooth(0, pivot * 2, L), 1.5);
            const hw = 0.35 * Math.pow(smooth(pivot * 2 - 1, 1, L), 1.5);
            r += shadowTint[0] * sw + highlightTint[0] * hw;
            g += shadowTint[1] * sw + highlightTint[1] * hw;
            b += shadowTint[2] * sw + highlightTint[2] * hw;
        }

        // Curves: master, then per channel.
        if (curveM) {
            r = curveM(clamp01(r));
            g = curveM(clamp01(g));
            b = curveM(clamp01(b));
        }
        if (curveR) r = curveR(clamp01(r));
        if (curveG) g = curveG(clamp01(g));
        if (curveB) b = curveB(clamp01(b));

        // Colour wheels: lift (shadows), gamma (midtones), gain (highlights) per channel.
        if (wheelsOn) {
            const ch = [r, g, b];
            for (let c = 0; c < 3; c += 1) {
                let v = clamp01(ch[c]);
                v = gain[c] * (v + lift[c] * (1 - v));
                v = Math.pow(Math.max(v, 0), 1 / gamma[c]);
                ch[c] = v;
            }
            [r, g, b] = ch;
        }

        // HSL bands.
        if (bands.length) {
            let [h, sat, l] = rgbToHsl(clamp01(r), clamp01(g), clamp01(b));
            let dh = 0;
            let ds = 0;
            let dl = 0;
            for (const band of bands) {
                let dist = Math.abs(h - band.center);
                if (dist > 180) dist = 360 - dist;
                const w = Math.max(0, 1 - dist / 40);
                const ww = w * w * (3 - 2 * w) * Math.min(1, sat * 4);
                dh += ww * band.shift * 0.3;
                ds += (ww * band.saturation) / 100;
                dl += (ww * band.luminance) / 100;
            }
            h = (h + dh + 360) % 360;
            sat = clamp01(sat * (1 + ds));
            l = clamp01(l + dl * 0.25 * Math.min(1, sat * 3));
            [r, g, b] = hslToRgb(h, sat, l);
        }

        return [clamp01(r), clamp01(g), clamp01(b)];
    };
}

/**
 * The 3D LUT for these settings: { size, data: Float32Array } with r varying fastest
 * (the .cube convention).
 */
export function buildLut(raw, luts = {}, size = LUT_SIZE) {
    const fn = compile(normalizeColor(raw), luts);
    const data = new Float32Array(size * size * size * 3);
    let i = 0;
    for (let bz = 0; bz < size; bz += 1) {
        for (let gy = 0; gy < size; gy += 1) {
            for (let rx = 0; rx < size; rx += 1) {
                const [r, g, b] = fn(rx / (size - 1), gy / (size - 1), bz / (size - 1));
                data[i++] = r;
                data[i++] = g;
                data[i++] = b;
            }
        }
    }
    return { size, data };
}

/** .cube text for a LUT. */
export function lutToCube(lut, title = 'Kengan grade') {
    const lines = [`TITLE "${title}"`, `LUT_3D_SIZE ${lut.size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
    for (let i = 0; i < lut.data.length; i += 3) lines.push(`${lut.data[i].toFixed(6)} ${lut.data[i + 1].toFixed(6)} ${lut.data[i + 2].toFixed(6)}`);
    return lines.join('\n') + '\n';
}

/** Parses a .cube file (3D LUTs, any size; larger ones are resampled to 33). */
export function parseCube(text) {
    let size = 0;
    let min = [0, 0, 0];
    let max = [1, 1, 1];
    const values = [];
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const parts = line.split(/\s+/);
        if (parts[0] === 'LUT_3D_SIZE') size = Number(parts[1]);
        else if (parts[0] === 'DOMAIN_MIN') min = parts.slice(1, 4).map(Number);
        else if (parts[0] === 'DOMAIN_MAX') max = parts.slice(1, 4).map(Number);
        else if (parts[0] === 'LUT_1D_SIZE') throw new Error('1D LUTs are not supported; use a 3D .cube LUT.');
        else if (/^[-+\d.eE]/.test(parts[0]) && parts.length >= 3) values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
    }
    if (!size || size < 2 || size > 129) throw new Error('This .cube file has no valid LUT_3D_SIZE.');
    if (values.length < size * size * size * 3) throw new Error('This .cube file is incomplete.');
    const scaled = new Float32Array(size * size * size * 3);
    for (let i = 0; i < scaled.length; i += 1) {
        const c = i % 3;
        scaled[i] = clamp01((values[i] - min[c]) / (max[c] - min[c] || 1));
    }
    const lut = { size, data: scaled };
    if (size <= LUT_SIZE) return lut;
    const out = new Float32Array(LUT_SIZE ** 3 * 3);
    let i = 0;
    for (let z = 0; z < LUT_SIZE; z += 1)
        for (let y = 0; y < LUT_SIZE; y += 1)
            for (let x = 0; x < LUT_SIZE; x += 1) {
                const v = sampleLut(lut, x / (LUT_SIZE - 1), y / (LUT_SIZE - 1), z / (LUT_SIZE - 1));
                out[i++] = v[0];
                out[i++] = v[1];
                out[i++] = v[2];
            }
    return { size: LUT_SIZE, data: out };
}

/**
 * Vignette strength at a point (u, v in 0..1 across the frame): multiply factor for darkening
 * (amount < 0, like Lumetri) or a white mix for lightening (amount > 0).
 * Returns { dark, light }: rgb' = rgb * dark + (1 - rgb) * light.
 */
export function vignetteAt(vig, u, v, aspect) {
    if (!vig || !vig.amount) return { dark: 1, light: 0 };
    const roundness = vig.roundness / 100;
    let dx = (u - 0.5) * 2;
    let dy = (v - 0.5) * 2;
    // Roundness 0 = ellipse matching the frame, 100 = circle, -100 = rounded rectangle.
    if (roundness > 0) {
        if (aspect > 1) dx *= 1 + roundness * (aspect - 1);
        else dy *= 1 + roundness * (1 / aspect - 1);
    }
    const p = roundness < 0 ? 2 - roundness * 6 : 2;
    const d = Math.pow(Math.pow(Math.abs(dx), p) + Math.pow(Math.abs(dy), p), 1 / p) / Math.pow(2, 1 / p);
    const mid = 0.25 + (vig.midpoint / 100) * 0.7;
    const feather = 0.02 + (vig.feather / 100) * 0.9;
    const t = smooth(mid - feather / 2, mid + feather / 2, d);
    const a = Math.abs(vig.amount) / 100;
    return vig.amount < 0 ? { dark: 1 - a * t, light: 0 } : { dark: 1, light: a * t * 0.85 };
}
