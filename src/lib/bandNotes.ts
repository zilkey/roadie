/**
 * Pure helpers for the per-band notes on festivals, editions, promoters and contacts (src/schema/bandNotes.ts), shared by the server
 * and the pages. Until `npm run migrate:band-notes` has run, the shared record can still carry the band's notes itself (the legacy
 * shape): `noteFieldsOf` reads either, so the code works before and after the migration.
 */
import { BAND_NOTES, type NotedKind } from "@/schema/bandNotes";

export type BandNoteFields = Partial<Record<"notes" | "payNotes" | "howToPitch", string>> & { venueIds?: string[] };

const textFields = (kind: NotedKind): readonly string[] => BAND_NOTES[kind].fields;
const listFields = (kind: NotedKind): readonly string[] => BAND_NOTES[kind].lists;
export const noteFieldNames = (kind: NotedKind): readonly string[] => [...textFields(kind), ...listFields(kind)];
export const isNoteField = (kind: NotedKind, k: string) => noteFieldNames(kind).includes(k);
export const isListField = (kind: NotedKind, k: string) => listFields(kind).includes(k);

/** The note fields of a notes doc, or of a not-yet-migrated shared record. Empty strings and lists count as unset. */
export function noteFieldsOf(kind: NotedKind, d: object | null | undefined): BandNoteFields {
  const x = (d ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of textFields(kind)) if (typeof x[k] === "string" && x[k]) out[k] = x[k];
  for (const k of listFields(kind)) if (Array.isArray(x[k]) && x[k].length) out[k] = x[k];
  return out as BandNoteFields;
}
const isSet = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v);
export const hasNotes = (f: BandNoteFields) => Object.values(f).some(isSet);

/** Split a command's input into the shared record's fields and the band's note fields (undefined values dropped from the notes). */
export function splitNotes(kind: NotedKind, input: Record<string, unknown>) {
  const shared: Record<string, unknown> = {}, notes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!isNoteField(kind, k)) shared[k] = v;
    else if (v !== undefined) notes[k] = v;
  }
  return { shared, notes };
}

/**
 * A shared record with the band's notes laid over it, and any legacy note fields on the record itself taken off. List fields are
 * always there (empty when the band has none), so pages use them as they did before the split.
 */
export function withBandNote<T extends object>(kind: NotedKind, d: T, note: object | null | undefined): T & BandNoteFields {
  const shared = Object.fromEntries(Object.entries(d).filter(([k]) => !isNoteField(kind, k)));
  const lists = Object.fromEntries(listFields(kind).map((k) => [k, []]));
  return { ...shared, ...lists, ...noteFieldsOf(kind, note ?? d) } as T & BandNoteFields;
}

/**
 * A history diff of a shared record that carries a band's note (the before or after of a legacy note field). Such an entry must not be
 * readable by every band's admins, so it is stamped with the band's artistId (db.ts, and the migration).
 */
export function diffHasNoteContent(kind: NotedKind, diff: Record<string, unknown>): boolean {
  return Object.entries(diff).some(([k, d]) => {
    if (!isNoteField(kind, k)) return false;
    const x = d as { before?: unknown; after?: unknown };
    return isSet(x.before) || isSet(x.after);
  });
}
