import puppeteer from 'puppeteer-core';
import { ensureBrowser } from '@remotion/renderer';
import { FORMATS, slideHtml } from './carousel-templates.js';
import { fontFaceCss } from './fonts.js';

/**
 * Renders HTML designs (carousel slides, single-image ads) to PNG in headless Chrome.
 * Fonts and images are embedded as data URLs, so rendering needs no network at all:
 * every non-data request is blocked.
 */

/**
 * @param {Array<{html: string, width: number, height: number}>} pages
 * @returns {Promise<Buffer[]>} one PNG per page, in order
 */
export async function renderHtml(pages) {
    const { path: executablePath } = await ensureBrowser();
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'], timeout: 90000 });
    try {
        const page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const url = req.url();
            if (url.startsWith('data:') || url.startsWith('about:')) return req.continue();
            return req.abort();
        });
        const out = [];
        for (const { html, width, height } of pages) {
            await page.setViewport({ width, height, deviceScaleFactor: 1 });
            await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
            await page.evaluate(() => document.fonts?.ready).catch(() => {});
            out.push(Buffer.from(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } })));
        }
        return out;
    } finally {
        await browser.close().catch(() => {});
    }
}

/**
 * @param {Array<object>} slides
 * @param {object} ctx { kit, format, images: Array<dataUrl|null>, logo, logoOnDark }
 * @param {number[]} [only] indexes to render (default: all)
 * @returns {Promise<Array<{index: number, buffer: Buffer}>>}
 */
export async function renderSlides(slides, ctx, only) {
    const { width, height } = FORMATS[ctx.format] || FORMATS['4:5'];
    const fontCss = await fontFaceCss([ctx.kit?.fonts?.heading, ctx.kit?.fonts?.body]);
    const indexes = only?.length ? only : slides.map((_, i) => i);
    const pages = indexes.map((index) => ({
        width,
        height,
        html: slideHtml(slides[index], {
            kit: ctx.kit,
            format: ctx.format,
            index,
            total: slides.length,
            image: ctx.images?.[index] || null,
            logo: ctx.logo || null,
            logoOnDark: ctx.logoOnDark || null,
            fontCss,
        }),
    }));
    const buffers = await renderHtml(pages);
    return indexes.map((index, i) => ({ index, buffer: buffers[i] }));
}
