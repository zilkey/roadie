import { db, type Doc } from "./db";
import type { SheetPlot } from "@/lib/stagePlots/sheet";

/** Everything the sheet and PDF need besides the plot itself: band name, lineup name and musician names. */
export interface SheetContext { plot: SheetPlot; artist: string; lineupName: string; names: Record<string, string> }

export async function sheetContext(doc: Doc): Promise<SheetContext> {
  const artist = doc.artistId ? await db.get("artists", doc.artistId) : null;
  const lineup = doc.configurationId ? (artist?.configurations ?? []).find((c: { id: string }) => c.id === doc.configurationId) : undefined;
  const ids = new Set<string>();
  for (const r of [...(doc.inputs ?? []), ...(doc.monitors ?? []), ...(doc.items ?? [])]) if (r.musicianId) ids.add(r.musicianId);
  const names: Record<string, string> = {};
  await Promise.all([...ids].map(async (id) => { const m = await db.get("musicians", id); if (m && !m.deletedAt) names[id] = m.name; }));
  return {
    plot: { name: doc.name, version: doc.version, stage: doc.stage, inputs: doc.inputs ?? [], items: doc.items ?? [], monitors: doc.monitors ?? [], ...(doc.bring ? { bring: doc.bring } : {}), ...(doc.need ? { need: doc.need } : {}) },
    artist: artist?.name ?? "", lineupName: lineup?.name ?? "", names,
  };
}
