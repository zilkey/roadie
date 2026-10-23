import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === "1";

function app() {
  if (getApps().length) return getApp();
  return initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "demo-key",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "demo-band-tracker.firebaseapp.com",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo-band-tracker",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "demo-app",
  });
}

let _auth: Auth | undefined;
let _db: Firestore | undefined;

export function clientAuth(): Auth {
  if (_auth) return _auth;
  _auth = getAuth(app());
  if (useEmulators) connectAuthEmulator(_auth, `http://127.0.0.1:${process.env.NEXT_PUBLIC_AUTH_EMULATOR_PORT || "9319"}`, { disableWarnings: true });
  return _auth;
}
export function clientDb(): Firestore {
  if (_db) return _db;
  _db = getFirestore(app());
  if (useEmulators) connectFirestoreEmulator(_db, "127.0.0.1", Number(process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT || 8280));
  return _db;
}
export const usingEmulators = useEmulators;
