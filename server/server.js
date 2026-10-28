import { assertProductionConfig } from './src/config/production.js';
import privateMediaRoutes from './src/routes/private-media.js';
import { signMediaResponse } from './src/services/media-links.js';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { apiRateLimits } from './src/middleware/rateLimits.js';
import path from 'path';
import { createPilotAccess, loadPilotEmails } from './src/middleware/pilotAccess.js';
import { createPilotRouter } from './src/routes/pilot';
import { pilotMode } from './src/config/pilot';
import { isActiveMember } from './src/services/pilot-invites';
import { pilotOverviewExtras } from './src/services/pilot-overview';
import { db as firestoreDb } from './src/utils/firestore';
import { betaEnabled, betaFeatureLock, betaLockedPages, betaPlatforms, isBetaOAuthCallback } from './src/config/beta-features.js';
import { getAuth, initializeFirebaseAdmin } from './src/config/firebase.js';
import { getStorageDriver, LOCAL_UPLOAD_DIR } from './src/services/storage.service.js';

// Initialize Firebase Admin SDK immediately
initializeFirebaseAdmin();

import healthRoutes from './src/routes/health.routes.js';
import workspaceRoutes from './src/routes/workspace.routes.js';
import connectionRoutes from './src/routes/connection.routes.js';
import contentRoutes from './src/routes/content.routes.js';
import leadsRoutes from './src/routes/leads.ts';
import automationRoutes from './src/routes/automation.routes.js';
import aiCaptionRoutes from './src/routes/ai.ts';
import aiPipelineRoutes from './src/routes/ai.routes.js';
import mediaRoutes from './src/routes/media.routes.js';
import schedulerRoutes from './src/routes/scheduler.routes.js';
import webhooksRoutes from './src/routes/webhooks.routes.js';
import manualEditRoutes from './src/routes/manual-edit.routes.js';
import { startPostRecovery, stopPostQueue } from './src/queues/postQueue.ts';
import { aiFeatureStatus } from './src/config/ai-features.ts';
import connectionsRouter, { startTokenRefreshCron } from './src/routes/connections.ts';
import privacyRoutes from './src/routes/privacy.ts';
import { features } from './src/utils/features.ts';
import videoRouter from './src/routes/video.ts';
import scheduleRoutes from './src/routes/schedule.ts';
import trendingRoutes from './src/routes/trending.ts';
import dmRoutes from './src/routes/dm.ts';
import adsRoutes from './src/routes/ads.ts';
import analyticsTsRoutes from './src/routes/analytics.ts';
import billingTsRoutes from './src/routes/billing.ts';
import assetsRoutes from './src/routes/assets.ts';
import bragRoutes from './src/routes/brag.ts';
import musicRoutes from './src/routes/music.ts';
import clipsRoutes, { recoverInterruptedClipProjects } from './src/routes/clips.ts';
import repurposeRoutes from './src/routes/repurpose.ts';
import marketingRoutes from './src/routes/marketing.ts';
import agencyRoutes from './src/routes/agency.ts';
import reviewRoutes from './src/routes/review.ts';
import aiEditRoutes from './src/routes/ai-edit.ts';
import audiomackRoutes from './src/routes/audiomack.ts';
import lyricsRoutes from './src/routes/lyrics.ts';
import { startAnalyticsCron } from './src/jobs/analytics.cron.ts';
import { startTrendingCron } from './src/jobs/trending.cron.ts';
import authRoutes from './src/routes/auth.ts';
import dataDeletionRoutes from './src/routes/data-deletion.ts';
import freeClipRoutes, { recoverInterruptedFreeClips } from './src/routes/free-clip.ts';
import thumbnailRoutes from './src/routes/thumbnails.ts';
import './src/services/webhooks/handlers.ts';
import { startWebhookWorker } from './src/services/webhooks/dispatcher.ts';
import { planRateLimit } from './src/middleware/planGate.ts';
import { startTempSweeper } from './src/jobs/temp-sweeper.js';
import { logDevPlanOverride } from './src/utils/devPlan.ts';

logDevPlanOverride();

const app = express();
const PORT = process.env.PORT || 5000;
assertProductionConfig();
const isProduction = process.env.NODE_ENV === 'production';

// Behind a reverse proxy (Caddy on the VM): use the client's address from X-Forwarded-For, so
// rate limits and consent records see real IPs. TRUST_PROXY = number of proxy hops (default 1
// in production, 0 = off).
const trustProxy = Number(process.env.TRUST_PROXY ?? (isProduction ? 1 : 0));
if (trustProxy > 0) app.set('trust proxy', trustProxy);

// ---------------------
// Global Middleware
// ---------------------

// Security headers
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// CORS: the web app (CLIENT_URL) plus any CORS_EXTRA_ORIGINS, comma-separated (e.g. the www
// domain). The localhost dev ports are allowed outside production only.
const allowedOrigins = [
    process.env.CLIENT_URL,
    ...(process.env.CORS_EXTRA_ORIGINS || '').split(','),
    ...(isProduction ? [] : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:4173']),
].map((o) => (o || '').trim().replace(/[/]+$/, '')).filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else if (isProduction) {
            // Production: only the CLIENT_URL origins may call the API.
            callback(null, false);
        } else {
            callback(null, true); // Any origin in development
        }
    },
    credentials: true,
}));

// Rate limiting - baseline per signed-in user (plus a higher per-IP ceiling), counted in Redis
app.use(...apiRateLimits());

// Body parsing
app.use(express.json({
    limit: '50mb',
    verify: (req, _res, buf) => {
        req.rawBody = buf.toString('utf8');
    }
}));
app.use(express.urlencoded({ extended: true }));

// Logging
// Signed media URLs are credentials: never include their query strings in logs.
// Paths only: query strings can carry access tokens (free-clip links, signed media) and must not reach logs.
morgan.token('path-only', (req) => (req.originalUrl || req.url || '').split('?')[0]);
app.use(morgan(':method :path-only :status :response-time ms', { skip: req => req.path.startsWith('/api/private-media/') }));

// ---------------------
// Routes
// ---------------------
app.use('/public', express.static(path.join(process.cwd(), 'public')));
// Platform site-verification files (e.g. TikTok "URL prefix" verification) must sit at the
// site root. Only files named tiktok*.txt from public/verification are served here.
app.get(/^\/tiktok[A-Za-z0-9_-]+\.txt$/, (req, res) => {
    const file = path.join(process.cwd(), 'public', 'verification', path.basename(req.path));
    res.type('text/plain').sendFile(file, (err) => err && res.status(404).end());
});
// Public legal pages (platform app reviews need them on a reachable URL). Built from
// client/src/content/legal.js by scripts/build-legal-html.mjs.
for (const slug of ['terms', 'privacy', 'data-deletion']) {
    app.get(`/${slug}`, (_req, res) => res.sendFile(path.join(process.cwd(), 'public', 'legal', `${slug}.html`)));
}
// Raw storage paths are never exposed anonymously.
app.use('/uploads', (_req, res) => res.status(403).json({ error: 'Use an authorized media link.' }));
app.use(signMediaResponse);
app.use('/api/private-media', privateMediaRoutes);
app.use('/api/health', healthRoutes);
// Feature switches the app needs before sign-in (e.g. whether YouTube link import is on).
app.get('/api/features', (_req, res) => res.json({ youtubeLinkImport: features.youtubeLinkImport(), beta: betaEnabled(), lockedPages: betaEnabled() ? betaLockedPages() : [], betaPlatforms: betaEnabled() ? betaPlatforms() : null, aiFeatures: aiFeatureStatus(), pilot: pilotMode() }));
// Recipients authenticate with the scoped, expiring review token, not a pilot account.
app.use('/api/review', reviewRoutes);
// The pilot protects authenticated APIs and anonymous processing routes.
const verifyIdToken = (token, revoked) => getAuth().verifyIdToken(token, revoked);
const pilotAccess = createPilotAccess(loadPilotEmails(), verifyIdToken, { enabled: pilotMode, isActive: (uid) => isActiveMember(firestoreDb, uid) });
// Invite redemption and pilot admin tools check the token themselves (an invitee isn't a member yet).
app.use('/api/pilot', createPilotRouter({
    db: firestoreDb,
    verifyToken: verifyIdToken,
    forget: (uid) => pilotAccess.forget(uid),
    revokeSessions: (uid) => getAuth().revokeRefreshTokens(uid),
    overviewExtras: pilotOverviewExtras,
}));
// A beta platform's OAuth callback arrives from the platform without our token; its signed,
// expiring state (issued only to an invited, signed-in owner or admin) is checked in the route.
app.use('/api', (req, res, next) => (isBetaOAuthCallback(req.path) ? next() : pilotAccess(req, res, next)));
app.use('/api', betaFeatureLock);
app.use('/api/auth', authRoutes);
// Landing page: one free starter clip per person, no account needed.
app.use('/api/free-clip', freeClipRoutes);
app.use('/api/data-deletion', dataDeletionRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/workspaces/:workspaceId/connections', connectionRoutes);
app.use('/api/workspaces/:workspaceId/content', contentRoutes);
app.use('/api/workspaces/:workspaceId/leads', leadsRoutes);
app.use('/api/workspaces/:workspaceId/automations', automationRoutes);
app.use('/api/ai', aiCaptionRoutes);
app.use('/api/ai', aiPipelineRoutes);
app.use('/api/workspaces/:workspaceId/media', mediaRoutes);
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/analytics', analyticsTsRoutes);
app.use('/api/billing', billingTsRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/video/manual-edit', manualEditRoutes);
// OAuth connections (platform auth + callbacks — no workspaceId prefix needed for callbacks)
app.use('/api/connections', connectionsRouter);
// Data export, account deletion and Meta's data deletion / deauthorize callbacks.
app.use('/api/privacy', privacyRoutes);

// Python Video processing service endpoints
app.use('/api/video', videoRouter);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/trending', trendingRoutes);
app.use('/api/dm', dmRoutes);
app.use('/api/ads', adsRoutes);
app.use('/api/assets', assetsRoutes);
app.use('/api/brag', bragRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/clips', clipsRoutes);
app.use('/api/thumbnails', thumbnailRoutes);
app.use('/api/repurpose', repurposeRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/agency', agencyRoutes);
// AI Edit: edit footage in the style of a reference video.
app.use('/api/ai-edit', aiEditRoutes);
// Public: client review links (access is the link token, no account).
app.use('/api/audiomack', audiomackRoutes);
app.use('/api/lyrics', lyricsRoutes);

// Background jobs act on shared data (Firestore). BACKGROUND_JOBS=off lets a second copy of the
// API (a local run against the live project) serve requests without recovering, retrying or
// refreshing the live server's work: its clip recovery would fail projects the live server is
// still rendering.
const backgroundJobs = String(process.env.BACKGROUND_JOBS || 'on').toLowerCase() !== 'off';
if (backgroundJobs) startAnalyticsCron();

// ---------------------
// 404 Handler
// ---------------------

// ---------------------
// 404 Handler
// ---------------------
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// ---------------------
// Global Error Handler
// ---------------------
app.use((err, req, res, next) => {
    console.error('[Server Error]', err.stack);
    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message,
    });
});

// ---------------------
// Start Server
// ---------------------


let inlineAiWorker = null;
const server = app.listen(PORT, () => {
    console.log(`🚀 KenganSocial API running on http://localhost:${PORT}`);
    const aiOn = Object.entries(aiFeatureStatus()).filter(([, on]) => on).map(([id]) => id);
    console.log(`[AI] Optional AI features on: ${aiOn.length ? aiOn.join(', ') : 'none (launch mode: core AI only)'}`);

    // Scheduled posts publish through the BullMQ queue (src/queues/postQueue.ts); this re-queues
    // any pending post that is missing from it (e.g. saved while Redis was unreachable).
    if (backgroundJobs) startPostRecovery();
    else console.log('[Jobs] BACKGROUND_JOBS=off: no post recovery, clip recovery, token refresh, trending or webhook jobs');

    // Clip projects and free clips run in this process only: anything still running when the
    // process stopped was lost, so fail it now (with allowance and free-clip claim given back).
    if (backgroundJobs) recoverInterruptedClipProjects()
        .then((n) => n && console.log(`[Clips] Marked ${n} interrupted project(s) as failed`))
        .catch((error) => console.warn('[Clips] Recovery skipped:', error.message));
    if (backgroundJobs) recoverInterruptedFreeClips()
        .then((n) => n && console.log(`[FreeClip] Released ${n} interrupted free clip(s)`))
        .catch((error) => console.warn('[FreeClip] Recovery skipped:', error.message));

    // AI editing runs in its own worker (docker-compose "ai-worker"). Locally, run it inside the
    // API so queued edits don't wait for a worker nobody started.
    if (process.env.NODE_ENV !== 'production' && process.env.AI_EDIT_INLINE_WORKER !== 'off') {
        import('./src/workers/ai-edit.ts')
            .then((mod) => {
                inlineAiWorker = mod;
                console.log('🤖 AI edit worker running inside the API (development)');
            })
            .catch((error) => console.error('[AI worker] Could not start in-process:', error.message));
    }

    if (backgroundJobs) {
        // Start OAuth token auto-refresh cron (every 6 hours)
        startTokenRefreshCron();

        // Start Trending Content refresh (every 2 hours)
        startTrendingCron();

        // Webhook retries and stale-event recovery (every minute), purge of old events (daily)
        startWebhookWorker();
    }

    // Old renders and uploads in the temp folder (hourly)
    startTempSweeper();
});

// Graceful shutdown (deploys send SIGTERM): stop accepting requests, let posts being published
// finish, then exit. Long renders can't finish in the grace period; they are failed and refunded
// by the recovery above on the next start.
let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Shutdown] ${signal}: draining`);
    const force = setTimeout(() => process.exit(1), 50_000);
    force.unref();
    server.close();
    await Promise.allSettled([stopPostQueue(), inlineAiWorker?.stopAiEditWorker?.()]);
    console.log('[Shutdown] Done');
    process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
