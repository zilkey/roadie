/**
 * City -> coordinates, via ORS, behind geocodes/{key}. key = sha256 of the lowercased "city, st". Written directly with the admin SDK
 * (a cache, not business data: no history, no rules read, server-only like routeCache). A failed lookup is never an error and never cached.
 */
import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "./admin";
import { orsClient } from "./integrations/ors";
import { cityLabel } from "@/lib/fans";

export interface LatLng { lat: number; lng: number }

const keyOf = (text: string) => createHash("sha256").update(text.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex");

/** Coordinates for free text ("Boise, ID"), or null when ORS is down or knows nothing. Never throws. */
export async function geocodeText(text: string): Promise<LatLng | null> {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  try {
    const ref = firestore().doc(`geocodes/${keyOf(t)}`);
    const snap = await ref.get();
    const c = snap.exists ? (snap.data() as Partial<LatLng>) : undefined;
    if (c && typeof c.lat === "number" && typeof c.lng === "number") return { lat: c.lat, lng: c.lng };
    const hit = await orsClient().geocode(t);
    if (!hit) return null;
    await ref.set({ text: t.toLowerCase(), lat: hit.lat, lng: hit.lng, at: Timestamp.now() });
    return hit;
  } catch (e) {
    console.error("geocode failed", t, e);
    return null;
  }
}

export const geocodeCity = (c: { city: string; state?: string }) => geocodeText(cityLabel(c));
