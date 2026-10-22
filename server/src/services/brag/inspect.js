import dns from 'dns/promises';
import net from 'net';
import puppeteer from 'puppeteer-core';
import { ensureBrowser } from '@remotion/renderer';
import { assertPublicUrl, isPublicAddress, safeGet } from '../../utils/safe-fetch.js';
import { COLLECT_BRAND_COLORS } from './brand-colors.js';

/**
 * Step 1 of the launch-video pipeline (after /brag's "Inspect"): gather the real copy,
 * identity and visuals of a website, as a visitor sees it.
 */

export const FORMATS = {
    landscape: { width: 1920, height: 1080 },
    vertical: { width: 1080, height: 1920 },
    square: { width: 1080, height: 1080 },
};

const decode = (s) =>
    String(s || '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/\s+/g, ' ')
        .trim();

const stripTags = (html) => decode(String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));

function meta(html, key) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1]) : '';
}

function all(html, tag, limit) {
    const out = [];
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    let m;
    while ((m = re.exec(html)) && out.length < limit) {
        const text = stripTags(m[1]);
        if (text && text.length <= 160 && !out.includes(text)) out.push(text);
    }
    return out;
}

/** Parses copy and identity from raw HTML (works even when screenshots are unavailable). */
export function parseHtml(html, baseUrl) {
    const abs = (u) => {
        try {
            return u ? new URL(u, baseUrl).toString() : null;
        } catch {
            return null;
        }
    };
    const icon =
        html.match(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/i)?.[0] ||
        html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/i)?.[0];
    return {
        url: baseUrl,
        title: decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]),
        siteName: meta(html, 'og:site_name'),
        description: meta(html, 'description') || meta(html, 'og:description'),
        ogTitle: meta(html, 'og:title'),
        ogImage: abs(meta(html, 'og:image') || meta(html, 'twitter:image')),
        themeColor: meta(html, 'theme-color'),
        icon: abs(icon?.match(/href=["']([^"']+)["']/i)?.[1]),
        headings: [...all(html, 'h1', 3), ...all(html, 'h2', 8)],
        ctas: [...all(html, 'button', 8), ...all(html, 'a', 60).filter((t) => t.split(' ').length <= 4)].slice(0, 10),
        paragraphs: all(html, 'p', 12).filter((p) => p.length > 40),
    };
}

export async function hostIsPublic(host, cache) {
    if (cache.has(host)) return cache.get(host);
    let ok = false;
    if (host === 'localhost') ok = false;
    else if (net.isIP(host)) ok = isPublicAddress(host);
    else ok = (await dns.lookup(host, { all: true }).catch(() => [])).every((a) => isPublicAddress(a.address));
    cache.set(host, ok);
    return ok;
}

/** Lets the page load only public http(s) hosts (blocks requests into private networks). */
export async function guardPage(page, hostCache = new Map()) {
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
}

/** Dismisses common cookie banners so they don't sit on every screenshot. */
export async function dismissBanners(page) {
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
}

/** Renders the page in headless Chrome: rendered copy, computed colours/fonts, screenshots. */
async function capture(url, format) {
    const { path: executablePath } = await ensureBrowser();
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], timeout: 90000, protocolTimeout: 180000 });
    const hostCache = new Map();
    try {
        const page = await browser.newPage();
        const size = FORMATS[format];
        // A browser-sized viewport with the video's aspect ratio.
        const scale = format === 'landscape' ? 0.75 : 0.45;
        await page.setViewport({ width: Math.round(size.width * scale), height: Math.round(size.height * scale), deviceScaleFactor: 2 });
        await guardPage(page, hostCache);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
        await dismissBanners(page);

        const info = await page.evaluate(() => {
            // Animated headings often repeat their text (a visible copy plus a screen-reader copy).
            const clean = (t) => {
                const once = (t) => { const w = t.split(' '); for (const k of [2, 3, 4]) { if (w.length < k || w.length % k) continue; const n = w.length / k; const c = w.slice(0, n).join(' '); if (Array.from({ length: k }, (_, i) => w.slice(i * n, (i + 1) * n).join(' ')).every((x) => x === c)) return c; } return t; };
                return once(String(t || '').replace(/\s+/g, ' ').trim());
            };
            const text = (sel, n) => [...document.querySelectorAll(sel)].map((e) => clean(e.innerText)).filter((t) => t && t.length < 160).slice(0, n);
            const CTA = /^(get started|start\b|try\b|sign ?up|join\b|create\b|book\b|request\b|download\b|install\b|buy\b|subscribe\b|get .{1,20} free)/i;
            const actions = [...document.querySelectorAll('a, button')]
                .map((e) => clean(e.innerText))
                .filter((t) => t && t.split(' ').length <= 5 && CTA.test(t));
            const body = getComputedStyle(document.body);
            const h1 = document.querySelector('h1');
            const button = document.querySelector('a[class*="btn"], button, a[class*="button"]');
            return {
                headings: [...text('h1', 3), ...text('h2', 8)],
                ctas: [...new Set([...actions, ...text('button, a[class*="btn"], a[class*="button"]', 8)])].slice(0, 10),
                colors: {
                    background: body.backgroundColor,
                    text: body.color,
                    heading: h1 ? getComputedStyle(h1).color : null,
                    accent: button ? getComputedStyle(button).backgroundColor : null,
                },
                fonts: { body: body.fontFamily, heading: h1 ? getComputedStyle(h1).fontFamily : null },
                height: document.documentElement.scrollHeight,
            };
        });

        // Full brand sample (CSS variables, CTAs, header, logo), richer than the single button above.
        const brand = await page.evaluate(COLLECT_BRAND_COLORS).catch(() => null);
        if (brand) info.colors = { ...info.colors, ...brand };

        // The top of the page, then one shot per feature section (its heading near the top of the
        // frame), so each feature beat in the video shows the part of the page it talks about.
        const screenshots = [];
        const shotElements = [];
        const sections = [];
        const viewportH = page.viewport().height;
        // Long pages often build their sections lazily: glide down once so they exist before measuring.
        await page
            .evaluate(async (vh) => {
                for (let y = 0; y < Math.min(document.documentElement.scrollHeight, vh * 12); y += vh) {
                    window.scrollTo({ top: y, behavior: 'instant' });
                    await new Promise((r) => setTimeout(r, 120));
                }
                window.scrollTo({ top: 0, behavior: 'instant' });
            }, viewportH)
            .catch(() => {});
        await new Promise((r) => setTimeout(r, 500));
        const found = await page.evaluate(FEATURE_SECTIONS, 4).catch(() => []);
        const stops = [{ y: 0 }, ...found.map((s) => ({ y: Math.max(0, s.top - viewportH * 0.14), section: s }))];
        if (!found.length) for (const i of [1, 2]) stops.push({ y: i * viewportH });
        const seen = new Set();
        for (const stop of stops) {
            // The browser clamps the scroll at the end of the page; skip stops that land on a shot already taken.
            const y = await page.evaluate((top) => {
                window.scrollTo({ top, behavior: 'instant' }); // 'smooth' pages would still be at the top
                return Math.round(window.scrollY);
            }, Math.round(stop.y));
            if ([...seen].some((s) => Math.abs(s - y) < viewportH * 0.3)) continue;
            seen.add(y);
            await new Promise((r) => setTimeout(r, 700)); // let scroll-in animations settle
            const png = await page.screenshot({ type: 'jpeg', quality: 82 });
            screenshots.push(`data:image/jpeg;base64,${Buffer.from(png).toString('base64')}`);
            shotElements.push(await page.evaluate(VISIBLE_ELEMENTS).catch(() => []));
            if (stop.section) sections.push({ shot: screenshots.length - 1, heading: stop.section.text, text: stop.section.para });
        }
        return { ...info, screenshots, shotElements, sections };
    } finally {
        await browser.close().catch(() => {});
    }
}

/**
 * Runs in the page: the feature sections below the fold (an h2, else h3, heading with the
 * paragraph that explains it), spread down the page, at most `max`. `top` is the page offset.
 */
export const FEATURE_SECTIONS = (max) => {
    const clean = (t) => {
        const once = (t) => { const w = t.split(' '); for (const k of [2, 3, 4]) { if (w.length < k || w.length % k) continue; const n = w.length / k; const c = w.slice(0, n).join(' '); if (Array.from({ length: k }, (_, i) => w.slice(i * n, (i + 1) * n).join(' ')).every((x) => x === c)) return c; } return t; };
        return once(String(t || '').replace(/\s+/g, ' ').trim());
    };
    const vh = window.innerHeight;
    const docH = document.documentElement.scrollHeight;
    const pick = (tag) => {
        const out = [];
        for (const h of document.querySelectorAll(tag)) {
            const r = h.getBoundingClientRect();
            const style = getComputedStyle(h);
            if (r.width < 40 || r.height < 10 || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
            if (h.closest('footer, nav, header, dialog, [role="contentinfo"], [aria-hidden="true"]')) continue;
            const top = r.top + window.scrollY;
            const text = clean(h.innerText);
            if (text.length < 6 || text.length > 140 || top < vh * 0.6 || top > docH - vh * 0.5) continue;
            // Closing calls to action and logo walls are not features.
            if (/cookie|newsletter|subscribe|faq|frequently asked|footer|contact us|\u00a9|^(get started|start|try|sign up|join|ready|download)\b|trusted by|loved by|our customers|testimonials/i.test(text)) continue;
            let box = h.parentElement;
            let para = '';
            for (let k = 0; k < 4 && box && !para; k++, box = box.parentElement) {
                para = [...box.querySelectorAll('p')].map((p) => clean(p.innerText)).find((t) => t.length > 30 && t.length < 320 && t !== text) || '';
            }
            out.push({ text, top, para });
        }
        return out;
    };
    let list = pick('h2');
    if (list.length < 2) list = [...list, ...pick('h3')].sort((a, b) => a.top - b.top);
    const spaced = [];
    for (const s of list) if (!spaced.length || s.top - spaced[spaced.length - 1].top > vh * 0.7) spaced.push(s);
    if (spaced.length <= max) return spaced;
    return Array.from({ length: max }, (_, i) => spaced[Math.round((i * (spaced.length - 1)) / (max - 1))]);
};

/**
 * Runs in the page: buttons, links, fields and headings visible in the viewport, with boxes
 * in percent of the viewport. The video uses them to aim the cursor, zoom and spotlight.
 */
export const VISIBLE_ELEMENTS = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const CTA = /get started|start|try|sign ?up|join|create|book|demo|download|install|buy|subscribe|free/i;
    const out = [];
    for (const el of document.querySelectorAll('a, button, [role="button"], input, textarea, select, h1, h2, h3')) {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
        const tag = el.tagName.toLowerCase();
        const field = ['input', 'textarea', 'select'].includes(tag);
        if (field && ['hidden', 'checkbox', 'radio', 'submit'].includes(el.type)) continue;
        let text = (field ? el.placeholder || el.getAttribute('aria-label') || el.name || '' : el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        const once = (t) => { const w = t.split(' '); for (const k of [2, 3, 4]) { if (w.length < k || w.length % k) continue; const n = w.length / k; const c = w.slice(0, n).join(' '); if (Array.from({ length: k }, (_, i) => w.slice(i * n, (i + 1) * n).join(' ')).every((x) => x === c)) return c; } return t; };
        text = once(text);
        // Icon buttons often show only a shortcut key ("R"); their label says what they are ("Rectangle").
        const labelled = el.matches('[aria-label], [title]') ? el : el.querySelector('[aria-label], [title]');
        const label = (labelled?.getAttribute('aria-label') || labelled?.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
        if (!field && text.length <= 2 && label.length > 2) text = label.replace(/\s+[—–-]\s+\S{1,3}$/, '');
        text = text.slice(0, 80);
        if (!text && !field) continue;
        const hint = label && label.toLowerCase() !== text.toLowerCase() ? label.slice(0, 100) : '';
        const buttonLike = tag === 'button' || el.getAttribute('role') === 'button' || /btn|button|cta/i.test(String(el.className || ''));
        const kind = field ? 'field' : /^h[1-3]$/.test(tag) ? 'heading' : buttonLike ? 'button' : 'link';
        const priority = (kind === 'button' && CTA.test(text) ? 5 : 0) + (kind === 'field' ? 4 : 0) + (tag === 'h1' ? 4 : 0) + (kind === 'button' ? 2 : 0) + (tag === 'h2' ? 1 : 0);
        out.push({
            kind,
            tag,
            text,
            href: tag === 'a' ? el.href : null,
            inputType: field ? el.type || tag : null,
            x: (Math.max(0, r.left) / vw) * 100,
            y: (Math.max(0, r.top) / vh) * 100,
            w: (Math.min(r.right, vw) - Math.max(0, r.left)) / vw * 100,
            h: (Math.min(r.bottom, vh) - Math.max(0, r.top)) / vh * 100,
            priority,
            ...(hint ? { hint } : {}),
        });
    }
    return out.sort((a, b) => b.priority - a.priority).slice(0, 16);
};

async function fetchImage(url) {
    if (!url) return null;
    try {
        const { data, headers } = await safeGet(url, { responseType: 'arraybuffer', maxBytes: 3 * 1024 * 1024 });
        const type = String(headers['content-type'] || '').split(';')[0];
        if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(type)) return null;
        return `data:${type};base64,${Buffer.from(data).toString('base64')}`;
    } catch {
        return null;
    }
}

/**
 * @returns {Promise<object>} copy, identity and visuals for the planner.
 */
export async function inspectWebsite(rawUrl, format, onStage = () => {}) {
    const withScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const url = (await assertPublicUrl(withScheme)).toString();

    onStage('Reading the site');
    const { data: html, url: finalUrl } = await safeGet(url, { maxBytes: 3 * 1024 * 1024 });
    const parsed = parseHtml(String(html), finalUrl);

    onStage('Capturing screenshots');
    let rendered = null;
    try {
        rendered = await capture(finalUrl, format);
    } catch (error) {
        console.warn('[Brag] Screenshot capture failed:', error.message);
    }

    const [ogImage, icon, logo] = await Promise.all([fetchImage(parsed.ogImage), fetchImage(parsed.icon), fetchImage(rendered?.colors?.logoUrl)]);
    return {
        ...parsed,
        headings: rendered?.headings?.length ? rendered.headings : parsed.headings,
        ctas: [...new Set(rendered?.ctas?.length ? rendered.ctas : parsed.ctas)],
        colors: rendered?.colors
            ? { ...rendered.colors, candidates: [...(rendered.colors.candidates || []), ...(parsed.themeColor ? [{ color: parsed.themeColor, weight: 30, source: 'theme-color' }] : [])] }
            : { background: null, text: null, heading: null, accent: parsed.themeColor || null },
        fonts: rendered?.fonts || null,
        screenshots: rendered?.screenshots || [],
        shotElements: rendered?.shotElements || [],
        sections: rendered?.sections || [],
        ogImageData: ogImage,
        iconData: icon,
        logoData: logo,
    };
}
