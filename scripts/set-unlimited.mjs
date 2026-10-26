#!/usr/bin/env node
/**
 * Internal test accounts: gives every workspace an account owns the Agency plan with no monthly
 * caps (`unlimited: true`, a server-only field; see effectivePlan and planGate.usageLimit).
 * Uses the Firebase project in server/.env.
 *
 *   node scripts/set-unlimited.mjs someone@example.com          # turn on
 *   node scripts/set-unlimited.mjs someone@example.com --off    # turn off
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(root, 'server');
process.chdir(serverDir);
const load = (p) => import(pathToFileURL(path.join(serverDir, p)).href);
await load('node_modules/dotenv/config.js');

const [email, flag] = process.argv.slice(2);
if (!email || !email.includes('@')) {
    console.error('Usage: node scripts/set-unlimited.mjs <email> [--off]');
    process.exit(1);
}
const on = flag !== '--off';

const fb = await load('src/config/firebase.js');
(fb.initializeFirebaseAdmin || fb.default?.initializeFirebaseAdmin)?.();
const { getAuth } = await load('node_modules/firebase-admin/lib/auth/index.js');
const { getFirestore, FieldValue } = await load('node_modules/firebase-admin/lib/firestore/index.js');

const user = await getAuth().getUserByEmail(email).catch(() => null);
if (!user) {
    console.error(`No account with ${email} in project ${process.env.FIREBASE_PROJECT_ID || '(from service account)'}. Sign up first, then run this again.`);
    process.exit(1);
}
const db = getFirestore();
const owned = await db.collection('workspaces').where('ownerId', '==', user.uid).get();
if (owned.empty) {
    console.error(`${email} has no workspace yet. Finish onboarding in the app, then run this again.`);
    process.exit(1);
}
for (const doc of owned.docs) {
    await doc.ref.update(
        on
            ? { unlimited: true, unlimitedNote: `Internal test account (${email})`, unlimitedSince: new Date().toISOString() }
            : { unlimited: FieldValue.delete(), unlimitedNote: FieldValue.delete(), unlimitedSince: FieldValue.delete() }
    );
    console.log(`${on ? 'Unlimited' : 'Back to its normal plan'}: workspace "${doc.data().name || doc.id}" (${doc.id})`);
}
process.exit(0);
