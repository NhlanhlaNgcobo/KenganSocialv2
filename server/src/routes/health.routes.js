import { Router } from 'express';
import { getFirestore } from '../config/firebase.js';
import { readyUsageRedis } from '../utils/usageRedis.ts';
import { readiness } from '../services/readiness.js';

const router = Router();
router.get('/ready', async (_req, res) => {
    const result = await readiness({
        redis: async () => (await readyUsageRedis()).ping(),
        aiWorker: async () => {
            const value = await (await readyUsageRedis()).get('workers:ai-edit:heartbeat');
            if (!value || Date.now() - Number(value) > 60000) throw new Error('AI worker unavailable');
        },
        firestore: () => getFirestore().collection('workspaces').limit(1).get(),
        video: async () => {
            const response = await fetch(`${process.env.PYTHON_API_URL || 'http://localhost:8000'}/health`, { signal: AbortSignal.timeout(2000) });
            if (!response.ok) throw new Error('Video service unavailable');
        },
    });
    res.set('Cache-Control', 'no-store').status(result.ready ? 200 : 503).json(result);
});

router.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'KenganSocial API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
    });
});

export default router;
