import express, { Request, Response } from 'express';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'path';
import fs from 'fs';
import puppeteer from 'puppeteer';
import admin from 'firebase-admin';
import cron from 'node-cron';
import axios from 'axios';

// Initialize Firebase Admin (Assuming credentials are provided via ENV)
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'kengansocialv2.appspot.com'
    });
}
const db = admin.firestore();
const bucket = admin.storage().bucket();

const app = express();
app.use(express.json());

// Main App API to call when checking gate logic
const MAIN_API_URL = process.env.MAIN_API_URL || 'http://localhost:5000';

// Setup local serve URL for Remotion bundle
const serveUrl = path.resolve(__dirname, '../build');

// ─────────────────────────────────────────────────────────────────────────────
// RENDER CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────
app.post('/render', async (req: Request, res: Response) => {
    const { compositionId, props, userId, workspaceId } = req.body;
    const token = req.headers.authorization;

    try {
        // 1. Verify render limit via planGate API node call
        const gateCheck = await axios.get(`${MAIN_API_URL}/api/billing/check-limit?feature=renders&workspaceId=${workspaceId}`, {
            headers: { Authorization: token }
        });

        if (!gateCheck.data?.allowed) {
            return res.status(402).json({ error: 'Render limit reached. Please upgrade your plan.' });
        }

        const jobId = `render_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const outputLocation = `/tmp/${jobId}.mp4`;

        // 2. Select Composition
        const composition = await selectComposition({
            serveUrl,
            id: compositionId,
            inputProps: props,
        });

        // 3. Render Media natively
        await renderMedia({
            composition,
            serveUrl,
            codec: 'h264',
            outputLocation,
            inputProps: props,
            imageFormat: 'jpeg',
            chromiumOptions: { args: ['--no-sandbox'] }
        });

        // 4. Upload to Firebase Storage
        const destination = `exports/${workspaceId}/templates/${jobId}.mp4`;
        await bucket.upload(outputLocation, {
            destination,
            metadata: { contentType: 'video/mp4' }
        });

        // Clean up tmp file
        fs.unlinkSync(outputLocation);

        // Get public URL safely
        const [url] = await bucket.file(destination).getSignedUrl({
            action: 'read',
            expires: '03-01-2500' // Permanent read 
        });

        res.json({ success: true, outputUrl: url, duration: composition.durationInFrames / composition.fps, fileSize: 0 }); // file size optional or stat
    } catch (err: any) {
        console.error('Render pipeline error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATES BROWSER API
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/templates', async (req: Request, res: Response) => {
    const { category, search, limit = 20 } = req.query;

    try {
        let query: admin.firestore.Query<admin.firestore.DocumentData> = db.collection('templates');

        if (category) query = query.where('category', '==', category);

        // Fetch snapshot
        const snap = await query.limit(Number(limit)).get();
        let templates = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Manual search filter if applicable
        if (search) {
            const sc = (search as string).toLowerCase();
            templates = templates.filter(t => t.name.toLowerCase().includes(sc) || t.tags?.some((tg: string) => tg.toLowerCase().includes(sc)));
        }

        res.json({ success: true, count: templates.length, templates });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY PUPPETEER SCRAPER CRON 
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("0 0 * * 1", async () => {
    console.log('[Cron] Starting weekly Mixkit template scrape...');
    try {
        const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();

        await page.goto('https://mixkit.co/free-video-templates/', { waitUntil: 'networkidle2' });

        // Evaluate DOM extraction mapping
        const scrapedTemplates = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.item-grid__item'));
            return items.slice(0, 30).map(item => {
                const titleEl = item.querySelector('.item-grid-card__title');
                const videoEl = item.querySelector('video source');
                const linkEl = item.querySelector('.item-grid-card__overlay-link') as HTMLAnchorElement;

                return {
                    name: titleEl?.textContent?.trim() || 'Video Template',
                    previewUrl: videoEl ? videoEl.getAttribute('src') : '',
                    downloadUrl: linkEl ? linkEl.href : '',
                    category: 'video',
                    tags: ['mixkit', 'free', 'template'],
                    source: 'scraped',
                };
            }).filter(t => t.previewUrl);
        });

        await browser.close();

        // Safe DB push rotating over 100 limit constraints
        if (scrapedTemplates.length > 0) {
            const batch = db.batch();
            const collectionRef = db.collection('templates');

            // 1. Fetch all existing scraped templates
            const existingSnap = await collectionRef.where('source', '==', 'scraped').orderBy('scrapedAt', 'asc').get();

            // 2. Clear out older templates over 100 queue capacity dynamically
            const overflow = (existingSnap.size + scrapedTemplates.length) - 100;
            if (overflow > 0) {
                // Delete oldest
                for (let i = 0; i < overflow; i++) {
                    if (existingSnap.docs[i]) batch.delete(existingSnap.docs[i].ref);
                }
            }

            // 3. Inject new templates safely
            scrapedTemplates.forEach(template => {
                const newRef = collectionRef.doc();
                batch.set(newRef, {
                    ...template,
                    scrapedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            });

            await batch.commit();
            console.log(`[Cron] Successfully stored ${scrapedTemplates.length} templates. Cleaned overflow: ${overflow > 0 ? overflow : 0}`);
        }
    } catch (err) {
        console.error('[Cron] Scraper failed:', err);
    }
});

// Boot wrapper
const PORT = process.env.PORT || 8001;
app.listen(PORT, () => {
    console.log(`[Remotion Microservice] Listening heavily on port ${PORT}`);
});
