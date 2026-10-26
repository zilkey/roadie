/**
 * A band's private notes on festivals, editions, promoters and contacts (src/schema/bandNotes.ts): `{coll}/{artistId}__{entityId}`.
 * These helpers read and write them for the booking commands, records.get/list, the importer and the migration.
 *
 * Until `npm run migrate:band-notes` has run in production, a shared record may still carry the band's notes itself (the legacy shape).
 * Reads fall back to them when the band has no notes doc yet, and the first write starts from them, like the venue helpers (venues.ts).
 */
import { BAND_NOTES, bandNoteId, type NotedKind } from "@/schema";
import { hasNotes, isListField, noteFieldNames, noteFieldsOf, splitNotes, type BandNoteFields } from "@/lib/bandNotes";
import { db, type Doc, type Writer } from "./db";
import type { Ctx } from "./ctx";
import { AppError } from "./errors";
import { artistIdOf, noteOf, writeNote } from "./venues";

export { hasNotes, noteFieldsOf, splitNotes, withBandNote, type BandNoteFields } from "@/lib/bandNotes";

type Fields = Record<string, string | string[]>;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------- inside a write unit ----------

/** This band's notes on a record: its notes doc (maybe archived), else the legacy fields on the record itself. */
export async function bandNoteOf(w: Writer, kind: NotedKind, entity: Doc, artistId: string): Promise<{ doc: Doc | null; fields: BandNoteFields }> {
  const doc = await w.get(BAND_NOTES[kind].coll, bandNoteId(artistId, entity.id));
  return { doc, fields: noteFieldsOf(kind, doc ?? entity) };
}

/**
 * Apply a patch to this band's notes (null, "" or [] clears a field). The doc is created on the first write that sets something (starting
 * from the legacy fields, if the record still has them); an archived one is brought back. Returns the fields as they are now.
 */
export async function writeBandNote(w: Writer, kind: NotedKind, entity: Doc, artistId: string, patch: Record<string, unknown>): Promise<BandNoteFields> {
  const { coll, key } = BAND_NOTES[kind];
  const id = bandNoteId(artistId, entity.id);
  const { doc, fields } = await bandNoteOf(w, kind, entity, artistId);
  const next: Fields = { ...(fields as Fields) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) delete next[k]; else next[k] = v as string | string[];
  }
  if (!doc) {
    if (hasNotes(next)) await w.create(coll, { artistId, [key]: entity.id, ...next }, { id });
  } else {
    if (doc.deletedAt) await w.restore(coll, id);
    await w.update(coll, id, Object.fromEntries(noteFieldNames(kind).map((k) => [k, next[k] ?? null])));
  }
  return next;
}

/**
 * Fill only what the band has not said yet: a create that merges into an existing record (or an import rerun) never replaces notes.
 * Lists are joined.
 */
export async function fillBandNote(w: Writer, kind: NotedKind, entity: Doc, artistId: string, notes: Record<string, unknown>) {
  const { fields } = await bandNoteOf(w, kind, entity, artistId);
  const have = fields as Fields;
  const add: Fields = {};
  for (const [k, v] of Object.entries(notes)) {
    if (isListField(kind, k) && Array.isArray(v)) {
      const joined = [...new Set([...((have[k] as string[] | undefined) ?? []), ...(v as string[])])];
      if (joined.length !== ((have[k] as string[] | undefined) ?? []).length) add[k] = joined;
    } else if (typeof v === "string" && v && !have[k]) add[k] = v;
  }
  if (Object.keys(add).length) await writeBandNote(w, kind, entity, artistId, add);
}

/** Create a festival, edition, promoter or contact: the shared record in `kind`, and the note fields in the band's notes doc. */
export async function createNoted(w: Writer, kind: NotedKind, input: Record<string, unknown>, opts?: { id?: string }) {
  const { shared, notes } = splitNotes(kind, input);
  const r = await w.create(kind, shared, opts);
  if (hasNotes(noteFieldsOf(kind, notes))) await fillBandNote(w, kind, (await w.get(kind, r.id))!, await artistIdOf(w), notes);
  return r;
}

/**
 * Patch a festival, edition, promoter or contact: shared fields on the record, note fields on the band's notes doc. The autosave form
 * for the notes card sends the notes doc's rev, so conflict checks follow the notes doc when only notes change.
 */
export async function updateNoted(ctx: Ctx, w: Writer, kind: NotedKind, id: string, patch: Record<string, unknown>) {
  const { shared, notes } = splitNotes(kind, patch);
  const entity = await w.get(kind, id);
  if (!entity || entity.deletedAt) throw new AppError("not_found", `${kind}/${id} not found`, 404);
  let changed = false;
  if (Object.keys(shared).length) changed = (await w.update(kind, id, shared)).changed;
  if (Object.keys(notes).length) {
    const artistId = await artistIdOf(w);
    if (ctx.baseRev?.id === id && !Object.keys(shared).length) ctx.baseRev = { id: bandNoteId(artistId, id), rev: ctx.baseRev.rev };
    const before = (await bandNoteOf(w, kind, entity, artistId)).fields as Fields;
    const after = (await writeBandNote(w, kind, entity, artistId, notes)) as Fields;
    changed ||= noteFieldNames(kind).some((k) => !same(before[k], after[k]));
    if (kind === "promoters" && "venueIds" in notes) await syncPromoterVenues(w, artistId, id, (before.venueIds as string[] | undefined) ?? [], (after.venueIds as string[] | undefined) ?? []);
  }
  return { id, changed };
}

/**
 * A band's promoter <-> venue links are kept on both sides: venueNotes.promoterIds and promoterNotes.venueIds. This sets the venue
 * side after a promoter's venueIds changed (venues.update sets the promoter side with `setVenuePromoters`).
 */
async function syncPromoterVenues(w: Writer, artistId: string, promoterId: string, before: string[], after: string[]) {
  for (const venueId of new Set([...before, ...after])) {
    const venue = await w.get("venues", venueId);
    if (!venue || venue.deletedAt) continue;
    const { fields } = await noteOf(w, venue, artistId);
    const want = after.includes(venueId), has = fields.promoterIds.includes(promoterId);
    if (want !== has) await writeNote(w, venue, artistId, { promoterIds: want ? [...fields.promoterIds, promoterId] : fields.promoterIds.filter((x) => x !== promoterId) });
  }
}

/** The promoter side of a venue's promoter links for this band: each promoter's venueIds holds the venue exactly when it is in `promoterIds`. */
export async function setVenuePromoters(w: Writer, artistId: string, venueId: string, promoterIds: string[]) {
  for (const p of await w.query("promoters")) {
    const ids = (await bandNoteOf(w, "promoters", p, artistId)).fields.venueIds ?? [];
    const has = ids.includes(venueId), want = promoterIds.includes(p.id);
    if (has !== want) await writeBandNote(w, "promoters", p, artistId, { venueIds: want ? [...ids, venueId] : ids.filter((x) => x !== venueId) });
  }
}

// ---------- outside a write unit (reads) ----------

/** The caller's band notes of one kind, by the record's id. */
export async function bandNotesBy(kind: NotedKind, artistId: string | undefined): Promise<Map<string, Doc>> {
  if (!artistId) return new Map();
  const { coll, key } = BAND_NOTES[kind];
  const rows = await db.list(coll, (q) => q.where("artistId", "==", artistId));
  return new Map(rows.map((n) => [n[key] as string, n]));
}
