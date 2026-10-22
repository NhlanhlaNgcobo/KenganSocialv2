import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import puppeteer from 'puppeteer-core';
import { ensureBrowser } from '@remotion/renderer';
import { FONTS_DIR } from '../timeline-text-ass.js';

/**
 * Thumbnail design: the chosen still (cropped in on the face, so it reads at phone size) with a
 * bold headline, one word in the accent colour. Rendered as HTML in headless Chrome so the
 * typography is exact.
 *
 * Formats: youtube 1280x720; tiktok 1080x1920 (TikTok's profile grid shows the middle 3:4, so the
 * headline stays inside y 240-1680).
 * Styles: punch (big caps over a dark side gradient), banner (headline on a bold box),
 * clean (sentence case with a soft shadow and a small label).
 */
export const FORMATS = {
    youtube: { width: 1280, height: 720 },
    tiktok: { width: 1080, height: 1920 },
};
export const STYLES = ['punch', 'banner', 'clean'];

const fontData = (file) => `data:font/ttf;base64,${fs.readFileSync(path.join(FONTS_DIR, file)).toString('base64')}`;
let fonts = null;
function fontFaces() {
    if (!fonts) {
        fonts = `@font-face{font-family:'K Anton';src:url(${fontData('Anton-Regular.ttf')}) format('truetype');}
@font-face{font-family:'K Poppins';font-weight:900;src:url(${fontData('Poppins-Black.ttf')}) format('truetype');}
@font-face{font-family:'K Poppins';font-weight:700;src:url(${fontData('Poppins-Bold.ttf')}) format('truetype');}`;
    }
    return fonts;
}

/**
 * The background, cropped for the format. With a face, the crop puts it large on the right
 * (YouTube) or upper middle (TikTok), leaving room for the headline.
 */
export async function frameImage(input, format, face) {
    const { width: W, height: H } = FORMATS[format];
    const img = sharp(input).rotate();
    const meta = await img.metadata();
    const iw = meta.width;
    const ih = meta.height;
    const aspect = W / H;
    // A tall frame going to a wide thumbnail: a 16:9 slice would cut the person off, so the
    // whole frame sits on the right over a blurred, darker fill of itself (headline goes left).
    if (iw / ih < aspect * 0.6) {
        const pw = Math.round((iw * H) / ih);
        const [fill, portrait] = await Promise.all([
            sharp(input).rotate().resize(W, H, { fit: 'cover' }).blur(28).modulate({ brightness: 0.55, saturation: 1.2 }).toBuffer(),
            sharp(input).rotate().resize(pw, H).modulate({ saturation: 1.15, brightness: 1.03 }).linear(1.08, -8).sharpen({ sigma: 0.8 }).toBuffer(),
        ]);
        return sharp(fill)
            .composite([{ input: portrait, left: Math.round(W * 0.97 - pw), top: 0 }])
            .jpeg({ quality: 92 })
            .toBuffer();
    }
    let crop;
    if (face && face.h > 0) {
        const fx = (face.x + face.w / 2) * iw;
        const fy = (face.y + face.h / 2) * ih;
        // The face fills about half the frame height (less for tall covers).
        let ch = Math.min(ih, (face.h * ih) / (format === 'tiktok' ? 0.3 : 0.5));
        let cw = ch * aspect;
        if (cw > iw) {
            cw = iw;
            ch = cw / aspect;
        }
        const targetX = format === 'tiktok' ? 0.5 : 0.66;
        const targetY = format === 'tiktok' ? 0.36 : 0.42;
        const left = Math.round(Math.min(Math.max(0, fx - cw * targetX), iw - cw));
        const top = Math.round(Math.min(Math.max(0, fy - ch * targetY), ih - ch));
        crop = { left, top, width: Math.round(cw), height: Math.round(ch) };
    } else {
        const cw = Math.min(iw, ih * aspect);
        const ch = cw / aspect;
        crop = { left: Math.round((iw - cw) / 2), top: Math.round((ih - ch) / 2), width: Math.round(cw), height: Math.round(ch) };
    }
    return img
        .extract(crop)
        .resize(W, H, { fit: 'cover', kernel: 'lanczos3' })
        .modulate({ saturation: 1.15, brightness: 1.03 })
        .linear(1.08, -8)
        .sharpen({ sigma: 0.8 })
        .jpeg({ quality: 92 })
        .toBuffer();
}

const escape = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Headline as HTML with one word (the highlight, or the longest word) in the accent colour. */
function headlineHtml(headline, highlight) {
    const words = String(headline || '').trim().split(/\s+/).filter(Boolean).slice(0, 9);
    const key = (highlight || '').trim().toLowerCase() || [...words].sort((a, b) => b.replace(/\W/g, '').length - a.replace(/\W/g, '').length)[0]?.toLowerCase();
    return words.map((w) => (w.toLowerCase().replace(/[^\w']/g, '') === key?.replace(/[^\w']/g, '') ? `<em>${escape(w)}</em>` : escape(w))).join(' ');
}

function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function thumbnailHtml({ image, format, headline, highlight, style = 'punch', accent = '#ffe11a', logo = null, label = '' }) {
    const { width: W, height: H } = FORMATS[format];
    const tall = format === 'tiktok';
    const words = String(headline || '').trim().split(/\s+/).filter(Boolean).length;
    // Fewer words, bigger type.
    const size = tall ? (words <= 3 ? 150 : words <= 5 ? 128 : 104) : words <= 3 ? 132 : words <= 5 ? 112 : 92;
    const onAccent = luminance(accent) > 0.45 ? '#0b0b0d' : '#ffffff';
    const text = headlineHtml(headline, highlight);
    const position = tall
        ? 'left:70px;right:70px;top:1060px;text-align:center;'
        : 'left:64px;top:50%;transform:translateY(-50%);width:58%;text-align:left;';
    const shade = tall
        ? 'linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.78) 62%, rgba(0,0,0,0.55) 88%)'
        : 'linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.62) 38%, rgba(0,0,0,0) 66%)';
    const styles = {
        punch: `.h{font-family:'K Anton';text-transform:uppercase;font-size:${size}px;line-height:0.98;letter-spacing:0.5px;color:#fff;
            text-shadow:0 0 1px #000,4px 4px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,0 10px 30px rgba(0,0,0,0.6);}
            .h em{font-style:normal;color:${accent};}`,
        banner: `.h{font-family:'K Poppins';font-weight:900;text-transform:uppercase;font-size:${Math.round(size * 0.74)}px;line-height:1.08;color:${onAccent};}
            .h span{background:${accent};padding:6px 18px;box-decoration-break:clone;-webkit-box-decoration-break:clone;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,0.35);}
            .h em{font-style:normal;text-decoration:underline;text-decoration-thickness:8px;text-underline-offset:8px;}`,
        clean: `.h{font-family:'K Poppins';font-weight:900;font-size:${Math.round(size * 0.68)}px;line-height:1.08;color:#fff;text-shadow:0 6px 24px rgba(0,0,0,0.65);}
            .h em{font-style:normal;color:${accent};}`,
    };
    const shadeLayer = style === 'banner' ? '' : `<div class="shade"></div>`;
    const inner = style === 'banner' ? `<span>${text}</span>` : text;
    return `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaces()}
        html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#000;}
        .bg{position:absolute;inset:0;background:url(${image}) center/cover no-repeat;}
        .shade{position:absolute;inset:0;background:${shade};}
        .vig{position:absolute;inset:0;box-shadow:inset 0 0 ${tall ? 220 : 160}px rgba(0,0,0,0.55);}
        .wrap{position:absolute;${position}}
        ${styles[style] || styles.punch}
        .label{display:inline-block;margin-bottom:22px;padding:8px 18px;border-radius:999px;background:${accent};color:${onAccent};
            font-family:'K Poppins';font-weight:700;font-size:${tall ? 40 : 30}px;letter-spacing:1px;text-transform:uppercase;}
        .logo{position:absolute;${tall ? 'top:250px;left:50%;transform:translateX(-50%);' : 'top:36px;left:44px;'}height:${tall ? 90 : 64}px;max-width:${tall ? 360 : 260}px;object-fit:contain;filter:drop-shadow(0 4px 12px rgba(0,0,0,0.5));}
    </style></head><body>
        <div class="bg"></div>${shadeLayer}<div class="vig"></div>
        ${logo ? `<img class="logo" src="${logo}">` : ''}
        <div class="wrap">${label && style === 'clean' ? `<div class="label">${escape(label)}</div>` : ''}<div class="h">${inner}</div></div>
    </body></html>`;
}

// One shared browser, closed after a minute without use.
let browserPromise = null;
let idleTimer = null;
async function browser() {
    if (!browserPromise) {
        browserPromise = (async () => {
            const { path: executablePath } = await ensureBrowser();
            const launch = () => puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], timeout: 90000 });
            // One retry: a launch can fail while another Chrome is starting or shutting down.
            const b = await launch().catch(() => new Promise((r) => setTimeout(r, 1500)).then(launch));
            // If Chrome dies, the next render launches a fresh one instead of reusing a dead browser.
            b.on('disconnected', () => {
                if (browserPromise && browserPromise.__browser === b) browserPromise = null;
            });
            browserPromise.__browser = b;
            return b;
        })().catch((error) => {
            browserPromise = null;
            throw error;
        });
    }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => {
        const b = browserPromise;
        browserPromise = null;
        (await b?.catch(() => null))?.close().catch(() => {});
    }, 60000);
    idleTimer.unref?.();
    return browserPromise;
}

/** Renders the thumbnail to PNG. `image` is a JPEG/PNG buffer (already framed with frameImage). */
export async function renderThumbnail({ image, format = 'youtube', headline, highlight, style = 'punch', accent, logo = null, label = '' }) {
    const { width, height } = FORMATS[format] || FORMATS.youtube;
    const html = thumbnailHtml({
        image: `data:image/jpeg;base64,${image.toString('base64')}`,
        format: FORMATS[format] ? format : 'youtube',
        headline,
        highlight,
        style: STYLES.includes(style) ? style : 'punch',
        accent: /^#[0-9a-f]{6}$/i.test(accent || '') ? accent : '#ffe11a',
        logo,
        label,
    });
    const b = await browser();
    const page = await b.newPage();
    try {
        await page.setViewport({ width, height, deviceScaleFactor: 1 });
        await page.setContent(html, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        return Buffer.from(await page.screenshot({ type: 'png' }));
    } finally {
        await page.close().catch(() => {});
    }
}
