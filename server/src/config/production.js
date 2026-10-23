/** Fail startup rather than serve a half-configured production application. */
export function assertProductionConfig(env = process.env) {
    if (env.NODE_ENV !== 'production') return;
    const missing = ['CLIENT_URL', 'FRONTEND_URL', 'SERVER_URL', 'FIREBASE_PROJECT_ID', 'TOKEN_ENCRYPTION_KEY'].filter(key => !env[key]);
    if (missing.length) throw new Error(`Missing production configuration: ${missing.join(', ')}`);
    for (const key of ['CLIENT_URL', 'FRONTEND_URL', 'SERVER_URL']) {
        const value = new URL(env[key]);
        if (value.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(value.hostname)) throw new Error(`${key} must use the public HTTPS domain`);
    }
    if (!/^[a-f0-9]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY)) throw new Error('TOKEN_ENCRYPTION_KEY must contain 32 bytes encoded as 64 hexadecimal characters');
    if (env.DEV_PLAN_OVERRIDE) throw new Error('Remove DEV_PLAN_OVERRIDE before production');
    if (['PAYFAST_MERCHANT_ID', 'PAYFAST_MERCHANT_KEY', 'PAYFAST_PASSPHRASE'].some(key => env[key])) {
        if (!['sandbox', 'live'].includes(env.PAYFAST_MODE) || ['PAYFAST_MERCHANT_ID', 'PAYFAST_MERCHANT_KEY', 'PAYFAST_PASSPHRASE'].some(key => !env[key])) throw new Error('Complete the Payfast configuration before enabling payments');
    }
}
