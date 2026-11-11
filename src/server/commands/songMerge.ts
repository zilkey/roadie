import { z } from "zod";
import { defineCommand } from "./types";
import { run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import { liveTracks, renumber, tracksPath } from "./releases";

/** Two notes joined, nothing doubled. */
const joinText = (a: string | undefined, b: string | undefined, sep: string) => (!a ? b : !b || a.includes(b) ? a : `${a}${sep}${b}`);
const blank = (v: unknown) => v === undefined || v === null || v === "";
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The values a merged song ends up with: the kept song's own, a blank one filled from the others in the order given. Notes are joined; custom fields union with the kept song's value winning. */
export function mergedFields(keep: Doc, others: Doc[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ["title", "shortTitle", "writers", "key", "bpm", "lengthSec", "lyricsDoc"]) {
    if (!blank(keep[k])) continue;
    const from = others.find((o) => !blank(o[k]));
    if (from) out[k] = from[k];
  }
  const notes = others.reduce<string | undefined>((acc, o) => joinText(acc, o.notes as string | undefined, "\n\n"), keep.notes as string | undefined);
  if (notes !== keep.notes) out.notes = notes;
  const fields = [...((keep.fields ?? []) as { fieldId: string; value: string }[])];
  for (const o of others) for (const f of (o.fields ?? []) as { fieldId: string; value: string }[]) if (f.value && !fields.some((x) => x.fieldId === f.fieldId && x.value)) fields.push(f);
  const kept = new Map<string, { fieldId: string; value: string }>();
  for (const f of fields) if (f.value && !kept.has(f.fieldId)) kept.set(f.fieldId, f);
  const next = [...kept.values()];
  if (!sameJson(next, keep.fields ?? [])) out.fields = next;
  return out;
}

type Item = { type: string; songId?: string; title?: string; lengthSec?: number; key?: string; alts?: { songId: string; title: string; key?: string }[] } & Record<string, unknown>;

/** A list's items with every merged song pointing at the kept one (title, length and key as the denormalizer copies them). Alternates that become their own song, or repeat, are dropped. */
export function repointItems(items: Item[], gone: Set<string>, keep: { id: string; title: unknown; lengthSec?: unknown; key?: unknown }): Item[] {
  const alt = (a: { songId: string; title: string; key?: string }) => (a.songId === keep.id || gone.has(a.songId) ? { songId: keep.id, title: keep.title as string, ...(keep.key ? { key: keep.key as string } : {}) } : a);
  return items.map((i) => {
    let next: Item = i;
    if (i.songId && gone.has(i.songId)) {
      const { lengthSec: _l, key: _k, ...rest } = i;
      next = { ...rest, songId: keep.id, title: keep.title as string, ...(keep.lengthSec != null ? { lengthSec: keep.lengthSec as number } : {}), ...(keep.key ? { key: keep.key as string } : {}) };
    }
    if (Array.isArray(next.alts)) {
      const seen = new Set<string>();
      const alts = next.alts.map(alt).filter((a) => {
        if (a.songId === next.songId || seen.has(a.songId)) return false;
        seen.add(a.songId);
        return true;
      });
      const { alts: _a, ...rest } = next;
      next = alts.length ? { ...rest, alts } : rest;
    }
    return next;
  });
}

export const songsMerge = defineCommand({
  name: "songs.merge",
  roles: ["admin", "mcp"],
  description:
    "Fold duplicate songs into one (keepId), for example The Bliss once as Playing and once as Learning. Everything on mergeIds moves to the kept song: files (the same Drive file or link twice stays once), " +
    "song items and alternates on setlists and setlist templates (a set that has both plays the song twice), rehearsal songs (one entry, notes joined), release tracks (the earlier track stays) and the lyrics doc (the kept song's, else the first one found). " +
    "The kept song keeps its title, key, BPM, length, writers and status; a blank one is filled from the others, notes are joined and custom fields combined (the kept song's value wins). " +
    "The other songs are archived with a pointer to the kept one (their page redirects). One run: history.undoRun reverses all of it.",
  input: z.strictObject({ keepId: z.string().min(1), mergeIds: z.array(z.string().min(1)).min(1) }),
  run: (ctx, { keepId, mergeIds }) => run(ctx, async (w) => {
    const ids = [...new Set(mergeIds)];
    if (ids.includes(keepId)) throw new AppError("invalid_input", "The song to keep can't also be merged into itself", 400);
    const load = async (id: string): Promise<Doc> => {
      const s = await w.get("songs", id);
      if (!s || s.deletedAt) throw new AppError("not_found", `Song ${id} not found`, 404);
      return s;
    };
    const keep = await load(keepId);
    const others: Doc[] = [];
    for (const id of ids) others.push(await load(id));
    const gone = new Set(ids);
    const all = new Set([keepId, ...ids]);
    const filled = mergedFields(keep, others);
    const final = { id: keepId, title: filled.title ?? keep.title, lengthSec: filled.lengthSec ?? keep.lengthSec, key: filled.key ?? keep.key };
    const moved = { files: 0, filesDropped: 0, setlists: 0, rehearsals: 0, releases: 0, tracksDropped: 0, lyrics: false };

    // Files (takes included): songId moves; the same Drive file or link on the kept song twice stays once.
    const idOf = (f: Doc) => `${f.driveFileId ? `d:${f.driveFileId}` : `u:${f.url}`}|${f.rehearsalId ?? ""}`;
    const have = new Set((await w.query("files", (q) => q.where("songId", "==", keepId))).map(idOf));
    for (const id of ids) {
      for (const f of await w.query("files", (q) => q.where("songId", "==", id))) {
        if (have.has(idOf(f))) { await w.softDelete("files", f.id); moved.filesDropped++; continue; }
        have.add(idOf(f));
        await w.update("files", f.id, { songId: keepId });
        moved.files++;
      }
    }

    // Setlists and templates.
    for (const coll of ["setlists", "setlistTemplates"]) {
      for (const l of await w.query(coll)) {
        const items = l.items as Item[];
        const next = repointItems(items, gone, final);
        if (sameJson(items, next)) continue;
        await w.update(coll, l.id, { items: next });
        moved.setlists++;
      }
    }

    // Rehearsals: one entry per song, notes joined.
    for (const r of await w.query("rehearsals")) {
      const songs = r.songs as { songId: string; title: string; note?: string }[];
      if (!songs.some((s) => gone.has(s.songId))) continue;
      const next: typeof songs = [];
      for (const s of songs) {
        const e = gone.has(s.songId) ? { ...s, songId: keepId, title: final.title as string } : s;
        const at = e.songId === keepId ? next.findIndex((x) => x.songId === keepId) : -1;
        if (at < 0) { next.push(e); continue; }
        const note = joinText(next[at].note, e.note, "; ");
        next[at] = { songId: keepId, title: final.title as string, ...(note ? { note } : {}) };
      }
      await w.update("rehearsals", r.id, { songs: next });
      moved.rehearsals++;
    }

    // Release tracks: the earlier track stays when a release has the song twice, positions stay dense.
    for (const rel of await w.query("releases")) {
      const tracks = await liveTracks(w, rel.id);
      const mine = tracks.filter((t) => all.has(t.songId));
      if (!mine.some((t) => gone.has(t.songId))) continue;
      const [stay, ...drop] = mine;
      for (const t of mine) if (gone.has(t.songId) && t.id === stay.id) await w.update(tracksPath(rel.id), t.id, { songId: keepId });
      for (const t of drop) {
        // Its release-only files (mixes, stems...) go to the track that stays rather than with the removed one.
        for (const f of await w.query("files", (q) => q.where("releaseTrackId", "==", t.id))) await w.update("files", f.id, { releaseTrackId: stay.id });
        await w.softDelete(tracksPath(rel.id), t.id);
        moved.tracksDropped++;
      }
      if (drop.length) await renumber(w, rel.id, tracks.filter((t) => !drop.some((d) => d.id === t.id)));
      moved.releases++;
    }

    // The kept song: blanks filled, the lyrics doc found, a note of what was folded in.
    const patch: Record<string, unknown> = { ...filled };
    moved.lyrics = !!filled.lyricsDoc;
    patch.mergedFrom = [...((keep.mergedFrom ?? []) as unknown[]), ...others.map((o) => ({ id: o.id, title: o.title, status: o.status }))];
    await w.update("songs", keepId, patch);
    for (const o of others) {
      await w.update("songs", o.id, { mergedInto: keepId });
      await w.softDelete("songs", o.id);
    }
    return { id: keepId, merged: ids, moved };
  }),
});

export type { Writer };
