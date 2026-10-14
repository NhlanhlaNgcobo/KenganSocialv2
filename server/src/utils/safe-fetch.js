import dns from 'dns/promises';
import net from 'net';
import axios from 'axios';

/**
 * Fetching user-supplied URLs safely: http(s) only, public addresses only (no loopback,
 * private, link-local or metadata ranges), checked on every redirect, with size and time caps.
 */

const BLOCKED_V4 = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function v4ToInt(ip) {
    return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

export function isPublicAddress(ip) {
    if (net.isIPv4(ip)) {
        const value = v4ToInt(ip);
        return !BLOCKED_V4.some(([base, bits]) => (value & (~0 << (32 - bits)) >>> 0) === (v4ToInt(base) & (~0 << (32 - bits)) >>> 0));
    }
    if (net.isIPv6(ip)) {
        const lower = ip.toLowerCase();
        if (lower === '::1' || lower === '::' || lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return false;
        const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        return mapped ? isPublicAddress(mapped[1]) : true;
    }
    return false;
}

export async function assertPublicUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    } catch {
        throw new Error('That is not a valid web address.');
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https addresses are supported.');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
    if (!addresses.length) throw new Error(`Could not find ${host}.`);
    if (!addresses.every(isPublicAddress)) throw new Error('That address points to a private network and cannot be fetched.');
    return url;
}

/** GET with manual, re-validated redirects. Returns { url, status, headers, data }. */
export async function safeGet(raw, { maxBytes = 5 * 1024 * 1024, timeout = 15000, responseType = 'text', headers = {} } = {}) {
    let current = raw;
    for (let hop = 0; hop < 5; hop += 1) {
        const url = await assertPublicUrl(current);
        const response = await axios.get(url.toString(), {
            responseType: responseType === 'text' ? 'text' : 'arraybuffer',
            timeout,
            maxRedirects: 0,
            maxContentLength: maxBytes,
            validateStatus: () => true,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KenganSocialBot/1.0; +https://kengansocial.com)', ...headers },
        });
        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            current = new URL(response.headers.location, url).toString();
            continue;
        }
        if (response.status >= 400) throw new Error(`The site responded with ${response.status}.`);
        return { url: url.toString(), status: response.status, headers: response.headers, data: response.data };
    }
    throw new Error('Too many redirects.');
}
