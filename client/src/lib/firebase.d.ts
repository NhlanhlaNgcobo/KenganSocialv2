import { FirebaseApp } from 'firebase/app';
import { Auth } from 'firebase/auth';
import { GoogleAuthProvider } from 'firebase/auth';
import { Firestore } from 'firebase/firestore';

export declare const isFirebaseConfigured: boolean;
export declare const auth: Auth | null;
export declare const db: Firestore | null;
export declare const googleProvider: GoogleAuthProvider | null;
declare const app: FirebaseApp | null;
export default app;
