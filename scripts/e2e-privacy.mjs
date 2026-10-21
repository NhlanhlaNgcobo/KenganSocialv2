// End-to-end check of the privacy and platform-compliance API against a running server.
// Creates a throwaway Firebase user and workspace, seeds fake social connections, then exercises:
// public legal pages, the YouTube link switch, Meta data deletion + deauthorize callbacks (signed
// with META_APP_SECRET), disconnect clean-up, data export (no tokens) and account deletion.
//
// Run from server/:  META_APP_SECRET=<same as the server> npx tsx ../scripts/e2e-privacy.mjs
// Needs: the API on API_URL (default http://localhost:5000), server/.env Firebase credentials,
// client/.env VITE_FIREBASE_API_KEY. Uses the dev Firebase project; cleans up after itself.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Packages come from server/node_modules (this runs with server/ as the working directory).
const serverRequire = createRequire(path.resolve('package.json'));
serverRequire('dotenv').config();
const admin = serverRequire('firebase-admin');

// Importing the server's Firebase config initialises the Admin SDK with server/.env credentials.
await import(pathToFileURL(path.resolve('src/config/firebase.js')).href);
const tokenModule = await import(pathToFileURL(path.resolve('src/utils/tokenEncryption.ts')).href);
const encrypt = tokenModule.encrypt || tokenModule.default?.encrypt;
const db = admin.firestore();
const API = process.env.API_URL || 'http://localhost:5000';
const SECRET = process.env.META_APP_SECRET;
assert.ok(SECRET, 'Set META_APP_SECRET to the value the server runs with.');
const clientEnv = Object.fromEntries(fs.readFileSync(path.resolve('../client/.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

let failures = 0;
const check = (ok, label) => {
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
const b64 = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const signed = (userId) => {
    const payload = b64(JSON.stringify({ algorithm: 'HMAC-SHA256', issued_at: Math.floor(Date.now() / 1000), user_id: userId }));
    return `${b64(crypto.createHmac('sha256', SECRET).update(payload).digest())}.${payload}`;
};
const form = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

// ── Test user and workspace ─────────────────────────────────────────────────
const email = `probe-privacy-${Date.now()}@example.com`;
const su = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${clientEnv.VITE_FIREBASE_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Probe-pass-12345', returnSecureToken: true }) })).json();
const uid = su.localId;
const auth = { Authorization: `Bearer ${su.idToken}`, 'Content-Type': 'application/json' };
await fetch(`${API}/api/auth/profile`, { method: 'POST', headers: auth, body: JSON.stringify({ displayName: 'Privacy Tester' }) });
await fetch(`${API}/api/auth/onboarding`, { method: 'POST', headers: auth, body: JSON.stringify({ complete: true, fullName: 'Privacy Tester', workspaceName: 'Privacy WS', popiaConsent: true }) });
const ws = (await db.collection('workspaces').where('ownerId', '==', uid).limit(1).get()).docs[0];
assert.ok(ws, 'onboarding created a workspace');
const wsId = ws.id;
const h = { ...auth, 'x-workspace-id': wsId };
const conns = db.collection('workspaces').doc(wsId).collection('connections');
const metaUser = `9${Date.now()}`;
const seedConnection = async (platform, extra = {}) =>
    conns.doc(platform).set({
        platform,
        accessToken: encrypt(`fake-${platform}-access`),
        refreshToken: encrypt(`fake-${platform}-refresh`),
        tokenExpiry: Date.now() + 86400000,
        accountId: `acct-${platform}`,
        accountName: `Test ${platform}`,
        status: 'active',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...extra,
    });

try {
    // ── Public pages and switches ───────────────────────────────────────────
    for (const p of ['/terms', '/privacy', '/data-deletion']) {
        const res = await fetch(`${API}${p}`);
        const html = await res.text();
        check(res.ok && /KenganSocial/.test(html) && html.length > 3000, `API host serves ${p} as static HTML (${html.length} bytes)`);
    }
    const priv = await (await fetch(`${API}/privacy`)).text();
    check(/YouTube API Services/.test(priv) && /security\.google\.com\/settings\/security\/permissions/.test(priv) && /Limited Use/.test(priv), 'static privacy page has the YouTube/Google disclosures');
    const features = await (await fetch(`${API}/api/features`)).json();
    check(features.youtubeLinkImport === false, `YouTube link import is off by default (${JSON.stringify(features)})`);
    const yt = await fetch(`${API}/api/clips/from-url`, { method: 'POST', headers: h, body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', rightsConfirmed: true }) });
    check(yt.status === 403, `YouTube link import refused while off (${yt.status})`);
    const ci = await fetch(`${API}/api/connections/tiktok/creator-info`, { headers: h });
    check(ci.status === 404, `TikTok creator info without a TikTok connection → ${ci.status}`);

    // ── Meta data deletion callback ─────────────────────────────────────────
    await seedConnection('instagram', { metaUserId: metaUser, pageId: 'page-1', pageAccessToken: encrypt('fake-page') });
    await db.collection('meta_user_links').doc(metaUser).set({ links: [`${wsId}/instagram`] });
    await db.collection('workspaces').doc(wsId).collection('dmQueue').add({ senderId: 'x', originalMessage: 'hi', platform: 'instagram' });
    await db.collection('workspaces').doc(wsId).collection('leads').add({ username: 'lead1', source: 'instagram_dm' });
    await db.collection('workspaces').doc(wsId).collection('leads').add({ username: 'manual', source: 'manual' });
    const bad = await fetch(`${API}/api/privacy/meta/data-deletion`, form({ signed_request: `${b64('forged-signature-forged-signature')}.${b64('{"algorithm":"HMAC-SHA256","user_id":"1"}')}` }));
    check(bad.status === 400, `forged signed_request rejected (${bad.status})`);
    const del = await fetch(`${API}/api/privacy/meta/data-deletion`, form({ signed_request: signed(metaUser) }));
    const delBody = await del.json();
    check(del.ok && typeof delBody.url === 'string' && /\/data-deletion\/status\?code=/.test(delBody.url) && /^[\w-]+$/.test(delBody.confirmation_code), `data deletion callback answers Meta's format: ${JSON.stringify(delBody)}`);
    check(!(await conns.doc('instagram').get()).exists, 'Instagram connection deleted');
    const dmLeft = (await db.collection('workspaces').doc(wsId).collection('dmQueue').get()).size;
    const leads = (await db.collection('workspaces').doc(wsId).collection('leads').get()).docs.map((d) => d.data().source);
    check(dmLeft === 0 && leads.length === 1 && leads[0] === 'manual', `DMs and Instagram leads deleted, manual lead kept (dm ${dmLeft}, leads ${JSON.stringify(leads)})`);
    const status = await (await fetch(`${API}/api/privacy/deletion-status/${delBody.confirmation_code}`)).json();
    check(status.status === 'completed' && status.kind === 'meta-callback', `deletion status page: ${JSON.stringify(status)}`);
    const unknown = await fetch(`${API}/api/privacy/deletion-status/doesnotexist123`);
    check(unknown.status === 404, `unknown confirmation code → ${unknown.status}`);

    // ── Meta deauthorize callback ───────────────────────────────────────────
    await seedConnection('facebook', { metaUserId: metaUser, pageId: 'page-2' });
    await db.collection('meta_user_links').doc(metaUser).set({ links: [`${wsId}/facebook`] });
    const deauth = await fetch(`${API}/api/privacy/meta/deauthorize`, form({ signed_request: signed(metaUser) }));
    const fb = (await conns.doc('facebook').get()).data();
    check(deauth.ok && fb?.status === 'revoked' && !fb.accessToken && !fb.refreshToken, `deauthorize marks the connection revoked and drops tokens (status ${fb?.status})`);

    // ── Disconnect: clean-up of the platform's stored data ──────────────────
    await seedConnection('tiktok');
    const snapRef = db.collection('analytics').doc(wsId).collection('snapshots').doc('2026-10-01');
    await snapRef.set({ date: '2026-10-01', platforms: { tiktok: { status: 'ok', views: 5 }, youtube: { status: 'ok', views: 9 } }, createdAt: new Date() });
    const disc = await fetch(`${API}/api/connections/tiktok`, { method: 'DELETE', headers: h });
    const discBody = await disc.json();
    const snap = (await snapRef.get()).data();
    check(disc.ok && !(await conns.doc('tiktok').get()).exists && !snap.platforms.tiktok && snap.platforms.youtube, `disconnect deletes the connection and its analytics only (${JSON.stringify(discBody)})`);

    // ── Export ──────────────────────────────────────────────────────────────
    await seedConnection('youtube');
    const exp = await fetch(`${API}/api/privacy/export`, { headers: { Authorization: auth.Authorization } });
    const expText = await exp.text();
    const exported = JSON.parse(expText);
    check(exp.ok && /attachment/.test(exp.headers.get('content-disposition') || ''), 'export downloads as an attachment');
    check(exported.workspacesOwned?.[0]?.id === wsId && exported.workspacesOwned[0].connections?.some((c) => c.id === 'youtube'), 'export includes the workspace and its connections');
    check(!/accessToken|refreshToken|pageAccessToken|fake-youtube/.test(expText), 'export contains no access tokens');

    // ── Account deletion ────────────────────────────────────────────────────
    const noConfirm = await fetch(`${API}/api/privacy/account`, { method: 'DELETE', headers: auth, body: JSON.stringify({}) });
    check(noConfirm.status === 400, `account deletion needs the typed confirmation (${noConfirm.status})`);
    const gone = await fetch(`${API}/api/privacy/account`, { method: 'DELETE', headers: auth, body: JSON.stringify({ confirm: 'DELETE' }) });
    const goneBody = await gone.json();
    check(gone.ok && goneBody.confirmationCode, `account deleted: ${JSON.stringify(goneBody)}`);
    check(!(await db.collection('workspaces').doc(wsId).get()).exists && (await db.collection('workspaces').doc(wsId).collection('connections').get()).empty, 'workspace and its subcollections deleted');
    check(!(await db.collection('users').doc(uid).get()).exists && (await db.collection('analytics').doc(wsId).collection('snapshots').get()).empty, 'user record and analytics deleted');
    const userGone = await admin.auth().getUser(uid).then(() => false).catch((e) => e.code === 'auth/user-not-found');
    check(userGone, 'Firebase sign-in deleted');
    const st = await (await fetch(`${API}/api/privacy/deletion-status/${goneBody.confirmationCode}`)).json();
    check(st.status === 'completed' && st.kind === 'account', `account deletion confirmation code resolves (${st.status})`);
} finally {
    await db.collection('meta_user_links').doc(metaUser).delete().catch(() => {});
    await db.recursiveDelete(db.collection('workspaces').doc(wsId)).catch(() => {});
    await db.recursiveDelete(db.collection('analytics').doc(wsId)).catch(() => {});
    await db.recursiveDelete(db.collection('users').doc(uid)).catch(() => {});
    await admin.auth().deleteUser(uid).catch(() => {});
}
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
