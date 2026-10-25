/**
 * Denormalization hooks. db.ts calls refresh() inside the same transaction when a watched field of a
 * source doc changes, so copies (venue name on show, festivalName on edition, target.name on pitch,
 * song titles in setlists) never drift. Add new copies here.
 */
import type { Doc, Writer } from "./db";
import { joinNames } from "@/lib/shows";
import { refreshDealTotals } from "./dealTotals";

export interface Denormalizer {
  source: string;
  watch: string[];
  refresh(w: Writer, sourceId: string, after: Record<string, unknown>): Promise<void>;
}

const retarget = (kind: "venue" | "promoter" | "edition") => async (w: Writer, id: string, name: string) => {
  const pitches = await w.query("pitches", (q) => q.where("target.id", "==", id));
  for (const p of pitches) {
    if (p.target?.kind === kind && p.target.name !== name) await w.update("pitches", p.id, { target: { ...p.target, name } });
  }
};

export const denormalizers: Denormalizer[] = [
  // Undoing (or redoing) an expense on a show: its deal's totals follow.
  { source: "expenses", watch: ["deletedAt"], refresh: async (w, _id, after) => { if (after.showId) await refreshDealTotals(w, String(after.showId)); } },
  {
    source: "venues", watch: ["name", "address"],
    async refresh(w, id, after) {
      const a = (after.address ?? {}) as { street?: string; city?: string; state?: string };
      const address = [a.street, a.city].filter(Boolean).join(", ");
      const shows = await w.query("shows", (q) => q.where("venue.id", "==", id));
      for (const s of shows) {
        await w.update("shows", s.id, { venue: { ...s.venue, name: after.name, address, city: a.city } });
      }
      await retarget("venue")(w, id, String(after.name));
    },
  },
  { source: "promoters", watch: ["name"], refresh: (w, id, after) => retarget("promoter")(w, id, String(after.name)) },
  {
    source: "festivals", watch: ["name"],
    async refresh(w, id, after) {
      const eds = await w.query("editions", (q) => q.where("festivalId", "==", id));
      for (const e of eds) await w.update("editions", e.id, { festivalName: after.name });
    },
  },
  {
    source: "editions", watch: ["festivalName", "label"],
    async refresh(w, id, after) {
      const name = `${after.festivalName} ${after.label}`;
      await retarget("edition")(w, id, name);
      for (const s of await w.query("shows", (q) => q.where("editionId", "==", id))) {
        if (s.editionName !== name) await w.update("shows", s.id, { editionName: name });
      }
    },
  },
  {
    // House concert hosts: the band reads the names off the show, never the (admin-only) contacts.
    source: "contacts", watch: ["name"],
    async refresh(w, id) {
      for (const s of await w.query("shows", (q) => q.where("hostContactIds", "array-contains", id))) {
        const names: string[] = [];
        for (const cid of s.hostContactIds as string[]) names.push(String((await w.get("contacts", cid))?.name ?? ""));
        const hostName = joinNames(names);
        if (s.hostName !== hostName) await w.update("shows", s.id, { hostName });
      }
    },
  },
  {
    source: "songs", watch: ["title", "lengthSec", "key"],
    async refresh(w, id, after) {
      for (const kind of ["setlists", "setlistTemplates"]) {
        for (const l of await w.query(kind)) {
          const items = (l.items as Doc[]).map((i) =>
            i.songId === id ? { ...i, title: after.title, lengthSec: after.lengthSec, key: after.key } : i);
          await w.update(kind, l.id, { items });
        }
      }
      const rehs = await w.query("rehearsals");
      for (const r of rehs) {
        const songs = (r.songs as Doc[]).map((s) => (s.songId === id ? { ...s, title: after.title } : s));
        await w.update("rehearsals", r.id, { songs });
      }
    },
  },
];
