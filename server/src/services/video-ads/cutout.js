import sharp from 'sharp';

/**
 * Product photos for the 3D scene. A product shot on a plain backdrop (white, grey, one colour)
 * is cut out: the backdrop is flood-filled from the edges, the edge feathered and the image
 * cropped to the product, so it can turn and float with a real shadow. Busy backgrounds are left
 * as they are and shown as a card. No AI and no external service.
 */

const MAX_SIDE = 1200;
const TOLERANCE = 44; // RGB distance from the backdrop colour that still counts as backdrop
const dist = (d, i, c) => Math.hypot(d[i] - c[0], d[i + 1] - c[1], d[i + 2] - c[2]);

function borderIndexes(w, h) {
    const out = [];
    for (let x = 0; x < w; x++) out.push(x, (h - 1) * w + x);
    for (let y = 1; y < h - 1; y++) out.push(y * w, y * w + w - 1);
    return out;
}

/** Median colour of the border, and how much of the border is close to it. */
function backdrop(data, w, h) {
    const border = borderIndexes(w, h);
    const median = [0, 1, 2].map((c) => {
        const values = border.map((p) => data[p * 4 + c]).sort((a, b) => a - b);
        return values[values.length >> 1];
    });
    const near = border.filter((p) => dist(data, p * 4, median) <= TOLERANCE * 0.7).length;
    const transparent = border.filter((p) => data[p * 4 + 3] < 128).length;
    return { color: median, uniform: near / border.length, transparent: transparent / border.length };
}

/** Foreground mask: everything the backdrop flood fill from the edges cannot reach. */
function floodMask(data, w, h, color) {
    const mask = new Uint8Array(w * h).fill(255);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;
    for (const p of borderIndexes(w, h)) {
        if (mask[p] && dist(data, p * 4, color) <= TOLERANCE) {
            mask[p] = 0;
            queue[tail++] = p;
        }
    }
    while (head < tail) {
        const p = queue[head++];
        const x = p % w;
        for (const n of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
            if (n < 0 || n >= w * h || !mask[n]) continue;
            if (dist(data, n * 4, color) > TOLERANCE) continue;
            mask[n] = 0;
            queue[tail++] = n;
        }
    }
    return mask;
}

function boundingBox(alpha, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (alpha[y * w + x] < 24) continue;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
    }
    if (x1 < 0) return null;
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
    const left = Math.max(0, x0 - pad);
    const top = Math.max(0, y0 - pad);
    return { left, top, width: Math.min(w, x1 + pad + 1) - left, height: Math.min(h, y1 + pad + 1) - top };
}

/** The most colourful average of the product's own pixels, for an accent colour when there is no brand kit. */
function accentOf(data, alpha) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let p = 0; p < alpha.length; p += 7) {
        if (alpha[p] < 200) continue;
        const [R, G, B] = [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]];
        const max = Math.max(R, G, B);
        const min = Math.min(R, G, B);
        if (max < 40 || (max - min) / max < 0.3) continue;
        r += R; g += G; b += B; n++;
    }
    if (n < 50) return null;
    return `#${[r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * @param {Buffer} buffer an uploaded JPG/PNG/WebP
 * @returns {Promise<{ src: string, cutout: boolean, width: number, height: number, accent: string|null }>}
 */
export async function productImage(buffer) {
    const { data, info } = await sharp(buffer, { limitInputPixels: 40000000 })
        .rotate()
        .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    const edge = backdrop(data, w, h);

    let alpha = null;
    if (edge.transparent > 0.3) {
        // Already cut out (a PNG or WebP with transparency).
        alpha = Uint8Array.from({ length: w * h }, (_, p) => data[p * 4 + 3]);
    } else if (edge.uniform >= 0.75) {
        const mask = floodMask(data, w, h, edge.color);
        const kept = mask.reduce((sum, v) => sum + (v ? 1 : 0), 0) / mask.length;
        if (kept > 0.03 && kept < 0.97) {
            // Feathered edge: the hard mask, blurred slightly.
            const soft = await sharp(Buffer.from(mask), { raw: { width: w, height: h, channels: 1 } }).blur(1.1).extractChannel(0).raw().toBuffer();
            alpha = Uint8Array.from(soft);
        }
    }

    if (!alpha) {
        const image = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).removeAlpha().webp({ quality: 88 }).toBuffer();
        return { src: `data:image/webp;base64,${image.toString('base64')}`, cutout: false, width: w, height: h, accent: null };
    }

    for (let p = 0; p < alpha.length; p++) data[p * 4 + 3] = Math.min(data[p * 4 + 3], alpha[p]);
    const box = boundingBox(alpha, w, h) || { left: 0, top: 0, width: w, height: h };
    const image = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).extract(box).webp({ quality: 90, alphaQuality: 95 }).toBuffer();
    return { src: `data:image/webp;base64,${image.toString('base64')}`, cutout: true, width: box.width, height: box.height, accent: accentOf(data, alpha) };
}
