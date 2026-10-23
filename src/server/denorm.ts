/**
 * Denormalization hooks. db.ts calls refresh() inside the same transaction when a watched field of a
 * source doc changes, so copies (venue name on show, festivalName on edition, target.name on pitch,
 * song titles in setlists) never drift. Add new copies here.
 */
import type { Doc, Writer } from "./db";

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
    refresh: (w, id, after) => retarget("edition")(w, id, `${after.festivalName} ${after.label}`),
  },
  {
    source: "songs", watch: ["title", "lengthSec", "key"],
    async refresh(w, id, after) {
      const lists = await w.query("setlists");
      for (const l of lists) {
        const items = (l.items as Doc[]).map((i) =>
          i.songId === id ? { ...i, title: after.title, lengthSec: after.lengthSec, key: after.key } : i);
        await w.update("setlists", l.id, { items });
      }
      const rehs = await w.query("rehearsals");
      for (const r of rehs) {
        const songs = (r.songs as Doc[]).map((s) => (s.songId === id ? { ...s, title: after.title } : s));
        await w.update("rehearsals", r.id, { songs });
      }
    },
  },
];
