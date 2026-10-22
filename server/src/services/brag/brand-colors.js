import sharp from 'sharp';

/**
 * Brand colours for launch and tutorial videos. The video must look like the product it is made
 * for, so every colour comes from the site itself: CSS brand variables, theme-color, its calls to
 * action, header, links, logo and icon. Nothing is replaced with a Kengan colour; a black-and-white
 * brand stays black and white.
 */

// ---------------------------------------------------------------------------
// In the page (passed to page.evaluate, so it must be self-contained)
// ---------------------------------------------------------------------------

export const COLLECT_BRAND_COLORS = () => {
    const out = [];
    const add = (color, weight, source) => {
        if (color && typeof color === 'string' && weight > 0) out.push({ color: color.trim(), weight: Math.round(weight * 10) / 10, source });
    };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const transparent = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
    const visibleBox = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 6 || r.height < 6 || r.bottom <= 0 || r.top >= vh * 2.5) return null;
        const s = getComputedStyle(el);
        if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) < 0.15) return null;
        return r;
    };
    const gradientColors = (bgImage) => (String(bgImage || '').match(/(rgba?|hsla?|oklch|oklab|lab|lch|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi) || []);

    // 1. Brand custom properties declared on :root / html / body (shadcn, Tailwind, design systems).
    const rootStyle = getComputedStyle(document.documentElement);
    const names = new Set();
    for (const sheet of [...document.styleSheets]) {
        let rules;
        try {
            rules = sheet.cssRules;
        } catch {
            continue; // cross-origin stylesheet
        }
        for (const rule of [...(rules || [])]) {
            if (!rule.selectorText || !/(^|,)\s*(:root|html|body)\s*(,|$)/.test(rule.selectorText)) continue;
            for (const prop of [...rule.style]) if (prop.startsWith('--')) names.add(prop);
        }
    }
    for (const name of names) {
        if (!/(primary|brand|accent|theme|cta|highlight|main-color|color-main)/i.test(name)) continue;
        if (/(foreground|-fg|text|border|ring|muted|shadow|radius|font|size|width|spacing|hover|active|focus|disabled|light|dark|\d{2,3}$)/i.test(name)) continue;
        const value = rootStyle.getPropertyValue(name).trim();
        if (value) add(value, 45, `var ${name}`);
    }

    // 2. theme-color meta.
    const theme = document.querySelector('meta[name="theme-color"]')?.content;
    if (theme) add(theme, 30, 'theme-color');

    // 3. Calls to action and buttons, weighted by size and how high on the page they sit.
    const CTA = /get started|start|try|sign ?up|join|create|book|demo|download|install|buy|subscribe|free|contact|learn more|shop/i;
    let buttons = 0;
    for (const el of document.querySelectorAll('button, a, [role="button"], input[type="submit"]')) {
        if (buttons > 60) break;
        const r = visibleBox(el);
        if (!r) continue;
        const s = getComputedStyle(el);
        const text = (el.innerText || el.value || '').trim();
        const buttonLike = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || /btn|button|cta/i.test(String(el.className || '')) || !transparent(s.backgroundColor);
        const prominence = (r.top < vh ? 2 : 1) * (CTA.test(text) ? 1.8 : 1);
        // Some sites paint buttons with a pseudo-element (e.g. ::before) and leave the element clear.
        const pseudo = ['::before', '::after'].map((p) => getComputedStyle(el, p).backgroundColor).find((c) => !transparent(c));
        const fill = !transparent(s.backgroundColor) ? s.backgroundColor : pseudo;
        if (buttonLike && fill) {
            add(fill, Math.min(30, (r.width * r.height) / 800) * prominence, 'button');
            buttons += 1;
        } else if (buttonLike) {
            for (const c of gradientColors(s.backgroundImage)) add(c, 10 * prominence, 'button gradient');
            if (!transparent(s.borderTopColor) && parseFloat(s.borderTopWidth) >= 1) add(s.borderTopColor, 4 * prominence, 'button border');
        }
        if (el.tagName === 'A' && !buttonLike && text) add(s.color, 0.4, 'link');
    }

    // 4. Headings: colour and gradient text.
    for (const el of [...document.querySelectorAll('h1, h1 *, h2')].slice(0, 30)) {
        if (!visibleBox(el)) continue;
        const s = getComputedStyle(el);
        for (const c of gradientColors(s.backgroundImage)) add(c, 14, 'heading gradient');
        add(s.color, el.tagName === 'H1' ? 6 : 2, 'heading');
    }

    // 5. Header / nav background and logo.
    let logoUrl = null;
    for (const el of document.querySelectorAll('header, nav, [class*="navbar"], [class*="header"]')) {
        const r = visibleBox(el);
        if (!r || r.top > vh) continue;
        const s = getComputedStyle(el);
        if (!transparent(s.backgroundColor)) add(s.backgroundColor, 8, 'header');
        for (const svg of el.querySelectorAll('svg')) {
            const box = visibleBox(svg);
            if (!box || box.left > vw * 0.5) continue;
            for (const part of [svg, ...svg.querySelectorAll('path, rect, circle, polygon, g')].slice(0, 25)) {
                const ps = getComputedStyle(part);
                // Unset fills compute to black, so plain black says nothing about the brand.
                if (ps.fill && ps.fill !== 'none' && !ps.fill.startsWith('url') && ps.fill !== 'rgb(0, 0, 0)') add(ps.fill, 3, 'logo svg');
            }
        }
        if (!logoUrl) {
            const img = el.querySelector('img[src*="logo" i], img[alt*="logo" i], img[class*="logo" i], a[href="/"] img');
            if (img?.currentSrc || img?.src) logoUrl = img.currentSrc || img.src;
        }
    }

    // 6. Large coloured sections (hero bands, feature blocks).
    for (const el of [...document.querySelectorAll('section, main > div, [class*="hero"]')].slice(0, 40)) {
        const r = visibleBox(el);
        if (!r) continue;
        const s = getComputedStyle(el);
        const area = (Math.min(r.width, vw) * Math.min(r.height, vh)) / (vw * vh);
        if (area < 0.08) continue;
        if (!transparent(s.backgroundColor)) add(s.backgroundColor, 12 * area, 'section');
        for (const c of gradientColors(s.backgroundImage)) add(c, 10 * area, 'section gradient');
    }

    const body = getComputedStyle(document.body);
    const html = getComputedStyle(document.documentElement);
    const h1 = document.querySelector('h1');
    return {
        background: transparent(body.backgroundColor) ? html.backgroundColor : body.backgroundColor,
        text: body.color,
        heading: h1 ? getComputedStyle(h1).color : null,
        candidates: out.slice(0, 300),
        logoUrl,
    };
};

// ---------------------------------------------------------------------------
// Colour parsing (hex, rgb, hsl, oklch/oklab, color(srgb), raw Tailwind/shadcn HSL triplets)
// ---------------------------------------------------------------------------

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const num = (s, scale = 1) => (String(s).endsWith('%') ? parseFloat(s) / 100 : parseFloat(s) / scale);

function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [r + m, g + m, b + m];
}

const linearToSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

function oklabToRgb(L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
        linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ];
}

/** @returns {{ r: number, g: number, b: number, a: number } | null} channels 0..255, alpha 0..1 */
export function parseColor(input) {
    const c = String(input || '').trim().toLowerCase();
    if (!c || c === 'transparent' || c === 'none' || c.startsWith('var(')) return null;
    const out = (rgb, a = 1) => {
        if (rgb.some((v) => !Number.isFinite(v))) return null;
        const [r, g, b] = rgb.map((v) => Math.round(clamp01(v) * 255));
        return { r, g, b, a: clamp01(a) };
    };

    let m = c.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
        let hex = m[1];
        if (hex.length === 3 || hex.length === 4) hex = [...hex].map((ch) => ch + ch).join('');
        if (hex.length !== 6 && hex.length !== 8) return null;
        const v = (i) => parseInt(hex.slice(i, i + 2), 16) / 255;
        return out([v(0), v(2), v(4)], hex.length === 8 ? v(6) : 1);
    }
    const args = (s) => s.replace(/[(),/]/g, ' ').trim().split(/\s+/).filter(Boolean);
    m = c.match(/^rgba?\((.*)\)$/);
    if (m) {
        const p = args(m[1]);
        return out([num(p[0], 255), num(p[1], 255), num(p[2], 255)], p[3] != null ? num(p[3]) : 1);
    }
    m = c.match(/^hsla?\((.*)\)$/);
    if (m) {
        const p = args(m[1]);
        return out(hslToRgb(parseFloat(p[0]), num(p[1], 100), num(p[2], 100)), p[3] != null ? num(p[3]) : 1);
    }
    m = c.match(/^oklch\((.*)\)$/);
    if (m) {
        const p = args(m[1]);
        const L = num(p[0]);
        const C = String(p[1]).endsWith('%') ? (parseFloat(p[1]) / 100) * 0.4 : parseFloat(p[1]);
        const h = (parseFloat(p[2]) || 0) * (Math.PI / 180);
        return out(oklabToRgb(L, C * Math.cos(h), C * Math.sin(h)), p[3] != null ? num(p[3]) : 1);
    }
    m = c.match(/^oklab\((.*)\)$/);
    if (m) {
        const p = args(m[1]);
        return out(oklabToRgb(num(p[0]), parseFloat(p[1]), parseFloat(p[2])), p[3] != null ? num(p[3]) : 1);
    }
    m = c.match(/^color\(srgb\s+(.*)\)$/);
    if (m) {
        const p = args(m[1]);
        return out([num(p[0]), num(p[1]), num(p[2])], p[3] != null ? num(p[3]) : 1);
    }
    // shadcn/Tailwind variables hold bare HSL triplets: "221.2 83.2% 53.3%".
    m = c.match(/^(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%$/);
    if (m) return out(hslToRgb(parseFloat(m[1]), parseFloat(m[2]) / 100, parseFloat(m[3]) / 100));
    return null;
}

const toHex = ({ r, g, b }) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Relative luminance (WCAG). */
function luminance({ r, g, b }) {
    const lin = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const contrast = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
};

function saturationOf({ r, g, b }) {
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    if (max === min) return 0;
    return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

const distance = (a, b) => Math.sqrt((a.r - b.r) ** 2 * 0.3 + (a.g - b.g) ** 2 * 0.59 + (a.b - b.b) ** 2 * 0.11);

/** Blends a colour over a background (for translucent brand colours). */
const over = (c, bg) => (c.a >= 1 ? c : { r: Math.round(c.r * c.a + bg.r * (1 - c.a)), g: Math.round(c.g * c.a + bg.g * (1 - c.a)), b: Math.round(c.b * c.a + bg.b * (1 - c.a)), a: 1 });

// ---------------------------------------------------------------------------
// Logo / icon colours
// ---------------------------------------------------------------------------

/** Dominant opaque colours of an image (data URL or buffer), most common first. */
export async function imageColors(image, limit = 4) {
    if (!image) return [];
    try {
        const buffer = Buffer.isBuffer(image) ? image : Buffer.from(String(image).split(',')[1] || '', 'base64');
        if (!buffer.length) return [];
        const { data, info } = await sharp(buffer, { density: 96 }).resize(48, 48, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const buckets = new Map();
        for (let i = 0; i < data.length; i += info.channels) {
            if (data[i + 3] < 160) continue;
            const key = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`;
            const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
            bucket.r += data[i];
            bucket.g += data[i + 1];
            bucket.b += data[i + 2];
            bucket.n += 1;
            buckets.set(key, bucket);
        }
        const total = [...buckets.values()].reduce((s, b) => s + b.n, 0) || 1;
        return [...buckets.values()]
            .sort((a, b) => b.n - a.n)
            .slice(0, limit)
            .map((b) => ({ color: toHex({ r: Math.round(b.r / b.n), g: Math.round(b.g / b.n), b: Math.round(b.b / b.n) }), share: b.n / total }));
    } catch {
        return [];
    }
}

/**
 * Strong colours visible on a screenshot (buttons, illustrations, highlights), as weighted
 * candidates. Catches brand colours the DOM sample misses (canvas, images, pseudo-elements).
 */
export async function screenshotCandidates(image) {
    if (!image) return [];
    try {
        const buffer = Buffer.from(String(image).split(',')[1] || '', 'base64');
        const { data, info } = await sharp(buffer).resize(160, 160, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const pixels = info.width * info.height;
        const buckets = new Map();
        for (let i = 0; i < data.length; i += info.channels) {
            const c = { r: data[i], g: data[i + 1], b: data[i + 2] };
            const lum = luminance(c);
            if (saturationOf(c) < 0.35 || lum < 0.02 || lum > 0.92) continue;
            const key = `${c.r >> 5},${c.g >> 5},${c.b >> 5}`;
            const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
            bucket.r += c.r;
            bucket.g += c.g;
            bucket.b += c.b;
            bucket.n += 1;
            buckets.set(key, bucket);
        }
        return [...buckets.values()]
            .filter((b) => b.n / pixels >= 0.003)
            .sort((a, b) => b.n - a.n)
            .slice(0, 3)
            .map((b) => ({ color: toHex({ r: Math.round(b.r / b.n), g: Math.round(b.g / b.n), b: Math.round(b.b / b.n) }), weight: Math.min(30, (b.n / pixels) * 600), source: 'screenshot' }));
    } catch {
        return [];
    }
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * @param {object} colors   page colours: { background, text, heading, accent?, candidates?: [{color, weight, source}] }
 * @param {Array} extra      more candidates, e.g. from the icon or logo
 * @returns {{ bg, fg, accent, accent2, accentText, monochrome, sources }} hex colours
 */
export function pickBrandPalette(colors = {}, extra = []) {
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const rawBg = parseColor(colors.background);
    const bg = rawBg && rawBg.a > 0.5 ? over(rawBg, white) : white;
    const bgDark = luminance(bg) < 0.4;

    let fg = parseColor(colors.text);
    fg = fg && fg.a > 0.3 ? over(fg, bg) : null;
    if (!fg || contrast(fg, bg) < 3) fg = bgDark ? white : { r: 17, g: 17, b: 20, a: 1 };

    // Weighted candidates (legacy single accent/heading fields included).
    const list = [
        ...(colors.candidates || []),
        ...(colors.accent ? [{ color: colors.accent, weight: 20, source: 'button' }] : []),
        ...(colors.heading ? [{ color: colors.heading, weight: 4, source: 'heading' }] : []),
        ...extra,
    ];
    const groups = [];
    let linkWeight = 0;
    for (const cand of list) {
        const parsed = parseColor(cand.color);
        if (!parsed || parsed.a < 0.35) continue;
        // Browser default link colours (#0000ee, #551a8b) are not brand colours.
        if ((parsed.r === 0 && parsed.g === 0 && parsed.b === 238) || (parsed.r === 85 && parsed.g === 26 && parsed.b === 139)) continue;
        if (cand.source === 'link') {
            if (linkWeight >= 8) continue;
            linkWeight += cand.weight;
        }
        const c = over(parsed, bg);
        if (distance(c, bg) < 22) continue; // the background itself
        const group = groups.find((g) => distance(g.color, c) < 28);
        if (group) {
            group.weight += cand.weight;
            group.sources.add(cand.source);
        } else {
            groups.push({ color: c, weight: cand.weight, sources: new Set([cand.source]) });
        }
    }
    for (const g of groups) g.saturation = saturationOf(g.color);
    const chromatic = groups.filter((g) => g.saturation >= 0.22 && luminance(g.color) > 0.015).sort((a, b) => b.weight - a.weight);
    const neutral = groups.filter((g) => g.saturation < 0.22).sort((a, b) => b.weight - a.weight);
    // Grey body text and links are not a brand statement; only neutral buttons, headers, logos and
    // sections compete with a chromatic brand colour.
    const TEXTUAL = new Set(['link', 'heading']);
    const brandNeutral = neutral.find((g) => [...g.sources].some((src) => !TEXTUAL.has(src)));

    let accent;
    let accent2 = null;
    let monochrome = false;
    // A colour on a button, a brand CSS variable, theme-color or the icon/logo is strong evidence; one
    // seen only in headings, inline SVG or screenshot pixels (could be a customer logo) needs more weight.
    const STRONG = /^(button|var |theme-color|icon|logo$)/;
    const qualifies = (g) => {
        const strong = [...g.sources].some((src) => STRONG.test(src));
        // Pale tints barely visible against the background are section fills, not the accent.
        return contrast(g.color, bg) >= 1.6 && g.weight >= Math.max(strong ? 2.5 : 4, (brandNeutral?.weight || 0) * (strong ? 0.05 : 0.3));
    };
    const brandColour = chromatic.find(qualifies);
    if (brandColour) {
        accent = brandColour.color;
        accent2 = chromatic.find((g) => g !== brandColour && qualifies(g) && distance(g.color, accent) > 60)?.color || null;
    } else {
        // Black-and-white brand: its own strongest non-background colour (often black CTAs on white).
        monochrome = true;
        accent = neutral.find((g) => contrast(g.color, bg) >= 3)?.color || fg;
    }
    if (!accent2) {
        // A lighter or darker shade of the accent, for gradients and glows.
        const shift = luminance(accent) > 0.5 ? -0.25 : 0.25;
        accent2 = {
            r: Math.round(accent.r + (shift > 0 ? (255 - accent.r) * shift : accent.r * shift)),
            g: Math.round(accent.g + (shift > 0 ? (255 - accent.g) * shift : accent.g * shift)),
            b: Math.round(accent.b + (shift > 0 ? (255 - accent.b) * shift : accent.b * shift)),
            a: 1,
        };
    }
    const accentText = contrast(white, accent) >= contrast({ r: 17, g: 17, b: 20, a: 1 }, accent) ? '#ffffff' : '#111114';
    return {
        bg: toHex(bg),
        fg: toHex(fg),
        accent: toHex(accent),
        accent2: toHex(accent2),
        accentText,
        monochrome,
        sources: groups
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 6)
            .map((g) => ({ color: toHex(g.color), weight: Math.round(g.weight), from: [...g.sources].join(', ') })),
    };
}

/** Palette for a launch/tutorial source: page colours plus the logo and app icon. */
export async function brandPalette(source = {}) {
    const extra = [];
    for (const [image, weight, label] of [
        [source.logoData, 30, 'logo'],
        [source.iconData, 18, 'icon'],
    ]) {
        for (const { color, share } of await imageColors(image)) extra.push({ color, weight: weight * share, source: label });
    }
    const firstShot = source.screenshots?.[0] || source.screenshot || null;
    extra.push(...(await screenshotCandidates(firstShot)));
    return pickBrandPalette(source.colors || {}, extra);
}
