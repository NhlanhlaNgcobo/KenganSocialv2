import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { ensureBrowser } from '@remotion/renderer';
import { assertPublicUrl, safeGet } from '../../utils/safe-fetch.js';
import { hostIsPublic } from '../brag/inspect.js';

/**
 * Builds a brand kit suggestion from a website: logo candidates, a colour palette with roles,
 * heading/body fonts and social profiles. Nothing is saved here; the user reviews and saves.
 *
 * Colour sources, strongest first: CSS custom properties named like brand/primary/accent,
 * button and link colours, theme-color, then dominant colours of an above-the-fold screenshot.
 * Every fetch and every browser request is restricted to public hosts (SSRF protection).
 */

const SOCIAL_HOSTS = {
    instagram: /(^|\.)instagram\.com$/i,
    facebook: /(^|\.)(facebook|fb)\.com$/i,
    tiktok: /(^|\.)tiktok\.com$/i,
    x: /(^|\.)(x|twitter)\.com$/i,
    linkedin: /(^|\.)linkedin\.com$/i,
    youtube: /(^|\.)(youtube\.com|youtu\.be)$/i,
    pinterest: /(^|\.)pinterest\.[a-z.]+$/i,
    threads: /(^|\.)threads\.(net|com)$/i,
};

// ─── Colour helpers ──────────────────────────────────────────────────────────

function parseColor(value) {
    if (!value || typeof value !== 'string') return null;
    const v = value.trim().toLowerCase();
    let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (m) {
        const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
        return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    }
    m = v.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
    if (m) {
        const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        if (alpha < 0.5) return null; // transparent backgrounds say nothing about the brand
        return [m[1], m[2], m[3]].map((n) => Math.max(0, Math.min(255, Math.round(parseFloat(n)))));
    }
    return null;
}

export const toHex = (rgb) => `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`;

function toLab([r, g, b]) {
    const lin = (c) => {
        const x = c / 255;
        return x > 0.04045 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92;
    };
    const [R, G, B] = [lin(r), lin(g), lin(b)];
    const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

const deltaE = (a, b) => {
    const [l1, a1, b1] = toLab(a);
    const [l2, a2, b2] = toLab(b);
    return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

/** Perceptual colourfulness (Lab chroma). HSL saturation overrates near-white and near-black greys. */
function chroma(rgb) {
    const [, a, b] = toLab(rgb);
    return Math.hypot(a, b);
}

export function relativeLuminance([r, g, b]) {
    const lin = (c) => {
        const x = c / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(hexA, hexB) {
    const a = parseColor(hexA);
    const b = parseColor(hexB);
    if (!a || !b) return null;
    const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

const isNeutral = (rgb) => chroma(rgb) < 12;

/** Dominant colours of an image: coarse histogram over a small thumbnail. */
async function dominantColors(imageBuffer, count = 8) {
    const { data, info } = await sharp(imageBuffer).resize(96, 60, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const buckets = new Map();
    for (let i = 0; i < data.length; i += info.channels) {
        const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
        const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        b.n += 1;
        b.r += data[i];
        b.g += data[i + 1];
        b.b += data[i + 2];
        buckets.set(key, b);
    }
    const total = data.length / info.channels;
    return [...buckets.values()]
        .sort((a, b) => b.n - a.n)
        .slice(0, count * 3)
        .map((b) => ({ rgb: [Math.round(b.r / b.n), Math.round(b.g / b.n), Math.round(b.b / b.n)], share: b.n / total }));
}

// ─── HTML helpers ────────────────────────────────────────────────────────────

function absolute(url, base) {
    try {
        return url ? new URL(url, base).toString() : null;
    } catch {
        return null;
    }
}

function jsonLdLogos(html, base) {
    const logos = [];
    for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
            const visit = (node) => {
                if (!node || typeof node !== 'object') return;
                if (Array.isArray(node)) return node.forEach(visit);
                const logo = node.logo;
                if (logo) logos.push(absolute(typeof logo === 'string' ? logo : logo.url || logo.contentUrl, base));
                Object.values(node).forEach((v) => typeof v === 'object' && visit(v));
            };
            visit(JSON.parse(m[1]));
        } catch {
            /* invalid JSON-LD is common; ignore */
        }
    }
    return logos.filter(Boolean);
}

async function fetchImageData(url, maxBytes = 1.5 * 1024 * 1024) {
    if (!url) return null;
    if (url.startsWith('data:image/')) return url.length < maxBytes * 1.4 ? url : null;
    try {
        const { data, headers } = await safeGet(url, { responseType: 'arraybuffer', maxBytes, timeout: 10000 });
        const type = String(headers['content-type'] || '').split(';')[0].trim();
        if (!/^image\/(png|jpe?g|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(type)) return null;
        return `data:${type};base64,${Buffer.from(data).toString('base64')}`;
    } catch {
        return null;
    }
}

// ─── Browser pass ────────────────────────────────────────────────────────────

async function renderPage(url) {
    const { path: executablePath } = await ensureBrowser();
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], timeout: 90000 });
    const hostCache = new Map();
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
        await page.setRequestInterception(true);
        page.on('request', async (req) => {
            try {
                const u = new URL(req.url());
                if (u.protocol === 'data:' || u.protocol === 'blob:') return req.continue();
                if (!['http:', 'https:'].includes(u.protocol) || !(await hostIsPublic(u.hostname, hostCache))) return req.abort();
                return req.continue();
            } catch {
                return req.abort();
            }
        });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
        await page
            .evaluate(() => {
                const words = /^(accept|accept all|agree|got it|ok|allow all|i agree)$/i;
                for (const b of document.querySelectorAll('button, a')) {
                    if (words.test((b.textContent || '').trim())) {
                        b.click();
                        break;
                    }
                }
            })
            .catch(() => {});
        await new Promise((r) => setTimeout(r, 800));

        const info = await page.evaluate(() => {
            const cs = (el) => (el ? getComputedStyle(el) : null);
            const root = getComputedStyle(document.documentElement);
            const vars = [];
            for (const sheet of [...document.styleSheets]) {
                let rules;
                try {
                    rules = sheet.cssRules;
                } catch {
                    continue; // cross-origin stylesheet
                }
                for (const rule of [...(rules || [])]) {
                    if (rule.selectorText && /(^|,)\s*(:root|html|body)\s*(,|$)/.test(rule.selectorText)) {
                        for (const name of [...rule.style]) {
                            if (name.startsWith('--') && /(brand|primary|secondary|accent|main|theme)/i.test(name)) {
                                vars.push({ name, value: root.getPropertyValue(name).trim() });
                            }
                        }
                    }
                }
            }

            const header = document.querySelector('header, [role="banner"], nav');
            const buttons = [...document.querySelectorAll('button, a[class*="btn" i], a[class*="button" i], [role="button"]')].slice(0, 12);
            const links = [...document.querySelectorAll('main a, article a, p a')].slice(0, 12);
            const h1 = document.querySelector('h1');
            const body = cs(document.body);

            const logoCandidates = [];
            const scope = header || document.body;
            for (const img of [...scope.querySelectorAll('img')].slice(0, 20)) {
                const hint = `${img.className} ${img.id} ${img.alt} ${img.src}`.toLowerCase();
                const rect = img.getBoundingClientRect();
                if (rect.width < 16 || rect.top > 300) continue;
                logoCandidates.push({ src: img.currentSrc || img.src, logoHint: hint.includes('logo'), width: Math.round(rect.width), height: Math.round(rect.height), kind: 'img' });
            }
            for (const svg of [...scope.querySelectorAll('svg')].slice(0, 10)) {
                const rect = svg.getBoundingClientRect();
                const hint = `${svg.getAttribute('class') || ''} ${svg.id} ${svg.closest('a')?.getAttribute('aria-label') || ''} ${svg.closest('[class*="logo" i]') ? 'logo' : ''}`.toLowerCase();
                if (rect.width < 40 || rect.top > 300) continue;
                const clone = svg.cloneNode(true);
                clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                if (!clone.getAttribute('width')) clone.setAttribute('width', String(Math.round(rect.width)));
                if (!clone.getAttribute('height')) clone.setAttribute('height', String(Math.round(rect.height)));
                const fill = getComputedStyle(svg).color;
                const markup = clone.outerHTML.replace(/currentColor/g, fill);
                if (markup.length < 200000) logoCandidates.push({ svg: markup, logoHint: hint.includes('logo'), width: Math.round(rect.width), height: Math.round(rect.height), kind: 'svg' });
            }

            // Visible copy, as a visitor reads it (used to understand the business).
            const visible = (sel, n, min = 1, max = 400) =>
                [...document.querySelectorAll(sel)]
                    .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())
                    .filter((t) => t.length >= min && t.length <= max)
                    .filter((t, i, all) => all.indexOf(t) === i)
                    .slice(0, n);
            const copy = {
                headings: visible('h1, h2, h3', 24, 3, 160),
                paragraphs: visible('main p, section p, article p, p', 30, 40, 600),
                ctas: visible('button, a[class*="btn" i], a[class*="button" i]', 12, 2, 40),
                nav: visible('nav a, header a', 16, 2, 30),
                listItems: visible('main li, section li', 30, 6, 160),
            };

            const manifest = document.querySelector('link[rel="manifest"]')?.href || null;
            const fontLinks = [...document.querySelectorAll('link[href*="fonts.googleapis.com"]')].map((l) => l.href);
            const socials = [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /^https?:/i.test(h));

            return {
                vars,
                header: header ? { background: cs(header).backgroundColor, text: cs(header).color } : null,
                buttons: buttons.map((b) => ({ background: cs(b).backgroundColor, text: cs(b).color, border: cs(b).borderColor })),
                links: links.map((a) => cs(a).color),
                heading: h1 ? cs(h1).color : null,
                background: body.backgroundColor,
                text: body.color,
                fonts: { body: body.fontFamily, heading: h1 ? cs(h1).fontFamily : null },
                logoCandidates,
                manifest,
                fontLinks,
                socials,
                copy,
            };
        });
        const screenshot = await page.screenshot({ type: 'png' });
        // A second, lower screen of the page helps the AI see products/offers below the fold.
        await page.evaluate(() => window.scrollTo(0, window.innerHeight)).catch(() => {});
        await new Promise((r) => setTimeout(r, 600));
        const screenshot2 = await page.screenshot({ type: 'png' }).catch(() => null);
        return { ...info, screenshot, screenshot2 };
    } finally {
        await browser.close().catch(() => {});
    }
}

// ─── Assembly ────────────────────────────────────────────────────────────────

function pickPalette(candidates, background, text, pageColors = []) {
    // candidates: [{ rgb, weight, source }]
    const merged = [];
    for (const c of candidates) {
        const near = merged.find((m) => deltaE(m.rgb, c.rgb) < 12);
        if (near) {
            near.weight += c.weight;
            near.sources.add(c.source);
        } else merged.push({ rgb: c.rgb, weight: c.weight, sources: new Set([c.source]) });
    }
    const brand = merged.filter((m) => !isNeutral(m.rgb)).sort((a, b) => b.weight - a.weight);
    const neutrals = merged.filter((m) => isNeutral(m.rgb)).sort((a, b) => b.weight - a.weight);
    const distinct = [];
    for (const m of brand) if (distinct.every((d) => deltaE(d.rgb, m.rgb) > 20)) distinct.push(m);

    // The page's own background is the colour covering most of the screenshot; the computed body
    // background is often transparent or hidden behind wrappers.
    const dominant = [...pageColors].sort((a, b) => b.share - a.share)[0];
    const bg = dominant && dominant.share > 0.25 ? dominant.rgb : background || neutrals[0]?.rgb || [255, 255, 255];
    const readable = (c) => {
        if (!c) return false;
        const [hi, lo] = [relativeLuminance(c), relativeLuminance(bg)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05) >= 4.5;
    };
    const fg = readable(text) ? text : relativeLuminance(bg) > 0.4 ? [17, 17, 17] : [245, 245, 245];
    return {
        primary: distinct[0] ? toHex(distinct[0].rgb) : toHex(fg),
        secondary: distinct[1] ? toHex(distinct[1].rgb) : null,
        accent: distinct[2] ? toHex(distinct[2].rgb) : distinct[1] ? toHex(distinct[1].rgb) : null,
        background: toHex(bg),
        text: toHex(fg),
        extra: [...distinct.slice(3, 6), ...neutrals.slice(0, 2)].map((m) => toHex(m.rgb)),
    };
}

const cleanFont = (family) =>
    family
        ? family
              .split(',')[0]
              .replace(/["']/g, '')
              .trim() || null
        : null;

function googleFontFamilies(links) {
    const names = new Set();
    for (const href of links || []) {
        try {
            const u = new URL(href);
            for (const fam of u.searchParams.getAll('family')) for (const part of fam.split('|')) names.add(part.split(':')[0].replace(/\+/g, ' ').trim());
        } catch {
            /* ignore */
        }
    }
    return [...names].filter(Boolean);
}

/**
 * @returns {Promise<{ url, name, tagline, logos: Array<{dataUrl, source}>, colors, fonts, socials }>}
 */
export async function extractBrandFromWebsite(rawUrl) {
    const withScheme = /^https?:\/\//i.test(String(rawUrl || '').trim()) ? String(rawUrl).trim() : `https://${String(rawUrl || '').trim()}`;
    const url = (await assertPublicUrl(withScheme)).toString();
    const { data: html, url: finalUrl } = await safeGet(url, { maxBytes: 3 * 1024 * 1024, timeout: 15000 });
    const page = String(html);
    const meta = (name) =>
        page.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'))?.[1] ||
        page.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i'))?.[1] ||
        null;
    const linkHref = (rel) => absolute(page.match(new RegExp(`<link[^>]+rel=["'][^"']*${rel}[^"']*["'][^>]*>`, 'i'))?.[0]?.match(/href=["']([^"']+)["']/i)?.[1], finalUrl);

    let rendered = null;
    try {
        rendered = await renderPage(finalUrl);
    } catch (error) {
        console.warn('[Brand] Browser pass failed, using HTML only:', error.message);
    }

    // Logos, best first.
    const logoSources = [];
    for (const l of jsonLdLogos(page, finalUrl)) logoSources.push({ url: l, source: 'Schema.org logo', rank: 1 });
    for (const c of rendered?.logoCandidates || []) {
        if (c.kind === 'svg') logoSources.push({ dataUrl: `data:image/svg+xml;base64,${Buffer.from(c.svg).toString('base64')}`, source: 'Header SVG', rank: c.logoHint ? 2 : 4 });
        else logoSources.push({ url: c.src, source: 'Header image', rank: c.logoHint ? 2 : 5 });
    }
    logoSources.push({ url: linkHref('apple-touch-icon'), source: 'App icon', rank: 3 });
    if (rendered?.manifest) {
        try {
            const { data } = await safeGet(rendered.manifest, { maxBytes: 200 * 1024, timeout: 8000 });
            const manifest = typeof data === 'string' ? JSON.parse(data) : data;
            const icon = [...(manifest.icons || [])].sort((a, b) => parseInt(b.sizes || '0', 10) - parseInt(a.sizes || '0', 10))[0];
            if (icon?.src) logoSources.push({ url: absolute(icon.src, rendered.manifest), source: 'Web app icon', rank: 3 });
        } catch {
            /* no usable manifest */
        }
    }
    logoSources.push({ url: linkHref('icon'), source: 'Favicon', rank: 6 });
    logoSources.push({ url: absolute(meta('og:image'), finalUrl), source: 'Social share image', rank: 7 });

    const seen = new Set();
    const logos = [];
    for (const c of logoSources.filter((s) => s.url || s.dataUrl).sort((a, b) => a.rank - b.rank)) {
        const key = c.dataUrl ? c.dataUrl.slice(0, 200) : c.url;
        if (seen.has(key)) continue;
        seen.add(key);
        const dataUrl = c.dataUrl || (await fetchImageData(c.url));
        if (dataUrl) logos.push({ dataUrl, source: c.source });
        if (logos.length >= 4) break;
    }

    // Colours.
    const candidates = [];
    const add = (value, weight, source) => {
        const rgb = typeof value === 'string' ? parseColor(value) : value;
        if (rgb) candidates.push({ rgb, weight, source });
    };
    for (const v of rendered?.vars || []) add(v.value, /brand|primary/i.test(v.name) ? 6 : 4, `CSS ${v.name}`);
    for (const b of rendered?.buttons || []) {
        add(b.background, 3, 'Buttons');
        add(b.border, 1, 'Button borders');
    }
    for (const l of rendered?.links || []) add(l, 1.5, 'Links');
    add(rendered?.heading, 1.5, 'Headings');
    add(rendered?.header?.background, 2, 'Header');
    add(meta('theme-color'), 3, 'Theme colour');
    let pageColors = [];
    if (rendered?.screenshot) {
        try {
            pageColors = await dominantColors(rendered.screenshot);
            for (const d of pageColors) if (d.share > 0.01) add(d.rgb, Math.min(4, d.share * 12), 'Page colours');
        } catch (error) {
            console.warn('[Brand] Palette sampling failed:', error.message);
        }
    }
    const colors = pickPalette(candidates, parseColor(rendered?.background), parseColor(rendered?.text), pageColors);

    // Fonts.
    const googleFonts = googleFontFamilies(rendered?.fontLinks);
    const heading = cleanFont(rendered?.fonts?.heading) || cleanFont(rendered?.fonts?.body);
    const body = cleanFont(rendered?.fonts?.body);
    const fonts = {
        heading,
        body,
        googleFonts,
        headingIsGoogleFont: heading ? googleFonts.some((f) => f.toLowerCase() === heading.toLowerCase()) : false,
        bodyIsGoogleFont: body ? googleFonts.some((f) => f.toLowerCase() === body.toLowerCase()) : false,
    };

    // Social profiles.
    const anchors = rendered?.socials || [...page.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1]);
    const socials = [];
    for (const href of anchors) {
        try {
            const u = new URL(href);
            const platform = Object.entries(SOCIAL_HOSTS).find(([, re]) => re.test(u.hostname))?.[0];
            if (!platform || u.pathname.length < 2 || /\/(sharer|share|intent|dialog|plugins|watch|embed|hashtag|p|reel|status|explore|search)\b/i.test(u.pathname)) continue;
            // YouTube: only channel addresses, not individual videos.
            if (platform === 'youtube' && !/^\/(@|c\/|channel\/|user\/)/i.test(u.pathname)) continue;
            if (!socials.some((s) => s.platform === platform)) socials.push({ platform, url: `${u.origin}${u.pathname}`.replace(/\/$/, '') });
        } catch {
            /* ignore */
        }
    }

    // Brand name: og:site_name, application-name, schema.org Organization name, a short page title, then the domain.
    const ldName = (() => {
        for (const m of page.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
            try {
                const nodes = [].concat(JSON.parse(m[1])).flatMap((n) => (n && n['@graph'] ? n['@graph'] : [n]));
                const org = nodes.find((n) => n && /Organization|Corporation|LocalBusiness|Restaurant|Store|Brand/i.test(String(n['@type'])) && n.name);
                if (org) return String(org.name);
            } catch {
                /* ignore */
            }
        }
        return null;
    })();
    const titlePart = page.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.split(/[|\-–—:]/).map((s) => s.trim()).filter(Boolean).sort((a, b) => a.length - b.length)[0];
    const domainName = new URL(finalUrl).hostname.replace(/^www\./, '').split('.')[0];
    const name =
        meta('og:site_name') ||
        meta('application-name') ||
        ldName ||
        (titlePart && titlePart.length <= 30 ? titlePart : null) ||
        domainName.charAt(0).toUpperCase() + domainName.slice(1);
    // Copy for the business profile: rendered text when the browser pass worked, raw HTML otherwise.
    const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    const htmlAll = (tag, n, min = 1) =>
        [...page.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))]
            .map((m) => stripTags(m[1]))
            .filter((t) => t.length >= min && t.length <= 600)
            .slice(0, n);
    const copy = rendered?.copy || {
        headings: [...htmlAll('h1', 4, 3), ...htmlAll('h2', 12, 3), ...htmlAll('h3', 8, 3)],
        paragraphs: htmlAll('p', 30, 40),
        ctas: htmlAll('button', 12, 2),
        nav: [],
        listItems: htmlAll('li', 30, 6),
    };

    // JPEG copies of the screenshots for vision models (smaller than PNG).
    const screenshots = [];
    for (const shot of [rendered?.screenshot, rendered?.screenshot2].filter(Boolean)) {
        try {
            const jpeg = await sharp(shot).resize(1024, null, { withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
            screenshots.push(jpeg.toString('base64'));
        } catch {
            /* skip */
        }
    }

    return {
        url: finalUrl,
        name: String(name).slice(0, 80),
        tagline: (meta('description') || meta('og:description') || '').slice(0, 200),
        logos,
        colors,
        fonts,
        socials,
        copy,
        screenshots,
    };
}
