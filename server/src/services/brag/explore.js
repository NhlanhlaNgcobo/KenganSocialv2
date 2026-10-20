import puppeteer from 'puppeteer-core';
import { ensureBrowser } from '@remotion/renderer';
import { assertPublicUrl } from '../../utils/safe-fetch.js';
import { dismissBanners, FORMATS, guardPage, VISIBLE_ELEMENTS } from './inspect.js';
import { COLLECT_BRAND_COLORS } from './brand-colors.js';

/**
 * Tutorial mode: walks a web app the way a new visitor would and records each stop.
 *
 * Starting at the given address it captures the page, finds the main call to action and the
 * pages that explain the product (features, how it works, docs, pricing, sign-up), and visits
 * a few of them by following links. It only follows <a href> links on the same site (never
 * clicks buttons or submits forms), so nothing is created or bought on the visited app.
 */

const MAX_PAGES = 5;
const PRIORITY = [
    [/get started|start (free|now|here)|sign ?up|create (an )?account|try( it)? (free|now)|join/i, 10],
    [/how it works|tour|demo|walkthrough|guide|getting started|quick ?start|tutorial/i, 9],
    [/features?|product|platform|what we do|solutions?/i, 8],
    [/docs|documentation|help|learn/i, 3],
    [/templates|integrations|examples|use cases/i, 5],
    [/pricing|plans/i, 4],
    [/log ?in|sign ?in/i, 2],
];
const SKIP = /\/(auth|oauth|sso|api)\b|with (google|apple|microsoft|github|facebook)|docker|self-host|api reference|privacy|terms|legal|cookie|careers|jobs|press|blog\/.+|status|contact|about|twitter|facebook|linkedin|instagram|youtube|tiktok|github|mailto:|tel:|#$/i;

function score(text) {
    for (const [re, value] of PRIORITY) if (re.test(text)) return value;
    return 0;
}

const sameSite = (a, b) => {
    const strip = (h) => h.replace(/^www\./, '').split('.').slice(-2).join('.');
    return strip(a) === strip(b);
};

async function snapshot(page) {
    const info = await page.evaluate(() => {
        const text = (sel, n) => [...document.querySelectorAll(sel)].map((e) => e.innerText.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 180).slice(0, n);
        return {
            title: document.title,
            headings: [...text('h1', 2), ...text('h2', 6)],
            paragraphs: text('main p, section p, p', 10).filter((p) => p.length > 40).slice(0, 5),
            height: document.documentElement.scrollHeight,
        };
    });
    const shots = [];
    const viewportH = page.viewport().height;
    for (const y of [...new Set([0, Math.min(viewportH * 0.9, Math.max(0, info.height - viewportH))])]) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await new Promise((r) => setTimeout(r, 600));
        const jpg = await page.screenshot({ type: 'jpeg', quality: 80 });
        shots.push({ data: `data:image/jpeg;base64,${Buffer.from(jpg).toString('base64')}`, elements: await page.evaluate(VISIBLE_ELEMENTS).catch(() => []) });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    return { ...info, shots };
}

/** Links on the current page worth following, best first, with where they sit on screen. */
async function rankLinks(page, origin, visited) {
    const links = await page.evaluate(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        return [...document.querySelectorAll('a[href]')].map((a) => {
            const r = a.getBoundingClientRect();
            const visible = r.width > 4 && r.height > 4 && r.top >= 0 && r.bottom <= vh;
            return {
                href: a.href,
                text: (a.innerText || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60),
                box: visible ? { x: (r.left / vw) * 100, y: (r.top / vh) * 100, w: (r.width / vw) * 100, h: (r.height / vh) * 100 } : null,
            };
        });
    });
    const seen = new Set();
    return links
        .filter((l) => {
            try {
                const u = new URL(l.href);
                if (!['http:', 'https:'].includes(u.protocol) || !sameSite(u.hostname, origin.hostname)) return false;
                const key = u.origin + u.pathname.replace(/\/$/, '');
                if (visited.has(key) || seen.has(key) || SKIP.test(`${l.text} ${u.pathname}`) || !l.text) return false;
                seen.add(key);
                return true;
            } catch {
                return false;
            }
        })
        .map((l) => ({ ...l, score: score(`${l.text} ${new URL(l.href).pathname.replace(/[-_/]/g, ' ')}`) + (l.box ? 1 : 0) }))
        .filter((l) => l.score > 0)
        .sort((a, b) => b.score - a.score);
}

/**
 * @returns {Promise<{ url, name, description, colors, fonts, iconUrl, pages: Array<{ url, path, title, headings, paragraphs, shots, via }> }>}
 *   via: the link on the previous page that leads to this one ({ text, box } in % of that page's first shot)
 */
export async function exploreApp(rawUrl, format, onStage = () => {}) {
    const withScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const start = await assertPublicUrl(withScheme);
    const { path: executablePath } = await ensureBrowser();
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], timeout: 90000, protocolTimeout: 180000 });
    try {
        const page = await browser.newPage();
        const size = FORMATS[format] || FORMATS.landscape;
        // Tutorials read best at desktop width; vertical videos get a tall, phone-like viewport.
        const viewport = format === 'vertical' ? { width: 430, height: 760 } : format === 'square' ? { width: 900, height: 900 } : { width: 1366, height: 768 };
        await page.setViewport({ ...viewport, deviceScaleFactor: size.width >= 1920 || format !== 'landscape' ? 2 : 1.5 });
        await guardPage(page);

        onStage('Opening the app');
        await page.goto(start.toString(), { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
        await dismissBanners(page);
        const origin = new URL(page.url());

        const identity = await page.evaluate(() => {
            const meta = (n) => document.querySelector(`meta[name="${n}"], meta[property="${n}"]`)?.content || '';
            const body = getComputedStyle(document.body);
            const h1 = document.querySelector('h1');
            const button = document.querySelector('a[class*="btn"], button, a[class*="button"]');
            const icon = document.querySelector('link[rel*="apple-touch-icon"], link[rel="icon"], link[rel="shortcut icon"]');
            return {
                name: meta('og:site_name') || document.title.split(/[|—–-]/)[0].trim(),
                description: meta('description') || meta('og:description'),
                colors: { background: body.backgroundColor, text: body.color, heading: h1 ? getComputedStyle(h1).color : null, accent: button ? getComputedStyle(button).backgroundColor : null },
                fonts: { body: body.fontFamily, heading: h1 ? getComputedStyle(h1).fontFamily : null },
                iconUrl: icon?.href || null,
            };
        });

        const brand = await page.evaluate(COLLECT_BRAND_COLORS).catch(() => null);
        if (brand) identity.colors = { ...identity.colors, ...brand };

        const visited = new Set([origin.origin + origin.pathname.replace(/\/$/, '')]);
        const pages = [];
        onStage('Capturing the start page');
        pages.push({ url: page.url(), path: origin.pathname || '/', ...(await snapshot(page)), via: null });

        let queue = await rankLinks(page, origin, visited);
        while (pages.length < MAX_PAGES && queue.length) {
            const next = queue.shift();
            const key = (() => {
                const u = new URL(next.href);
                return u.origin + u.pathname.replace(/\/$/, '');
            })();
            if (visited.has(key)) continue;
            visited.add(key);
            try {
                await assertPublicUrl(next.href);
                onStage(`Visiting ${next.text}`);
                // Busy apps never go network-idle: wait for the document, then give it a few seconds to settle.
                await page.goto(next.href, { waitUntil: 'domcontentloaded', timeout: 25000 });
                await page.waitForNetworkIdle({ idleTime: 600, timeout: 8000 }).catch(() => {});
                await dismissBanners(page);
                const snap = await snapshot(page);
                if (!snap.headings.length && !snap.paragraphs.length) continue;
                pages.push({ url: page.url(), path: new URL(page.url()).pathname, ...snap, via: { text: next.text, box: next.box, fromPage: 0 } });
            } catch (error) {
                console.warn('[Tutorial] Could not visit', next.href, error.message);
            }
        }
        // Keep the explored order close to a real first visit: sign-up first, pricing last.
        const [home, ...rest] = pages;
        rest.sort((a, b) => score(`${b.via.text} ${b.path}`) - score(`${a.via.text} ${a.path}`));
        return { url: origin.toString(), ...identity, pages: [home, ...rest] };
    } finally {
        await browser.close().catch(() => {});
    }
}
