/**
 * Carousel slide templates: one self-contained HTML document per slide, drawn with the brand
 * kit's exact colours, fonts and logo. Templates render all text (image models still misspell),
 * and AI imagery, when used, is a text-free background or feature image.
 *
 * Every string from users or the AI is HTML-escaped. Images arrive as data URLs, so the page
 * needs no network access except Google Fonts.
 */

export const FORMATS = {
    '4:5': { width: 1080, height: 1350, label: 'Instagram / Facebook (4:5)' },
    '1:1': { width: 1080, height: 1080, label: 'Square (1:1)' },
    '9:16': { width: 1080, height: 1920, label: 'TikTok / Stories (9:16)' },
};

export const LAYOUTS = {
    cover: 'Opening slide: hook headline, optional kicker and background image',
    statement: 'One bold sentence, centred',
    list: 'Headline plus 3-5 bullet points',
    steps: 'Headline plus 3-5 numbered steps',
    stat: 'One big number with a label and a short explanation',
    quote: 'A testimonial or quote with the person it is from',
    image: 'Feature image on top, headline and short text below',
    comparison: 'Two columns: e.g. before/after, us/them, myth/fact',
    cta: 'Closing slide: call to action, logo and website/handle',
};

const esc = (s) =>
    String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const HEX = /^#[0-9a-f]{6}$/i;

function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/** Text colour that reads on a given background. */
const readableOn = (bg, preferred = []) => [...preferred, '#ffffff', '#111111'].filter((c) => HEX.test(c)).sort((a, b) => ratio(b, bg) - ratio(a, bg))[0];

/** Resolves brand colours into a complete, readable palette. */
export function themeFromKit(kit = {}) {
    const c = kit.colors || {};
    const bg = HEX.test(c.background) ? c.background : '#ffffff';
    const text = HEX.test(c.text) && ratio(c.text, bg) >= 4.5 ? c.text : readableOn(bg);
    const primary = HEX.test(c.primary) ? c.primary : text;
    const accent = HEX.test(c.accent) ? c.accent : HEX.test(c.secondary) ? c.secondary : primary;
    // Primary used as text must stay readable on the background; fall back to the text colour.
    const primaryText = ratio(primary, bg) >= 3 ? primary : text;
    return {
        bg,
        text,
        primary,
        primaryText,
        accent,
        onPrimary: readableOn(primary, [bg, text]),
        onAccent: readableOn(accent, [bg, text]),
        isDark: luminance(bg) < 0.4,
        headingFont: kit.fonts?.heading || null,
        bodyFont: kit.fonts?.body || null,
    };
}

const stack = (font, fallback) => (font ? `"${String(font).replace(/["\\]/g, '')}", ${fallback}` : fallback);

function baseCss(theme, format) {
    const { width, height } = FORMATS[format] || FORMATS['4:5'];
    const pad = Math.round(width * 0.08);
    return `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${width}px;height:${height}px;overflow:hidden}
body{background:${theme.bg};color:${theme.text};font-family:${stack(theme.bodyFont, 'Inter, "Segoe UI", Arial, sans-serif')};-webkit-font-smoothing:antialiased}
.slide{position:relative;width:100%;height:100%;padding:${pad}px;display:flex;flex-direction:column;gap:${Math.round(pad * 0.35)}px}
.h{font-family:${stack(theme.headingFont, 'Inter, "Segoe UI", Arial, sans-serif')};font-weight:800;line-height:1.08;letter-spacing:-0.01em}
.kicker{font-size:30px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${theme.primaryText}}
.body{font-size:42px;line-height:1.42;opacity:.9}
.content{flex:1;display:flex;flex-direction:column;justify-content:center;gap:34px;min-height:0}
.bar{position:absolute;left:0;top:0;width:100%;height:14px;background:${theme.primary}}
.foot{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:20px;font-size:26px;opacity:.85}
.logo{max-height:64px;max-width:260px;object-fit:contain;object-position:left center}
.brandname{font-weight:700;font-size:28px}
.count{font-variant-numeric:tabular-nums}
.dots{display:flex;gap:10px}.dots i{width:12px;height:12px;border-radius:50%;background:${theme.text};opacity:.25}.dots i.on{background:${theme.primary};opacity:1}
.pill{display:inline-block;padding:18px 34px;border-radius:999px;background:${theme.primary};color:${theme.onPrimary};font-weight:700;font-size:34px}
ul.items{list-style:none;display:flex;flex-direction:column;gap:34px}
ul.items li{display:flex;gap:28px;align-items:flex-start;font-size:46px;line-height:1.3}
ul.items li b{flex-shrink:0;display:grid;place-items:center;width:70px;height:70px;border-radius:50%;background:${theme.primary};color:${theme.onPrimary};font-size:34px}
.media{border-radius:28px;overflow:hidden;background:${theme.isDark ? '#ffffff14' : '#00000010'}}
.media img{width:100%;height:100%;object-fit:cover;display:block}
`;
}

function footer({ theme, logo, kit, index, total }) {
    const mark = logo ? `<img class="logo" src="${logo}">` : `<span class="brandname">${esc(kit.name || '')}</span>`;
    const dots = total > 1 ? `<span class="dots">${Array.from({ length: total }, (_, i) => `<i class="${i === index ? 'on' : ''}"></i>`).join('')}</span>` : '';
    return `<div class="foot">${mark}${dots}</div>`;
}

function body(slide, layout, ctx) {
    const { theme, image, kit, index, total, format } = ctx;
    const { width, height } = FORMATS[format] || FORMATS['4:5'];
    const big = (len, max, min) => Math.round(Math.max(min, Math.min(max, max - (len - 20) * 1.1)));
    const head = (text, max = 96, min = 58) => `<h1 class="h" style="font-size:${big(String(text || '').length, max, min)}px">${esc(text)}</h1>`;
    const kicker = slide.kicker ? `<div class="kicker">${esc(slide.kicker)}</div>` : '';
    const text = slide.body ? `<p class="body">${esc(slide.body)}</p>` : '';
    const foot = footer(ctx);

    switch (layout) {
        case 'cover': {
            if (image) {
                return `<div class="slide" style="color:#fff;justify-content:flex-end">
<img src="${image}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.05) 25%,rgba(0,0,0,.78) 100%)"></div>
<div style="position:relative;display:flex;flex-direction:column;gap:28px">
${slide.kicker ? `<div class="kicker" style="color:#fff">${esc(slide.kicker)}</div>` : ''}${head(slide.headline, 112, 66)}${text}
<div class="foot" style="opacity:1">${ctx.logoOnDark ? `<img class="logo" src="${ctx.logoOnDark}">` : `<span class="brandname">${esc(kit.name || '')}</span>`}<span style="font-size:30px;font-weight:700">Swipe →</span></div></div></div>`;
            }
            return `<div class="slide"><div class="bar"></div>${kicker}<div style="margin-top:auto"></div>${head(slide.headline, 120, 70)}${text}
<div class="foot">${ctx.logo ? `<img class="logo" src="${ctx.logo}">` : `<span class="brandname">${esc(kit.name || '')}</span>`}<span style="font-weight:700;color:${theme.primaryText}">Swipe →</span></div></div>`;
        }
        case 'statement':
            return `<div class="slide" style="background:${theme.primary};color:${theme.onPrimary};justify-content:center">
${slide.kicker ? `<div class="kicker" style="color:${theme.onPrimary};opacity:.8">${esc(slide.kicker)}</div>` : ''}${head(slide.headline, 104, 62)}${text}
<div class="foot" style="position:absolute;left:${Math.round(width * 0.08)}px;right:${Math.round(width * 0.08)}px;bottom:${Math.round(width * 0.08)}px"><span class="brandname">${esc(kit.name || '')}</span><span class="count">${index + 1}/${total}</span></div></div>`;
        case 'list':
        case 'steps': {
            const items = (slide.bullets || []).slice(0, 5);
            const marker = (i) => (layout === 'steps' ? i + 1 : '✓');
            return `<div class="slide"><div class="bar"></div><div class="content">${kicker}${head(slide.headline, 92, 60)}
<ul class="items">${items.map((b, i) => `<li><b>${marker(i)}</b><span>${esc(b)}</span></li>`).join('')}</ul></div>${foot}</div>`;
        }
        case 'stat':
            return `<div class="slide"><div class="bar"></div><div class="content">${kicker}
<div class="h" style="font-size:${big(String(slide.stat?.value || '').length * 3, 300, 150)}px;color:${theme.primaryText};line-height:1">${esc(slide.stat?.value || '')}</div>
<div class="h" style="font-size:64px">${esc(slide.stat?.label || slide.headline || '')}</div>${text}</div>${foot}</div>`;
        case 'quote':
            return `<div class="slide"><div class="bar"></div><div class="content">
<div class="h" style="font-size:220px;line-height:.6;color:${theme.primaryText}">“</div>
<div class="h" style="font-size:${big(String(slide.quote?.text || '').length / 2, 80, 50)}px;font-weight:700;line-height:1.25">${esc(slide.quote?.text || slide.headline || '')}</div>
${slide.quote?.author ? `<div style="font-size:38px;font-weight:600;color:${theme.primaryText}">— ${esc(slide.quote.author)}</div>` : ''}</div>${foot}</div>`;
        case 'image':
            return `<div class="slide"><div class="media" style="height:${Math.round(height * 0.5)}px">${image ? `<img src="${image}">` : ''}</div>
${kicker}${head(slide.headline, 76, 50)}${text}${foot}</div>`;
        case 'comparison': {
            const c = slide.compare || {};
            const col = (title, items, strong) => `<div style="flex:1;display:flex;flex-direction:column;gap:20px;padding:34px;border-radius:28px;${strong ? `background:${theme.primary};color:${theme.onPrimary}` : `border:3px solid ${theme.text}22`}">
<div class="h" style="font-size:50px">${esc(title)}</div>${(items || []).slice(0, 4).map((x) => `<div style="font-size:36px;line-height:1.3">${strong ? '✓' : '✕'} ${esc(x)}</div>`).join('')}</div>`;
            return `<div class="slide"><div class="bar"></div><div class="content">${kicker}${head(slide.headline, 84, 56)}
<div style="display:flex;gap:24px">${col(c.leftTitle || 'Before', c.left, false)}${col(c.rightTitle || 'After', c.right, true)}</div></div>${foot}</div>`;
        }
        case 'cta':
        default:
            return `<div class="slide"><div class="bar"></div><div class="content" style="align-items:flex-start">
${ctx.logo ? `<img class="logo" src="${ctx.logo}" style="max-height:110px;max-width:360px">` : ''}${kicker}${head(slide.headline, 104, 62)}${text}
${slide.cta ? `<span class="pill">${esc(slide.cta)}</span>` : ''}</div>
${slide.handle || kit.website ? `<div style="font-size:34px;font-weight:600;opacity:.8">${esc(slide.handle || String(kit.website).replace(/^https?:\/\//, '').replace(/\/$/, ''))}</div>` : ''}</div>`;
    }
}

/**
 * @param {object} slide   { layout, kicker, headline, body, bullets[], stat{value,label}, quote{text,author}, compare{...}, cta }
 * @param {object} ctx     { kit, format, index, total, image (data URL), logo (data URL), logoOnDark (data URL) }
 */
export function slideHtml(slide, ctx) {
    const theme = themeFromKit(ctx.kit);
    const layout = LAYOUTS[slide.layout] ? slide.layout : 'statement';
    const logo = theme.isDark ? ctx.logoOnDark || ctx.logo : ctx.logo;
    const full = { ...ctx, theme, logo, logoOnDark: ctx.logoOnDark || null };
    return `<!doctype html><html><head><meta charset="utf-8"><style>${ctx.fontCss || ''}</style><style>${baseCss(theme, ctx.format)}</style></head><body>${body(slide, layout, full)}</body></html>`;
}
