import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { initializeFirebaseAdmin } from './src/config/firebase.js';
import authRoutes from './src/routes/auth.routes.js';
import healthRoutes from './src/routes/health.routes.js';
import workspaceRoutes from './src/routes/workspace.routes.js';
import connectionRoutes from './src/routes/connection.routes.js';
import contentRoutes from './src/routes/content.routes.js';
import leadsRoutes from './src/routes/leads.routes.js';
import automationRoutes from './src/routes/automation.routes.js';
import aiRoutes from './src/routes/ai.routes.js';
import mediaRoutes from './src/routes/media.routes.js';
import schedulerRoutes from './src/routes/scheduler.routes.js';
import analyticsRoutes from './src/routes/analytics.routes.js';
import billingRoutes from './src/routes/billing.routes.js';
import webhooksRoutes from './src/routes/webhooks.routes.js';
import manualEditRoutes from './src/routes/manual-edit.routes.js';
import { startSchedulerCron } from './src/jobs/scheduler.cron.js';

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();

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
        } else {
            callback(null, true); // Allow all in dev
        }
    },
    credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 100 : 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan('dev'));

// ---------------------
// Routes
// ---------------------
app.use('/public', express.static(path.join(process.cwd(), 'public')));
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/workspaces/:workspaceId/connections', connectionRoutes);
app.use('/api/workspaces/:workspaceId/content', contentRoutes);
app.use('/api/workspaces/:workspaceId/leads', leadsRoutes);
app.use('/api/workspaces/:workspaceId/automations', automationRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/workspaces/:workspaceId/media', mediaRoutes);
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/video/manual-edit', manualEditRoutes);

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
});
