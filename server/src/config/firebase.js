import 'dotenv/config';
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

let db;
let auth;
let storage;

initializeFirebaseAdmin();

export function initializeFirebaseAdmin() {
    if (admin.apps.length > 0) return;

    let credential;

    if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
        credential = admin.credential.cert(JSON.parse(
            readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8')
        ));
    } else if (process.env.FIREBASE_PRIVATE_KEY) {
        credential = admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        });
    } else {
        // No key configured: fall back to Application Default Credentials
        // (e.g. `gcloud auth application-default login` for local dev).
        credential = admin.credential.applicationDefault();
    }

    admin.initializeApp({
        credential,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });

    db = admin.firestore();
    // Drop undefined fields instead of failing the whole write (optional values such as an
    // auto-frame summary field are often undefined). Must run before the first Firestore call.
    try {
        db.settings({ ignoreUndefinedProperties: true });
    } catch (error) {
        console.warn('[Firebase] Could not set ignoreUndefinedProperties:', error.message);
    }
    auth = admin.auth();
    storage = admin.storage();

    console.log('✅ Firebase Admin initialized');
}

export function getFirestore() {
    return db || admin.firestore();
}

export function getAuth() {
    return auth || admin.auth();
}

export function getStorage() {
    return storage || admin.storage();
}

export default admin;
