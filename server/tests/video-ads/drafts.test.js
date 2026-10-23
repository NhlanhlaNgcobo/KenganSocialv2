import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { prepareDraft } from '../../src/services/video-ads/drafts.js';
import { productImage } from '../../src/services/video-ads/cutout.js';
import { normalizeSource } from '../../src/services/video-ads/validation.js';

const svg = (backdrop) => sharp(Buffer.from(`<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">${backdrop}<rect x="150" y="80" width="100" height="240" rx="30" fill="#2f7d5b"/></svg>`)).jpeg().toBuffer();
const pixelAlpha = async (src, x, y) => {
    const { data, info } = await sharp(Buffer.from(src.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return data[(Math.round(y * (info.height - 1)) * info.width + Math.round(x * (info.width - 1))) * 4 + 3];
};

test('a product on a plain backdrop is cut out and cropped to the product', async () => {
    const photo = await productImage(await svg('<rect width="400" height="400" fill="#f4f4f4"/>'));
    assert.equal(photo.cutout, true);
    assert.ok(photo.width < 140 && photo.height < 280, `${photo.width}x${photo.height}`);
    assert.match(photo.accent, /^#[0-9a-f]{6}$/);
    assert.ok((await pixelAlpha(photo.src, 0, 0)) < 20, 'corner is transparent');
    assert.ok((await pixelAlpha(photo.src, 0.5, 0.5)) > 240, 'product is opaque');
});

test('a busy background is kept and shown as a card', async () => {
    const stripes = Array.from({ length: 20 }, (_, i) => `<rect x="${i * 20}" width="20" height="400" fill="${['#e33', '#33e', '#3e3', '#ee3'][i % 4]}"/>`).join('');
    const photo = await productImage(await svg(stripes));
    assert.equal(photo.cutout, false);
});

test('drafts take their copy from the creator, colours from the brand kit, and refuse corrupt images', async () => {
    const input = normalizeSource({ name: 'Bottle', tagline: 'Cold all day.', points: '["Leak-proof"]', cta: 'Buy now', duration: 10 }, 1);
    const draft = await prepareDraft(input, [{ buffer: await svg('<rect width="400" height="400" fill="#ffffff"/>') }], { colors: { primary: '#ff6600', background: '#ffffff' } });
    assert.equal(draft.script, 'Bottle. Cold all day. Leak-proof. Buy now.');
    assert.equal(draft.palette.accent, '#ff6600');
    assert.equal(draft.palette.fg, '#111114');
    assert.match(draft.photos[0].src, /^data:image\/webp;base64,/);
    await assert.rejects(prepareDraft(input, [{ buffer: Buffer.from('not an image') }], {}));
});
