/**
 * One-way driving miles between two points: ORS directions (orsClient) behind routeCache/{key}.
 * key = a hash of both coordinates rounded to 3 decimals (never an address); entries older than 30 days are
 * refetched. Cache docs are written directly with the admin SDK (no history, server-only reads).
 */
import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { orsClient } from "@/server/integrations/ors";

const MONTH_MS = 30 * 86400_000;
const r3 = (n: number) => n.toFixed(3);

export async function routeMiles(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<number> {
  const key = createHash("sha256").update(`${r3(from.lat)},${r3(from.lng)}|${r3(to.lat)},${r3(to.lng)}`).digest("hex");
  const ref = firestore().doc(`routeCache/${key}`);
  const snap = await ref.get();
  const cached = snap.exists ? (snap.data() as { oneWayMiles: number; at?: Timestamp }) : undefined;
  if (cached?.at && Date.now() - cached.at.toMillis() <= MONTH_MS) return cached.oneWayMiles;
  try {
    const { oneWayMiles } = await orsClient().directions(from, to);
    await ref.set({ oneWayMiles, at: Timestamp.now() });
    return oneWayMiles;
  } catch (e) {
    if (cached) return cached.oneWayMiles;
    throw e;
  }
}
