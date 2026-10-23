import { createHash, timingSafeEqual } from 'node:crypto';
import axios from 'axios';
import { lookup } from 'node:dns/promises';

export function payfastConfig() {
    const mode = process.env.PAYFAST_MODE;
    const merchantId = process.env.PAYFAST_MERCHANT_ID || '';
    const merchantKey = process.env.PAYFAST_MERCHANT_KEY || '';
    const passphrase = process.env.PAYFAST_PASSPHRASE || '';
    return { merchantId, merchantKey, passphrase, mode,
        configured: Boolean(['sandbox', 'live'].includes(mode || '') && merchantId && merchantKey && passphrase),
        base: mode === 'live' ? 'https://www.payfast.co.za' : 'https://sandbox.payfast.co.za' };
}

// PHP urlencode (RFC 1738), as required by Payfast signatures.
export const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*~]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, '+');
export function parameterString(data: Record<string, string>, trim = false) {
    return Object.entries(data).filter(([key]) => key !== 'signature')
        .map(([key, value]) => `${key}=${encode(trim ? value.trim() : value)}`).join('&');
}
export function signature(data: Record<string, string>, passphrase: string, trim = false) {
    return createHash('md5').update(`${parameterString(data, trim)}&passphrase=${encode(passphrase.trim())}`).digest('hex');
}
export function validSignature(data: Record<string, string>, passphrase: string) {
    return /^[a-f0-9]{32}$/i.test(data.signature || '') && timingSafeEqual(Buffer.from(data.signature, 'hex'), Buffer.from(signature(data, passphrase), 'hex'));
}
export function cents(amount: string) {
    if (!/^\d+\.\d{2}$/.test(amount)) throw new Error('Invalid payment amount');
    const [whole, fraction] = amount.split('.');
    const result = Number(whole) * 100 + Number(fraction);
    if (!Number.isSafeInteger(result)) throw new Error('Invalid payment amount');
    return result;
}

/** An authenticated server-to-server confirmation is required in addition to the signature. */
export async function validateNotification(data: Record<string, string>) {
    const config = payfastConfig();
    if (!config.configured || data.merchant_id !== config.merchantId || !validSignature(data, config.passphrase)) return false;
    const response = await axios.post(`${config.base}/eng/query/validate`, parameterString(data), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000, maxRedirects: 0,
    });
    return String(response.data).trim() === 'VALID';
}

let senderCache: { expires: number; ips: Set<string> } | undefined;
export async function validPayfastSender(ip: string) {
    if (!senderCache || senderCache.expires < Date.now()) {
        const hosts = ['www.payfast.co.za', 'sandbox.payfast.co.za', 'w1w.payfast.co.za', 'w2w.payfast.co.za'];
        const results = await Promise.allSettled(hosts.map(host => lookup(host, { all: true })));
        const ips = new Set(results.flatMap(result => result.status === 'fulfilled' ? result.value.map(item => item.address) : []));
        if (!ips.size) throw new Error('Could not verify Payfast sender');
        senderCache = { ips, expires: Date.now() + 300000 };
    }
    return senderCache.ips.has(ip.replace(/^::ffff:/, ''));
}

export async function subscriptionRequest(token: string, action: 'fetch' | 'cancel') {
    if (!/^[a-f0-9-]{36}$/i.test(token)) throw new Error('Invalid subscription token');
    const config = payfastConfig();
    if (!config.configured) throw new Error('Payfast is not configured');
    const headers: Record<string, string> = { 'merchant-id': config.merchantId, version: 'v1', timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, '+0000') };
    const values = { ...headers, passphrase: config.passphrase };
    const sorted = Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
    headers.signature = createHash('md5').update(parameterString(sorted)).digest('hex');
    const response = await axios.request({ method: action === 'fetch' ? 'GET' : 'PUT',
        url: `https://api.payfast.co.za/subscriptions/${encodeURIComponent(token)}/${action}`,
        params: config.mode === 'sandbox' ? { testing: 'true' } : undefined, headers, timeout: 15000, maxRedirects: 0 });
    if (response.data?.status !== 'success') throw new Error('Payfast did not confirm the subscription request');
    return response.data?.data?.response;
}
