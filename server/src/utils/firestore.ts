import admin from 'firebase-admin';

// Firestore database instance — shared across all server modules
export const db = admin.firestore();
