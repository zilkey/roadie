import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

/** Emulator hosts are picked up from FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST by the SDK. */
export function adminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const projectId = process.env.GCLOUD_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo-band-tracker";
  return initializeApp({ projectId });
}
export const firestore = () => getFirestore(adminApp());
export const adminAuth = () => getAuth(adminApp());
