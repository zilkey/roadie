/**
 * Per-user driving settings at users/{uid}/private/driving. Written with firebase-admin directly (like userPrefs):
 * personal and private, so no history entry (history would put the home address where admins can read it) and no undo.
 * Rules let only the owner read the doc; this module is how the server reads it for estimates.
 */
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "./admin";
import { DrivingSettings, type FuelGrade, type GeoPoint } from "@/schema";

const ref = (uid: string) => firestore().doc(`users/${uid}/private/driving`);

export async function getDriving(uid: string): Promise<DrivingSettings | null> {
  const snap = await ref(uid).get();
  return snap.exists ? (snap.data() as DrivingSettings) : null;
}

export interface DrivingPatch {
  home?: GeoPoint | null;
  carName?: string | null;
  mpg?: number | null;
  fuelGrade?: FuelGrade;
}

/** Patch the caller's own settings (null clears a field). Returns what is now saved. */
export async function updateDriving(uid: string, patch: DrivingPatch): Promise<DrivingSettings> {
  const cur = (await getDriving(uid)) ?? { fuelGrade: "regular" as const, updatedAt: Timestamp.now() };
  const merged: Record<string, unknown> = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete merged[k]; else merged[k] = v;
  }
  merged.updatedAt = Timestamp.now();
  const next = DrivingSettings.parse(merged);
  await ref(uid).set(next);
  return next;
}
