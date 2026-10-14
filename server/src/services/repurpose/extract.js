import { safeGet } from '../../utils/safe-fetch.js';

/**
 * Pulls the readable text out of an article or web page so it can be repurposed.
 * Fetching goes through safeGet, which refuses private and internal addresses.
 */

const MAX_CHARS = 14000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…' };

function decode(value = '') {
    return value
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

const clean = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function meta(html, name) {
    const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i');
    return decode(html.match(re)?.[0]?.match(/content=["']([^"']*)["']/i)?.[1] || '').trim();
}

/** Readable text from HTML: the <article> or <main> if present, else the body minus chrome. */
export function extractArticle(html) {
    const stripped = html
        .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ');
    const scope =
        stripped.match(/<article[\s\S]*?<\/article>/i)?.[0] ||
        stripped.match(/<main[\s\S]*?<\/main>/i)?.[0] ||
        stripped.replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ');

    const blocks = [];
    const re = /<(h[1-3]|p|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;
    let total = 0;
    while ((match = re.exec(scope)) && total < MAX_CHARS) {
        const tag = match[1].toLowerCase();
        const value = clean(match[2]);
        if (!value || (tag === 'li' && value.length < 25) || (tag === 'p' && value.length < 30)) continue;
        const line = tag.startsWith('h') ? `## ${value}` : tag === 'li' ? `- ${value}` : value;
        blocks.push(line);
        total += line.length + 1;
    }
    return {
        title: meta(html, 'og:title') || clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
        description: meta(html, 'description') || meta(html, 'og:description'),
        siteName: meta(html, 'og:site_name'),
        text: blocks.join('\n').slice(0, MAX_CHARS),
    };
}

export async function fetchArticle(rawUrl) {
    let url = String(rawUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    let host = '';
    try {
        host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
        throw Object.assign(new Error('That does not look like a web address.'), { status: 400 });
    }
    if (/(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|x\.com|twitter\.com|facebook\.com)$/i.test(host)) {
        throw Object.assign(
            new Error('Social video links cannot be read directly. Upload the video to Clips and repurpose a clip, or paste the transcript as text.'),
            { status: 400 }
        );
    }
    let response;
    try {
        response = await safeGet(url, { maxBytes: 4 * 1024 * 1024, timeout: 15000 });
    } catch (error) {
        throw Object.assign(new Error(/public|private|not allowed/i.test(error.message) ? 'That address cannot be fetched.' : 'Could not load that page.'), { status: 400 });
    }
    if (response.status >= 400) throw Object.assign(new Error(`The page returned an error (${response.status}).`), { status: 400 });
    const type = String(response.headers?.['content-type'] || '');
    if (type && !/html|text\/plain/i.test(type)) throw Object.assign(new Error('Only web pages and articles can be read.'), { status: 400 });

    const html = String(response.data || '');
    const article = /text\/plain/i.test(type) ? { title: host, description: '', siteName: host, text: html.slice(0, MAX_CHARS) } : extractArticle(html);
    if (article.text.length < 200) {
        throw Object.assign(new Error('Not enough readable text on that page. It may need a login or load with JavaScript; paste the text instead.'), { status: 422 });
    }
    return { ...article, url, siteName: article.siteName || host };
}
