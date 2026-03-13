import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'KenganSocial API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
    });
});

export default router;
