import axios from 'axios';
import { safeGet } from '../../utils/safe-fetch.js';

/**
 * Pulls the readable text out of an article or web page so it can be repurposed.
 * Fetching goes through safeGet, which refuses private and internal addresses.
 * YouTube videos are read from their captions (or transcribed) by the Python video service.
 */

const MAX_CHARS = 14000;
const PYTHON_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';
const YOUTUBE_URL = /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

const withScheme = (raw) => {
    const url = String(raw || '').trim();
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
};

export function isYouTubeUrl(rawUrl) {
    return YOUTUBE_URL.test(withScheme(rawUrl));
}

/** Text of a YouTube video: its captions, or (when it has none) a transcription of its audio. */
export async function fetchYouTubeText(rawUrl, plan = 'creator') {
    const url = withScheme(rawUrl);
    if (!YOUTUBE_URL.test(url)) throw Object.assign(new Error('Paste a YouTube video link (youtube.com/watch, youtu.be or /shorts).'), { status: 400 });
    try {
        const { data } = await axios.post(`${PYTHON_URL}/process/youtube-transcript`, { url, plan }, { timeout: 20 * 60 * 1000 });
        return data;
    } catch (error) {
        if (error.code === 'ECONNREFUSED') throw Object.assign(new Error('The video service is not running, so YouTube links cannot be read right now.'), { status: 503 });
        const detail = error.response?.data?.detail;
        // YouTube refuses many server requests; the page then offers uploading the video instead.
        if (detail?.error === 'YOUTUBE_BLOCKED') {
            throw Object.assign(new Error('YouTube blocked reading this video from our server. Upload the video file instead (or paste its transcript) and we will do the rest.'), { status: 422, code: 'YOUTUBE_BLOCKED' });
        }
        throw Object.assign(new Error(detail?.message || 'That YouTube video could not be read.'), { status: error.response?.status === 400 ? 400 : 422 });
    }
}

/** Text spoken in an uploaded video or audio file (transcribed by the video service). */
export async function transcribeUpload(filePath, { plan = 'creator', workspaceId = null } = {}) {
    try {
        const { data } = await axios.post(
            `${PYTHON_URL}/process/transcribe`,
            { videoUrl: filePath, jobId: `repurpose_${Date.now().toString(36)}`, workspaceId, plan },
            { timeout: 2 * 60 * 60 * 1000 }
        );
        const words = (data?.words || []).map((w) => String(w.text ?? w.word ?? '').trim()).filter(Boolean);
        const text = words.join(' ').replace(/\s+([,.!?;:])/g, '$1').trim();
        if (text.length < 80) throw Object.assign(new Error('Little or no speech was found in this video.'), { status: 422 });
        return text.slice(0, MAX_CHARS);
    } catch (error) {
        if (error.status) throw error;
        if (error.code === 'ECONNREFUSED') throw Object.assign(new Error('The video service is not running, so videos cannot be transcribed right now.'), { status: 503 });
        const detail = error.response?.data?.detail;
        throw Object.assign(new Error(detail?.message || 'The video could not be transcribed.'), { status: 422 });
    }
}

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
    if (/(^|\.)(youtube\.com|youtu\.be)$/i.test(host)) {
        // Video links are handled by fetchYouTubeText; this catches channel and playlist pages.
        throw Object.assign(new Error('Paste a link to a single YouTube video (youtube.com/watch, youtu.be or /shorts), not a channel or playlist.'), {
            status: 400,
        });
    }
    if (/(^|\.)(tiktok\.com|instagram\.com|x\.com|twitter\.com|facebook\.com)$/i.test(host)) {
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
