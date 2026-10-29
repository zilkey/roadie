/**
 * One-way driving miles and minutes between two points: ORS directions (orsClient) behind routeCache/{key}.
 * key = a hash of both coordinates rounded to 3 decimals (never an address); entries older than 30 days are
 * refetched, and so is one cached before the drive time was kept when the time is asked for. Cache docs are written
 * directly with the admin SDK (no history, server-only reads).
 */
import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { orsClient } from "@/server/integrations/ors";

const MONTH_MS = 30 * 86400_000;
const r3 = (n: number) => n.toFixed(3);

export interface Route { oneWayMiles: number; minutes?: number }

export async function route(from: { lat: number; lng: number }, to: { lat: number; lng: number }, opts: { needMinutes?: boolean } = {}): Promise<Route> {
  const key = createHash("sha256").update(`${r3(from.lat)},${r3(from.lng)}|${r3(to.lat)},${r3(to.lng)}`).digest("hex");
  const ref = firestore().doc(`routeCache/${key}`);
  const snap = await ref.get();
  const cached = snap.exists ? (snap.data() as { oneWayMiles: number; minutes?: number; at?: Timestamp }) : undefined;
  const fresh = !!cached?.at && Date.now() - cached.at.toMillis() <= MONTH_MS;
  if (cached && fresh && (!opts.needMinutes || cached.minutes !== undefined)) return { oneWayMiles: cached.oneWayMiles, minutes: cached.minutes };
  try {
    const { oneWayMiles, minutes } = await orsClient().directions(from, to);
    await ref.set({ oneWayMiles, minutes, at: Timestamp.now() });
    return { oneWayMiles, minutes };
  } catch (e) {
    if (cached) return { oneWayMiles: cached.oneWayMiles, minutes: cached.minutes };
    throw e;
  }
}

export async function routeMiles(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<number> {
  return (await route(from, to)).oneWayMiles;
}
