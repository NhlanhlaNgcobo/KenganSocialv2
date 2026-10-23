import { getFirestore } from '../config/firebase.js';
import type { Firestore } from 'firebase-admin/firestore';

export const db: Firestore = getFirestore();
