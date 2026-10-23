import { createHmac, timingSafeEqual } from 'node:crypto';

const PATH = '/api/private-media/';
export function validMediaKey(key) {
    return typeof key === 'string' && key.length < 1500 && !key.includes('\\') && !key.includes('\0') &&
        key.split('/').every(p => p && p !== '.' && p !== '..');
}
export function mediaWorkspace(key) {
    return validMediaKey(key) ? (key.startsWith('workspaces/') ? key.split('/')[1] : key.split('/')[0]) : null;
}
function base() { return (process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, ''); }
export function storedMediaUrl(driver, key, bucket = '') {
    if (!validMediaKey(key)) throw new Error('Invalid media key');
    return `${base()}${PATH}${Buffer.from(JSON.stringify({ driver, key, bucket })).toString('base64url')}`;
}
export function parseMediaUrl(value) {
    try {
        const url = new URL(value);
        if (url.origin !== new URL(base()).origin || !url.pathname.startsWith(PATH)) {
            let driver, bucket = '', key;
            const buckets = [process.env.FIREBASE_STORAGE_BUCKET, `${process.env.FIREBASE_PROJECT_ID}.appspot.com`, `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`].filter(Boolean);
            if (url.origin === new URL(base()).origin && url.pathname.startsWith('/uploads/')) {
                driver = 'local'; key = decodeURIComponent(url.pathname.slice('/uploads/'.length));
            } else if (url.origin === 'https://storage.googleapis.com' && buckets.includes(url.pathname.split('/')[1])) {
                driver = 'firebase'; bucket = url.pathname.split('/')[1]; key = decodeURIComponent(url.pathname.split('/').slice(2).join('/'));
            } else if (process.env.S3_PUBLIC_URL && value.startsWith(process.env.S3_PUBLIC_URL.replace(/\/+$/, '') + '/')) {
                driver = 's3'; bucket = process.env.S3_BUCKET; key = decodeURIComponent(value.slice(process.env.S3_PUBLIC_URL.replace(/\/+$/, '').length + 1).split('?')[0]);
            }
            return driver && validMediaKey(key) ? parseMediaUrl(storedMediaUrl(driver, key, bucket)) : null;
        }
        const id = url.pathname.slice(PATH.length);
        if (!/^[A-Za-z0-9_-]+$/.test(id) || id.length > 3000) return null;
        const ref = JSON.parse(Buffer.from(id, 'base64url').toString());
        return validMediaKey(ref.key) && ['local', 'firebase', 's3'].includes(ref.driver) ? { ...ref, id } : null;
    } catch { return null; }
}
function digest(id, expires) {
    const key = process.env.TOKEN_ENCRYPTION_KEY;
    if (!key || key.length < 32) throw new Error('TOKEN_ENCRYPTION_KEY must be configured for private media');
    return createHmac('sha256', key).update(`media-v1:${id}:${expires}`).digest('hex');
}
export function signMediaUrl(value, ttlSeconds = 3600) {
    const ref = parseMediaUrl(value);
    if (!ref) return value;
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `${base()}${PATH}${ref.id}?expires=${expires}&signature=${digest(ref.id, expires)}`;
}
export function validMediaSignature(id, expires, signature, now = Date.now()) {
    if (!/^\d+$/.test(String(expires)) || Number(expires) <= now / 1000 || !/^[a-f0-9]{64}$/.test(String(signature))) return false;
    try { return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(digest(id, expires), 'hex')); } catch { return false; }
}

/** Sign only objects in the workspace already authorized by the route. */
export function signMediaResponse(req, res, next) {
    const json = res.json.bind(res);
    res.json = body => {
        const workspaceId = req.workspaceId || req.workspace?.id || req.mediaWorkspaceId;
        const visit = value => {
            if (typeof value === 'string') {
                const ref = parseMediaUrl(value);
                if (!ref) return value;
                return workspaceId && mediaWorkspace(ref.key) === workspaceId ? signMediaUrl(value) : null;
            }
            if (Array.isArray(value)) return value.map(visit);
            if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v)]));
            return value;
        };
        return json(visit(body));
    };
    next();
}
