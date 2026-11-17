import '../../src/config/firebase.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { normalizeAd, quoteFromProof } from '../../src/services/marketing/ad-plan.js';
import { adHtml } from '../../src/services/marketing/ad-templates.js';

const kit = { name: 'Amber & Co', colors: { primary: '#b45309', background: '#fffbeb', text: '#1c1917' }, fonts: {} };

test('ad copy is normalised: whole-word labels, the angle name only, known layouts', () => {
    const ad = normalizeAd({ layout: 'carousel', angle: 'Pain Point: project chaos costs you', badge: 'Free delivery in Durban', cta: 'Shop the summer sale now today', headline: 'x'.repeat(200) });
    assert.equal(ad.layout, 'bold', 'unknown layouts fall back to the text-only design');
    assert.equal(ad.angle, 'pain point');
    assert.equal(ad.badge, 'Free delivery in', 'a long badge ends on a whole word');
    assert.equal(ad.cta, 'Shop the summer sale now');
    assert.equal(ad.headline.length, 90);
    assert.equal(normalizeAd({ quote: { text: '' } }).quote, null, 'an empty quote is dropped');
});

test('testimonial quotes must come from saved proof, never from the model', () => {
    const proof = ['"Best face oil I have used, my skin glows" — Thandi, Durban'];
    assert.equal(quoteFromProof('Best face oil I have ever used, my skin glows', proof), true, 'a real quote, lightly reworded, is kept');
    assert.equal(quoteFromProof("It's not magic. It's the system. The rhythm. The calm.", proof), false, 'an invented quote is rejected');
    assert.equal(quoteFromProof('Best face oil', []), false, 'no proof means no testimonial');
});

test('ad templates escape every user/AI string and fall back when there is nothing to show', () => {
    const html = adHtml({ layout: 'scene', headline: '<script>alert(1)</script>', cta: '"><img src=x onerror=alert(1)>' }, { kit, format: '1:1', image: null, product: null });
    assert.ok(!html.includes('<script>alert'), 'headline is escaped');
    assert.ok(!html.includes('<img src=x'), 'CTA is escaped');
    assert.ok(html.includes('&lt;script&gt;'));
    // A picture layout without a picture renders the text-only design instead of an empty frame.
    assert.ok(!html.includes('class="shade"'), 'scene without image or product falls back to bold');

    const product = 'data:image/webp;base64,AAAA';
    const withProduct = adHtml({ layout: 'product', headline: 'Hi', cta: 'Buy' }, { kit, format: '9:16', image: null, product, productCutout: true });
    assert.ok(withProduct.includes(product), 'the real product photo is placed in the ad');
    assert.ok(withProduct.includes('width:1080px;height:1920px'), '9:16 renders at 1080×1920');
});

test('Image Ads and Competitors are for paid plans only', async () => {
    const { default: ads } = await import('../../src/routes/marketing-ads');
    const { default: competitors } = await import('../../src/routes/marketing-competitors');
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
        req.workspaceId = 'ws-test';
        req.uid = 'owner';
        req.plan = req.headers['x-test-plan'] || 'starter';
        next();
    });
    app.use('/ads', ads);
    app.use('/competitors', competitors);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    try {
        for (const path of ['/ads/options', '/ads', '/competitors']) {
            const res = await fetch(`${base}${path}`);
            assert.equal(res.status, 403, `${path} is locked on Starter`);
            assert.equal((await res.json()).error, 'UPGRADE_REQUIRED');
        }
        const ok = await fetch(`${base}/ads/options`, { headers: { 'x-test-plan': 'nano' } });
        assert.equal(ok.status, 200, 'Nano can use Image Ads');
        const options = await ok.json();
        assert.deepEqual(options.formats.map((f: any) => f.id), ['1:1', '4:5', '9:16']);
        assert.ok(options.layouts.some((l: any) => l.id === 'offer'));
        const create = await fetch(`${base}/ads`, { method: 'POST' });
        assert.equal(create.status, 403, 'creating ads is locked on Starter too');
    } finally {
        server.close();
    }
});
