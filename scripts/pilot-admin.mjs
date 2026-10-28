#!/usr/bin/env node
/**
 * Private pilot admin from the command line (Firebase project in server/.env).
 *
 *   npx tsx scripts/pilot-admin.mjs grant <email>         # make an account a pilot admin (custom claim)
 *   npx tsx scripts/pilot-admin.mjs ungrant <email>
 *   npx tsx scripts/pilot-admin.mjs invite [note] [--email someone@example.com]   # prints a one-time code
 *   npx tsx scripts/pilot-admin.mjs add-member <email>    # seat an existing account without a code (e.g. you)
 *   npx tsx scripts/pilot-admin.mjs revoke-member <email>
 *   npx tsx scripts/pilot-admin.mjs status
 *
 * Admins can do the same from the app at /dashboard/pilot-admin once granted (sign out and in again so the
 * new claim reaches the browser).
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(root, 'server');
process.chdir(serverDir);
const load = (p) => import(pathToFileURL(path.join(serverDir, p)).href);
await load('node_modules/dotenv/config.js');

const [cmd, ...rest] = process.argv.slice(2);
const usage = () => {
    console.error('Usage: npx tsx scripts/pilot-admin.mjs grant|ungrant|invite|add-member|revoke-member|status ...');
    process.exit(1);
};
if (!cmd) usage();

const fb = await load('src/config/firebase.js');
(fb.initializeFirebaseAdmin || fb.default?.initializeFirebaseAdmin)?.();
const { getAuth } = await load('node_modules/firebase-admin/lib/auth/index.js');
const { getFirestore } = await load('node_modules/firebase-admin/lib/firestore/index.js');
const invites = await load('src/services/pilot-invites.ts');
const db = getFirestore();

const userByEmail = async (email) => {
    const user = email?.includes('@') ? await getAuth().getUserByEmail(email).catch(() => null) : null;
    if (!user) {
        console.error(`No account with ${email || '(no email)'}. Sign up in the app first.`);
        process.exit(1);
    }
    return user;
};

if (cmd === 'grant' || cmd === 'ungrant') {
    const user = await userByEmail(rest[0]);
    const claims = { ...(user.customClaims || {}) };
    if (cmd === 'grant') claims.pilotAdmin = true;
    else delete claims.pilotAdmin;
    await getAuth().setCustomUserClaims(user.uid, claims);
    console.log(`${rest[0]}: pilot admin ${cmd === 'grant' ? 'on' : 'off'}. Sign out and in again for it to apply.`);
} else if (cmd === 'invite') {
    const i = rest.indexOf('--email');
    const email = i >= 0 ? rest[i + 1] : '';
    const note = rest.filter((_, j) => j !== i && j !== i + 1).join(' ');
    const invite = await invites.createInvite(db, { createdBy: 'cli', note, email });
    console.log(`Invite code (shown once): ${invite.code}\nExpires: ${invite.expiresAt}${email ? `\nOnly for: ${email}` : ''}`);
} else if (cmd === 'add-member') {
    const user = await userByEmail(rest[0]);
    const invite = await invites.createInvite(db, { createdBy: 'cli', note: `direct add ${rest[0]}`, email: rest[0] });
    const result = await invites.redeemInvite(db, { uid: user.uid, email: user.email, code: invite.code });
    console.log(result.alreadyMember ? `${rest[0]} is already a member.` : `${rest[0]} added.`);
    if (result.alreadyMember) await invites.revokeInvite(db, invite.id);
} else if (cmd === 'revoke-member') {
    const user = await userByEmail(rest[0]);
    const result = await invites.revokeMember(db, user.uid);
    await getAuth().revokeRefreshTokens(user.uid);
    console.log(result.revoked ? `${rest[0]} revoked; their data is kept.` : `${rest[0]} was already revoked.`);
} else if (cmd === 'status') {
    const state = await db.doc('pilot/state').get();
    const members = await db.collection('pilot_members').get();
    console.log(`PILOT_MODE=${process.env.PILOT_MODE || '(unset)'} seats used: ${(state.exists && state.data().members) || 0} / ${process.env.PILOT_MAX_USERS || 10}`);
    for (const d of members.docs) console.log(` ${d.data().revokedAt ? 'revoked' : 'active '} ${d.data().email} joined ${d.data().joinedAt}`);
} else usage();
process.exit(0);
