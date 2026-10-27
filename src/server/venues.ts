/**
 * Venues are two documents (docs/venue-access-proposal.md): the shared `venues/{id}` every band user reads, and each band's private
 * `venueNotes/{artistId}__{venueId}` (load-in notes, notes, contacts, promoters). These helpers read and write the second one, shared
 * by the venue commands, shows.create and the migration.
 *
 * Until `npm run migrate:venue-notes` has run in production, a venue doc may still carry the private fields itself (the legacy shape).
 * Reads fall back to them when the band has no venueNotes doc yet, and the first write of a note starts from them, so the code works
 * both before and after the migration.
 */
import { venueNoteId } from "@/schema";
import { CONTACT_ROLES, ROLE_FIELD, isPrivateField, privateOf, type ContactRole, type NoteFields } from "@/lib/venues";
import { db, type Doc, type Writer } from "./db";
import type { Ctx } from "./ctx";
import { AppError } from "./errors";

export { privateOf, hasPrivate, sharedOf, withNotes, isPrivateField, SHARED_VENUE_FIELDS, type NoteFields } from "@/lib/venues";

// ---------- inside a write unit ----------

/** This band's notes on a venue: its venueNotes doc (maybe archived), else the legacy fields on the venue doc. */
export async function noteOf(w: Writer, venue: Doc, artistId: string): Promise<{ doc: Doc | null; fields: NoteFields }> {
  const doc = await w.get("venueNotes", venueNoteId(artistId, venue.id));
  return { doc, fields: privateOf(doc ?? venue) };
}

/** Apply a patch (null removes a field) to note fields. */
function apply(fields: NoteFields, patch: Record<string, unknown>): NoteFields {
  const out: Record<string, unknown> = { ...fields };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]; else out[k] = v;
  }
  out.contactIds ??= []; out.promoterIds ??= [];
  return privateOf(out); // drops roles of people no longer linked
}

/** Note fields as stored: empty role lists are left off. */
function compact(f: NoteFields) {
  const { bookingContactIds, dayOfContactIds, ...rest } = f;
  return { ...rest, ...(bookingContactIds.length ? { bookingContactIds } : {}), ...(dayOfContactIds.length ? { dayOfContactIds } : {}) };
}

/**
 * Give one linked contact these roles on a venue (linking them first if they aren't). `roles` is the whole set for that person;
 * `add` only ticks more, leaving the roles they have.
 */
export async function setContactRoles(w: Writer, venue: Doc, artistId: string, contactId: string, roles: ContactRole[], mode: "set" | "add" = "set") {
  const { fields } = await noteOf(w, venue, artistId);
  const patch: Record<string, unknown> = {};
  if (!fields.contactIds.includes(contactId)) patch.contactIds = [...fields.contactIds, contactId];
  for (const r of CONTACT_ROLES) {
    const k = ROLE_FIELD[r], has = fields[k].includes(contactId), want = roles.includes(r) || (mode === "add" && has);
    if (want && !has) patch[k] = [...fields[k], contactId];
    if (!want && has) patch[k] = fields[k].filter((x) => x !== contactId);
  }
  if (Object.keys(patch).length) await writeNote(w, venue, artistId, patch);
}

/**
 * Write this band's private fields. The doc is created on the first write (starting from the legacy fields, if the venue still has
 * them) and an archived one is brought back. Returns the fields as they are now.
 */
export async function writeNote(w: Writer, venue: Doc, artistId: string, patch: Record<string, unknown>): Promise<NoteFields> {
  const id = venueNoteId(artistId, venue.id);
  const { doc, fields } = await noteOf(w, venue, artistId);
  const next = apply(fields, patch);
  if (!doc) await w.create("venueNotes", { artistId, venueId: venue.id, ...compact(next) }, { id });
  else {
    if (doc.deletedAt) await w.restore("venueNotes", id);
    await w.update("venueNotes", id, {
      loadInNotes: next.loadInNotes ?? null, notes: next.notes ?? null, contactIds: next.contactIds, promoterIds: next.promoterIds,
      bookingContactIds: next.bookingContactIds.length ? next.bookingContactIds : null, dayOfContactIds: next.dayOfContactIds.length ? next.dayOfContactIds : null,
    });
  }
  return next;
}

/** The band has a (live) notes doc for this venue; an archived one is restored. Used when the band starts caring about the room. */
export async function ensureNote(w: Writer, venue: Doc, artistId: string) {
  const { doc } = await noteOf(w, venue, artistId);
  if (!doc || doc.deletedAt) await writeNote(w, venue, artistId, {});
}

/** Hide the venue from this band's lists: archive (soft-delete) its notes doc, creating an empty one to carry the mark. */
export async function archiveNote(w: Writer, venue: Doc, artistId: string) {
  const id = venueNoteId(artistId, venue.id);
  const { doc, fields } = await noteOf(w, venue, artistId);
  if (!doc) await w.create("venueNotes", { artistId, venueId: venue.id, ...compact(fields) }, { id });
  await w.softDelete("venueNotes", id);
}

/** The artist whose notes this write unit is for: ctx.artistId, else the one artist there is. No artists doc is needed when ctx names one. */
export async function tryArtistId(w: Writer): Promise<string | undefined> {
  if (w.ctx.artistId) return w.ctx.artistId;
  const all = await w.query("artists", (q) => q.limit(2));
  return all.length === 1 ? all[0].id : undefined;
}
export async function artistIdOf(w: Writer): Promise<string> {
  const id = await tryArtistId(w);
  if (!id) throw new AppError("not_found", "Say which artist this is for", 404);
  return id;
}

/** A member (or anyone not allowed private notes) must not send private fields. */
export function refusePrivate(ctx: Ctx, keys: string[]) {
  const bad = keys.filter(isPrivateField);
  if (bad.length && ctx.role === "member") {
    throw new AppError("forbidden", `Only this band's admins can set private venue fields (${bad.join(", ")})`, 403);
  }
}

// ---------- outside a write unit (reads) ----------

/** The artist a call is for: ctx.artistId, else the one artist there is (scripts). */
export async function callerArtistId(ctx: Ctx): Promise<string | undefined> {
  if (ctx.artistId) return ctx.artistId;
  const all = await db.list("artists");
  return all.length === 1 ? all[0].id : undefined;
}

/** The caller's band notes by venue id, archived ones included (`deletedAt` set = the band hid that room). */
export async function notesByVenue(artistId: string | undefined): Promise<Map<string, Doc>> {
  if (!artistId) return new Map();
  const rows = await db.list("venueNotes", (q) => q.where("artistId", "==", artistId), { includeDeleted: true });
  return new Map(rows.map((n) => [n.venueId as string, n]));
}
