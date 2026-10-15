import axios from 'axios';

/**
 * Google Fonts for slide rendering, fetched once and embedded as data URLs, so Chrome renders
 * slides with no network access (fast and deterministic). Latin subsets only.
 * Unknown or non-Google fonts resolve to '' and the template's fallback stack is used.
 */

const cache = new Map(); // family -> Promise<string css>
const WOFF2_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

async function loadFamily(family) {
    const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;600;700;800&display=block`;
    let css;
    try {
        ({ data: css } = await axios.get(url, { headers: { 'User-Agent': WOFF2_UA }, timeout: 15000, responseType: 'text' }));
    } catch {
        return ''; // not a Google Font (or offline): fall back to system fonts
    }
    // Keep only the latin blocks: css2 marks subsets with /* latin */ comments.
    const blocks = String(css)
        .split(/(?=\/\* [a-z-]+ \*\/)/)
        .filter((b) => /^\/\* latin \*\//.test(b));
    const out = [];
    for (const block of blocks) {
        const src = block.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)?.[1];
        if (!src) continue;
        try {
            const { data } = await axios.get(src, { responseType: 'arraybuffer', timeout: 15000, maxContentLength: 2 * 1024 * 1024 });
            out.push(block.replace(src, `data:font/woff2;base64,${Buffer.from(data).toString('base64')}`).replace(/^\/\* latin \*\//, ''));
        } catch {
            /* skip this weight */
        }
    }
    return out.join('\n');
}

/** @returns {Promise<string>} @font-face rules for the given families (empty string if none). */
export async function fontFaceCss(families) {
    const unique = [...new Set((families || []).map((f) => String(f || '').trim()).filter(Boolean))];
    const parts = await Promise.all(
        unique.map((family) => {
            if (!cache.has(family)) {
                const p = loadFamily(family);
                cache.set(family, p);
                // Don't cache failures forever (network blips).
                p.then((css) => !css && setTimeout(() => cache.delete(family), 10 * 60 * 1000));
            }
            return cache.get(family);
        })
    );
    return parts.filter(Boolean).join('\n');
}
