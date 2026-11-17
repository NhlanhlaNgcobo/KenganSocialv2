import { FORMATS, themeFromKit } from './carousel-templates.js';

/**
 * Single-image ad templates. Like the carousel slides, every word is drawn by the template in the
 * brand's own fonts and colours (image models still misspell), and the real product photo is
 * composited on top of the AI backdrop, so the product in the ad is exactly the one being sold.
 *
 * Visual inputs (all data URLs, all optional):
 *   image    text-free AI backdrop scene, or the product photo itself when no AI image was made
 *   product  the product photo; `productCutout` says its background was removed
 */

export { FORMATS };

export const AD_LAYOUTS = {
    scene: 'Full-bleed scene with the product, headline and call to action over a soft shade',
    product: 'Product large on a brand-coloured stage, headline above, call to action below',
    split: 'Image on top, copy panel in brand colours below',
    offer: 'A big offer or price as the hero, with the product beside it',
    testimonial: 'A customer quote with stars, the product and a call to action',
    bold: 'Text only: one big headline on the brand colour, for ads without a product photo',
};

/** Layouts that need a picture (an AI scene or the product photo) to look right. */
export const VISUAL_LAYOUTS = ['scene', 'product', 'split'];

const esc = (s) =>
    String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const stack = (font, fallback) => (font ? `"${String(font).replace(/["\\]/g, '')}", ${fallback}` : fallback);

/** Font size that shrinks as the text gets longer, scaled to the canvas width. */
function fit(text, width, max, min) {
    const len = String(text || '').length;
    const size = max - Math.max(0, len - 18) * ((max - min) / 60);
    return Math.round((Math.max(min, Math.min(max, size)) * width) / 1080);
}

function css(theme, format) {
    const { width, height } = FORMATS[format] || FORMATS['1:1'];
    const pad = Math.round(width * 0.07);
    const u = (px) => Math.round((px * width) / 1080);
    return `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${width}px;height:${height}px;overflow:hidden}
body{background:${theme.bg};color:${theme.text};font-family:${stack(theme.bodyFont, 'Inter, "Segoe UI", Arial, sans-serif')};-webkit-font-smoothing:antialiased}
.ad{position:relative;width:100%;height:100%;padding:${pad}px;display:flex;flex-direction:column;gap:${u(26)}px;overflow:hidden}
.h{font-family:${stack(theme.headingFont, 'Inter, "Segoe UI", Arial, sans-serif')};font-weight:800;line-height:1.04;letter-spacing:-0.015em;text-wrap:balance}
.sub{font-size:${u(38)}px;line-height:1.35;opacity:.92;text-wrap:pretty}
.cta{align-self:flex-start;display:inline-flex;align-items:center;gap:${u(14)}px;padding:${u(22)}px ${u(40)}px;border-radius:999px;background:${theme.primary};color:${theme.onPrimary};font-weight:800;font-size:${u(36)}px;box-shadow:0 ${u(10)}px ${u(30)}px -${u(12)}px rgba(0,0,0,.45)}
.badge{position:absolute;top:${pad}px;right:${pad}px;padding:${u(14)}px ${u(26)}px;border-radius:999px;background:${theme.accent};color:${theme.onAccent};font-weight:800;font-size:${u(28)}px;letter-spacing:.04em;text-transform:uppercase;z-index:3}
.logo{position:relative;z-index:3;max-height:${u(70)}px;max-width:${u(280)}px;object-fit:contain;object-position:left center;align-self:flex-start}
.brand{position:relative;z-index:3;font-weight:800;font-size:${u(32)}px}
.fill{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.18) 0%,rgba(0,0,0,0) 30%,rgba(0,0,0,.08) 50%,rgba(0,0,0,.82) 100%)}
.prod{object-fit:contain;filter:drop-shadow(0 ${u(28)}px ${u(34)}px rgba(0,0,0,.38))}
.card{object-fit:cover;border-radius:${u(28)}px;box-shadow:0 ${u(24)}px ${u(60)}px -${u(20)}px rgba(0,0,0,.5)}
.stars{color:${theme.accent};font-size:${u(46)}px;letter-spacing:${u(6)}px}
`;
}

function mark(ctx, onDark) {
    const logo = onDark ? ctx.logoOnDark || null : ctx.logo;
    return logo ? `<img class="logo" src="${logo}">` : `<span class="brand">${esc(ctx.kit?.name || '')}</span>`;
}

/** The product, drawn as a floating cut-out or, when its background couldn't be removed, a card. */
function productEl(ctx, style) {
    if (!ctx.product) return '';
    return `<img class="${ctx.productCutout ? 'prod' : 'card'}" src="${ctx.product}" style="${style}">`;
}

function body(ad, ctx) {
    const { theme, format } = ctx;
    const { width, height } = FORMATS[format] || FORMATS['1:1'];
    const tall = height / width > 1.5;
    const u = (px) => Math.round((px * width) / 1080);
    const badge = ad.badge ? `<div class="badge">${esc(ad.badge)}</div>` : '';
    const cta = ad.cta ? `<span class="cta">${esc(ad.cta)} →</span>` : '';
    const sub = ad.subhead ? `<p class="sub">${esc(ad.subhead)}</p>` : '';
    const head = (max, min, extra = '') => `<h1 class="h" style="font-size:${fit(ad.headline, width, max, min)}px;${extra}">${esc(ad.headline)}</h1>`;
    // A scene behind the product: the AI backdrop, else the product photo itself fills the frame.
    const backdrop = ctx.image || (!ctx.productCutout ? ctx.product : null);

    switch (ad.layout) {
        case 'scene': {
            // A cut-out product floats over the scene (or over the brand gradient when there is no scene).
            const showProduct = ctx.product && ctx.productCutout;
            return `<div class="ad" style="color:#fff">
${backdrop ? `<img class="fill" src="${backdrop}">` : `<div class="fill" style="background:linear-gradient(160deg,${theme.primary},${theme.accent})"></div>`}
${showProduct ? productEl(ctx, `position:absolute;left:50%;top:${tall ? 16 : 9}%;transform:translateX(-50%);width:${tall ? 70 : 50}%;max-height:${tall ? 40 : 38}%`) : ''}
<div class="shade"></div>${badge}${mark(ctx, true)}
<div style="margin-top:auto;position:relative;display:flex;flex-direction:column;gap:${u(22)}px">${head(108, 62, 'text-shadow:0 2px 24px rgba(0,0,0,.35)')}${sub}${cta}</div></div>`;
        }
        case 'product': {
            const stage = ctx.image
                ? `<img class="fill" src="${ctx.image}"><div class="fill" style="background:linear-gradient(180deg,${theme.bg}f2 0%,${theme.bg}66 34%,${theme.bg}00 60%,${theme.bg}d9 100%)"></div>`
                : `<div class="fill" style="background:radial-gradient(ellipse at 50% 58%,${theme.primary}38 0%,${theme.bg} 62%)"></div>`;
            const pic = ctx.product ? productEl(ctx, `width:${ctx.productCutout ? 78 : 64}%;max-height:100%;`) : '';
            return `<div class="ad">${stage}${badge}${mark(ctx, theme.isDark)}
<div style="position:relative;display:flex;flex-direction:column;gap:${u(16)}px">${head(96, 56)}${sub}</div>
<div style="position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center">${pic}</div>
<div style="position:relative;display:flex;justify-content:center">${cta}</div></div>`;
        }
        case 'split': {
            const mediaH = Math.round(height * (tall ? 0.56 : 0.54));
            const inner = backdrop
                ? `<img class="fill" src="${backdrop}">${ctx.image && ctx.product && ctx.productCutout ? productEl(ctx, `position:absolute;left:50%;bottom:6%;transform:translateX(-50%);width:58%;max-height:78%`) : ''}`
                : ctx.product
                  ? `<div class="fill" style="display:flex;align-items:center;justify-content:center;background:${theme.primary}22">${productEl(ctx, 'width:60%;max-height:84%')}</div>`
                  : `<div class="fill" style="background:linear-gradient(160deg,${theme.primary},${theme.accent})"></div>`;
            return `<div class="ad" style="padding:0;gap:0">
<div style="position:relative;height:${mediaH}px;overflow:hidden">${inner}${badge}</div>
<div style="flex:1;display:flex;flex-direction:column;gap:${u(22)}px;padding:${u(60)}px ${u(76)}px;background:${theme.primary};color:${theme.onPrimary}">
${head(84, 50)}${sub}<div style="margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:${u(20)}px">
${ad.cta ? `<span class="cta" style="background:${theme.onPrimary};color:${theme.primary}">${esc(ad.cta)} →</span>` : '<span></span>'}${mark(ctx, true)}</div></div></div>`;
        }
        case 'offer': {
            const offer = ad.offer || ad.badge || '';
            return `<div class="ad" style="background:${theme.primary};color:${theme.onPrimary}">
${mark(ctx, true)}
<div style="display:flex;flex-direction:column;gap:${u(14)}px;margin-top:${u(20)}px">
<div class="h" style="font-size:${fit(offer, width, 220, 110)}px;line-height:.95;color:${theme.onPrimary}">${esc(offer)}</div>${head(76, 46)}</div>
${ctx.product || backdrop ? `<div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:${tall ? 'center' : 'flex-end'}">${ctx.product ? productEl(ctx, `width:${tall ? 70 : 52}%;max-height:100%`) : `<img class="card" src="${backdrop}" style="width:${tall ? 80 : 56}%;max-height:100%">`}</div>` : '<div style="flex:1"></div>'}
${sub}${ad.cta ? `<span class="cta" style="background:${theme.onPrimary};color:${theme.primary}">${esc(ad.cta)} →</span>` : ''}</div>`;
        }
        case 'testimonial': {
            const q = ad.quote?.text || ad.headline;
            return `<div class="ad">${mark(ctx, theme.isDark)}
<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:${u(30)}px">
<div class="stars">★★★★★</div>
<div class="h" style="font-size:${fit(q, width, 76, 44)}px;font-weight:700;line-height:1.2">“${esc(q)}”</div>
${ad.quote?.author ? `<div style="font-size:${u(34)}px;font-weight:700;color:${theme.primaryText}">— ${esc(ad.quote.author)}</div>` : ''}</div>
<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:${u(24)}px">
<div style="display:flex;flex-direction:column;gap:${u(18)}px">${ad.quote?.text && ad.headline ? `<div class="sub" style="font-weight:700">${esc(ad.headline)}</div>` : ''}${cta}</div>
${ctx.product ? productEl(ctx, `width:${u(tall ? 380 : 320)}px;max-height:${u(tall ? 460 : 340)}px`) : backdrop ? `<img class="card" src="${backdrop}" style="width:${u(300)}px;height:${u(300)}px">` : ''}</div>${badge}</div>`;
        }
        case 'bold':
        default:
            return `<div class="ad" style="background:${theme.primary};color:${theme.onPrimary};justify-content:center">${badge}
<div style="position:absolute;top:${Math.round(width * 0.07)}px;left:${Math.round(width * 0.07)}px">${mark(ctx, true)}</div>
${head(132, 70)}${sub}${ad.cta ? `<span class="cta" style="background:${theme.onPrimary};color:${theme.primary}">${esc(ad.cta)} →</span>` : ''}</div>`;
    }
}

/**
 * @param {object} ad   { layout, badge, headline, subhead, offer, cta, quote{text,author} }
 * @param {object} ctx  { kit, format, image, product, productCutout, logo, logoOnDark, fontCss }
 */
export function adHtml(ad, ctx) {
    const theme = themeFromKit(ctx.kit);
    let layout = AD_LAYOUTS[ad.layout] ? ad.layout : 'bold';
    // A picture layout with nothing to show falls back to the text-only design.
    if (VISUAL_LAYOUTS.includes(layout) && !ctx.image && !ctx.product) layout = 'bold';
    const logo = theme.isDark ? ctx.logoOnDark || ctx.logo : ctx.logo;
    const full = { ...ctx, theme, logo };
    return `<!doctype html><html><head><meta charset="utf-8"><style>${ctx.fontCss || ''}</style><style>${css(theme, ctx.format)}</style></head><body>${body({ ...ad, layout }, full)}</body></html>`;
}
