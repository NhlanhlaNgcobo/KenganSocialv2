import admin from 'firebase-admin';
import { readFileSync } from 'fs';

let db;
let auth;
let storage;

export function initializeFirebaseAdmin() {
    if (admin.apps.length > 0) return;

    let serviceAccount;

    if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
        serviceAccount = JSON.parse(
            readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8')
        );
    } else {
        serviceAccount = {
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        };
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });

    db = admin.firestore();
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
