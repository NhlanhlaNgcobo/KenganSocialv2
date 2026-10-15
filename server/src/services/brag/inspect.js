import dns from 'dns/promises';
import net from 'net';
import puppeteer from 'puppeteer-core';
import { ensureBrowser } from '@remotion/renderer';
import { assertPublicUrl, isPublicAddress, safeGet } from '../../utils/safe-fetch.js';

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

/** Renders the page in headless Chrome: rendered copy, computed colours/fonts, screenshots. */
async function capture(url, format) {
    const { path: executablePath } = await ensureBrowser();
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const hostCache = new Map();
    try {
        const page = await browser.newPage();
        const size = FORMATS[format];
        // A browser-sized viewport with the video's aspect ratio.
        const scale = format === 'landscape' ? 0.75 : 0.45;
        await page.setViewport({ width: Math.round(size.width * scale), height: Math.round(size.height * scale), deviceScaleFactor: 2 });
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
        // Dismiss common cookie banners so they don't sit on every screenshot.
        await page.evaluate(() => {
            const words = /^(accept|accept all|agree|got it|ok|allow all|i agree)$/i;
            for (const b of document.querySelectorAll('button, a')) {
                if (words.test((b.textContent || '').trim())) {
                    b.click();
                    break;
                }
            }
        }).catch(() => {});
        await new Promise((r) => setTimeout(r, 800));

        const info = await page.evaluate(() => {
            const text = (sel, n) => [...document.querySelectorAll(sel)].map((e) => e.innerText.trim()).filter((t) => t && t.length < 160).slice(0, n);
            const body = getComputedStyle(document.body);
            const h1 = document.querySelector('h1');
            const button = document.querySelector('a[class*="btn"], button, a[class*="button"]');
            return {
                headings: [...text('h1', 3), ...text('h2', 8)],
                ctas: text('button, a[class*="btn"], a[class*="button"]', 8),
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

        const screenshots = [];
        const viewportH = page.viewport().height;
        const stops = [0, 1, 2].map((i) => Math.min(i * viewportH, Math.max(0, info.height - viewportH)));
        for (const y of [...new Set(stops)]) {
            await page.evaluate((top) => window.scrollTo(0, top), y);
            await new Promise((r) => setTimeout(r, 700)); // let scroll-in animations settle
            const png = await page.screenshot({ type: 'jpeg', quality: 82 });
            screenshots.push(`data:image/jpeg;base64,${Buffer.from(png).toString('base64')}`);
        }
        return { ...info, screenshots };
    } finally {
        await browser.close().catch(() => {});
    }
}

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

    const [ogImage, icon] = await Promise.all([fetchImage(parsed.ogImage), fetchImage(parsed.icon)]);
    return {
        ...parsed,
        headings: rendered?.headings?.length ? rendered.headings : parsed.headings,
        ctas: [...new Set(rendered?.ctas?.length ? rendered.ctas : parsed.ctas)],
        colors: rendered?.colors || { background: null, text: null, heading: null, accent: parsed.themeColor || null },
        fonts: rendered?.fonts || null,
        screenshots: rendered?.screenshots || [],
        ogImageData: ogImage,
        iconData: icon,
    };
}
