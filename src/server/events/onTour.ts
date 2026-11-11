/**
 * On tour (#79): after a refresh, each upcoming headline show of the acts it touched gets `tourStops`, how many Colorado rooms
 * that act headlines within a few weeks of it (src/lib/venueEvents.ts tourStops), when that is 2 or more. Other venues' shows of
 * the same act are updated too, so whichever room refreshes last leaves them all right. Written directly, like the refresh.
 */
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../admin";
import { db, type Doc } from "../db";
import { isColorado, tourStops } from "@/lib/venueEvents";
import type { Act } from "@/schema";

const BATCH = 400;

export async function markTours(actIds: string[], today: string): Promise<{ marked: number; changed: number }> {
  const states = new Map<string, string | undefined>();
  const stateOf = async (venueId: string) => {
    if (!states.has(venueId)) states.set(venueId, ((await db.get("venues", venueId))?.address as { state?: string } | undefined)?.state);
    return states.get(venueId);
  };
  const want = new Map<string, number>();
  const seen = new Map<string, Doc>();
  for (const actId of new Set(actIds)) {
    const evs = await db.list("venueEvents", (q) => q.where("actIds", "array-contains", actId), { includeDeleted: true });
    const heads = evs.filter((e) => (e.acts as Act[]).some((a) => a.actId === actId && a.role === "headliner"));
    const live: Doc[] = [];
    for (const e of heads) {
      seen.set(e.id, e);
      if (String(e.date) >= today && e.status !== "gone" && e.status !== "cancelled" && isColorado(await stateOf(String(e.venueId)))) live.push(e);
    }
    for (const [id, n] of tourStops(live.map((e) => ({ id: e.id, venueId: String(e.venueId), date: String(e.date) })))) {
      if (n >= 2) want.set(id, Math.max(n, want.get(id) ?? 0));
    }
  }
  const writes = [...seen.values()].filter((e) => (e.tourStops as number | undefined) !== want.get(e.id));
  const fs = firestore();
  for (let i = 0; i < writes.length; i += BATCH) {
    const b = fs.batch();
    for (const e of writes.slice(i, i + BATCH)) b.update(fs.doc(`venueEvents/${e.id}`), { tourStops: want.get(e.id) ?? FieldValue.delete() });
    await b.commit();
  }
  return { marked: want.size, changed: writes.length };
}
