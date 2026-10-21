// Run from the repository root: node scripts/check-legal.mjs
// The legal pages contain what Meta, TikTok, Google/YouTube and POPIA require (see
// docs/API_APPLICATIONS.md), the static HTML copies are up to date, and the Meta signed_request
// parser accepts Meta's format and rejects forgeries. Lists company details still missing.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLICIES } from '../client/src/legal/legal-content.js';
import { COMPANY } from '../client/src/legal/company.js';
import { renderPolicy } from './build-legal.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = (key) => JSON.stringify(POLICIES[key]);

const REQUIRED = {
    terms: [
        ['YouTube ToS link-and-bind clause', /agree to be bound by the \[YouTube Terms of Service\]\(https:\/\/www\.youtube\.com\/t\/terms\)/],
        ['consent to act on the user’s behalf only as instructed', /only to do what you ask in the Service/],
        ['no affiliation with Meta, TikTok, Google', /not affiliated with, endorsed or sponsored by.*Meta.*TikTok.*Google/],
        ['TikTok Music Usage Confirmation', /Music Usage Confirmation/],
        ['TikTok Branded Content Policy', /Branded Content Policy/],
        ['Meta terms', /Meta Terms of Service/],
        ['POPIA s69 direct marketing duties', /section 69/],
        ['operator terms for clients’ personal information', /act as your operator/],
        ['in-app account deletion', /Delete account/],
        ['support contact', /info@kengansocial\.com/],
    ],
    privacy: [
        ['uses YouTube API Services', /YouTube API Services/],
        ['link to Google Privacy Policy', /policies\.google\.com\/privacy/],
        ['link to YouTube ToS', /youtube\.com\/t\/terms/],
        ['Google revoke page', /security\.google\.com\/settings\/security\/permissions/],
        ['Google Limited Use statement', /Google API Services User Data Policy.*Limited Use/],
        ['YouTube 30-day refresh-or-delete', /refreshed or deleted at least every 30 days/],
        ['delete within 7 days of disconnect', /within 7 days/],
        ['Meta deletion instructions', /Business integrations/],
        ['Instagram DM visibility to Page moderators', /visible to people who manage your linked Facebook Page/],
        ['TikTok data and revocation', /Manage app permissions/],
        ['data per platform', /Facebook \(Page\).*Instagram.*TikTok.*YouTube/],
        ['no selling of data', /never sell personal information/],
        ['POPIA rights', /access, correct or delete/],
        ['Information Regulator contact', /POPIAComplaints@inforegulator\.org\.za/],
        ['cross-border transfers (s72)', /section 72/],
        ['security compromise notification (s22)', /section 22/],
        ['retention periods', /How long we keep it/],
        ['automated processing', /automated processing/],
        ['PAIA manual', /PAIA manual/],
        ['children', /18 and over/],
        ['Information Officer', /Information Officer/],
    ],
    'data-deletion': [
        ['in-app account deletion steps', /Delete account/],
        ['per-platform disconnect', /Disconnect/],
        ['Meta removal triggers deletion', /Meta notifies us/],
        ['email route', /Delete my data/],
    ],
};

let failures = 0;
for (const [key, rules] of Object.entries(REQUIRED)) {
    for (const [label, re] of rules) {
        const ok = re.test(text(key));
        if (!ok) failures += 1;
        console.log(`${ok ? 'PASS' : 'FAIL'} ${POLICIES[key].title}: ${label}`);
    }
}

// Static copies match the content.
for (const dir of ['client/public/legal', 'server/public/legal']) {
    for (const [key, file] of [['terms', 'terms.html'], ['privacy', 'privacy.html'], ['data-deletion', 'data-deletion.html']]) {
        const p = path.join(root, dir, file);
        // Git checkouts on Windows may use CRLF line endings.
        const ok = fs.existsSync(p) && fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') === renderPolicy(key);
        if (!ok) failures += 1;
        console.log(`${ok ? 'PASS' : 'FAIL'} ${dir}/${file} is up to date${ok ? '' : ' (run node scripts/build-legal.mjs)'}`);
    }
}

// Meta signed_request: Meta's format verifies, forged or malformed ones do not.
const { parseSignedRequest } = await import('../server/src/utils/signedRequest.ts').catch(() => ({}));
if (parseSignedRequest) {
    const secret = 'test-app-secret';
    const b64 = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const payload = b64(JSON.stringify({ algorithm: 'HMAC-SHA256', issued_at: 1700000000, user_id: '1234567890' }));
    const sig = b64(crypto.createHmac('sha256', secret).update(payload).digest());
    assert.equal(parseSignedRequest(`${sig}.${payload}`, secret)?.user_id, '1234567890');
    assert.equal(parseSignedRequest(`${sig}.${payload}`, 'wrong-secret'), null);
    assert.equal(parseSignedRequest(`${b64('x'.repeat(32))}.${payload}`, secret), null);
    assert.equal(parseSignedRequest('garbage', secret), null);
    const other = b64(JSON.stringify({ algorithm: 'HMAC-SHA1', user_id: '1' }));
    assert.equal(parseSignedRequest(`${b64(crypto.createHmac('sha256', secret).update(other).digest())}.${other}`, secret), null);
    console.log('PASS Meta signed_request: valid accepted; wrong secret, forged signature, garbage and wrong algorithm rejected');
} else console.log('SKIP Meta signed_request test (run with: npx tsx scripts/check-legal.mjs)');

const missing = ['registrationNumber', 'address', 'phone', 'informationOfficer', 'paiaManualUrl'].filter((k) => !COMPANY[k]);
if (missing.length) console.log(`TODO company details still missing in client/src/legal/company.js: ${missing.join(', ')} (needed before applying for API access)`);
console.log(failures ? `${failures} legal check(s) FAILED` : 'Legal checks passed.');
process.exit(failures ? 1 : 0);
