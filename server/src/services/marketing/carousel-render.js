import puppeteer from 'puppeteer-core';
import { ensureBrowser } from '@remotion/renderer';
import { FORMATS, slideHtml } from './carousel-templates.js';
import { fontFaceCss } from './fonts.js';

/**
 * Renders carousel slides (HTML templates) to PNG in headless Chrome.
 * Fonts and images are embedded as data URLs, so rendering needs no network at all:
 * every non-data request is blocked.
 */

/**
 * @param {Array<object>} slides
 * @param {object} ctx { kit, format, images: Array<dataUrl|null>, logo, logoOnDark }
 * @param {number[]} [only] indexes to render (default: all)
 * @returns {Promise<Array<{index: number, buffer: Buffer}>>}
 */
export async function renderSlides(slides, ctx, only) {
    const { width, height } = FORMATS[ctx.format] || FORMATS['4:5'];
    const fontCss = await fontFaceCss([ctx.kit?.fonts?.heading, ctx.kit?.fonts?.body]);
    const { path: executablePath } = await ensureBrowser();
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'], timeout: 90000 });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width, height, deviceScaleFactor: 1 });
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const url = req.url();
            if (url.startsWith('data:') || url.startsWith('about:')) return req.continue();
            return req.abort();
        });

        const out = [];
        const indexes = only?.length ? only : slides.map((_, i) => i);
        for (const index of indexes) {
            const html = slideHtml(slides[index], {
                kit: ctx.kit,
                format: ctx.format,
                index,
                total: slides.length,
                image: ctx.images?.[index] || null,
                logo: ctx.logo || null,
                logoOnDark: ctx.logoOnDark || null,
                fontCss,
            });
            await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
            await page.evaluate(() => document.fonts?.ready).catch(() => {});
            out.push({ index, buffer: Buffer.from(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } })) });
        }
        return out;
    } finally {
        await browser.close().catch(() => {});
    }
}
