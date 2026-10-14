import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { initializeFirebaseAdmin } from './src/config/firebase.js';
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
import { startSchedulerCron } from './src/jobs/scheduler.cron.js';
import connectionsRouter, { startTokenRefreshCron } from './src/routes/connections.ts';
import videoRouter from './src/routes/video.ts';
import scheduleRoutes from './src/routes/schedule.ts';
import trendingRoutes from './src/routes/trending.ts';
import dmRoutes from './src/routes/dm.ts';
import analyticsTsRoutes from './src/routes/analytics.ts';
import billingTsRoutes from './src/routes/billing.ts';
import assetsRoutes from './src/routes/assets.ts';
import bragRoutes from './src/routes/brag.ts';
import musicRoutes from './src/routes/music.ts';
import clipsRoutes from './src/routes/clips.ts';
import repurposeRoutes from './src/routes/repurpose.ts';
import audiomackRoutes from './src/routes/audiomack.ts';
import lyricsRoutes from './src/routes/lyrics.ts';
import { startAnalyticsCron } from './src/jobs/analytics.cron.ts';
import { startTrendingCron } from './src/jobs/trending.cron.ts';
import authRoutes from './src/routes/auth.ts';
import { planRateLimit } from './src/middleware/planGate.ts';
import { logDevPlanOverride } from './src/utils/devPlan.ts';

logDevPlanOverride();

const app = express();
const PORT = process.env.PORT || 5000;

// ---------------------
// Global Middleware
// ---------------------

// Security headers
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// CORS — allow multiple dev origins
const allowedOrigins = [
    process.env.CLIENT_URL,
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else if (process.env.NODE_ENV === 'production') {
            // Production: only CLIENT_URL (and the localhost dev ports) may call the API.
            callback(null, false);
        } else {
            callback(null, true); // Any origin in development
        }
    },
    credentials: true,
}));

// Rate limiting - Global baseline
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'production' ? 1000 : 5000,
    message: { error: 'Too many requests from this IP.' }
});
app.use(globalLimiter);

// Body parsing
app.use(express.json({
    limit: '50mb',
    verify: (req, _res, buf) => {
        req.rawBody = buf.toString('utf8');
    }
}));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan('dev'));

// ---------------------
// Routes
// ---------------------
app.use('/public', express.static(path.join(process.cwd(), 'public')));
if (getStorageDriver() === 'local') {
    app.use('/uploads', express.static(LOCAL_UPLOAD_DIR));
}
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
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

// Python Video processing service endpoints
app.use('/api/video', videoRouter);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/trending', trendingRoutes);
app.use('/api/dm', dmRoutes);
app.use('/api/assets', assetsRoutes);
app.use('/api/brag', bragRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/clips', clipsRoutes);
app.use('/api/repurpose', repurposeRoutes);
app.use('/api/audiomack', audiomackRoutes);
app.use('/api/lyrics', lyricsRoutes);

// Start Background Jobs
startAnalyticsCron();

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


app.listen(PORT, () => {
    console.log(`🚀 KenganSocial API running on http://localhost:${PORT}`);

    // Start scheduler cron job (check every 60 seconds)
    startSchedulerCron(60000);

    // Start OAuth token auto-refresh cron (every 6 hours)
    startTokenRefreshCron();

    // Start Trending Content refresh (every 2 hours)
    startTrendingCron();
});
