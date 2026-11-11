/**
 * Pure helpers for the per-band notes on festivals, editions, promoters and contacts (src/schema/bandNotes.ts), shared by the server
 * and the pages.
 */
import { BAND_NOTES, type NotedKind } from "@/schema/bandNotes";

export type BandNoteFields = Partial<Record<"notes" | "payNotes" | "howToPitch" | "note" | "relationship", string>> & { venueIds?: string[]; contactIds?: string[]; shortlist?: boolean };

const textFields = (kind: NotedKind): readonly string[] => BAND_NOTES[kind].fields;
const listFields = (kind: NotedKind): readonly string[] => BAND_NOTES[kind].lists;
const flagFields = (kind: NotedKind): readonly string[] => BAND_NOTES[kind].flags;
export const noteFieldNames = (kind: NotedKind): readonly string[] => [...textFields(kind), ...listFields(kind), ...flagFields(kind)];
export const isNoteField = (kind: NotedKind, k: string) => noteFieldNames(kind).includes(k);
export const isListField = (kind: NotedKind, k: string) => listFields(kind).includes(k);
export const isFlagField = (kind: NotedKind, k: string) => flagFields(kind).includes(k);

/** The note fields of a notes doc (or of a command's input). Empty strings and lists, and false flags, count as unset. */
export function noteFieldsOf(kind: NotedKind, d: object | null | undefined): BandNoteFields {
  const x = (d ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of textFields(kind)) if (typeof x[k] === "string" && x[k]) out[k] = x[k];
  for (const k of listFields(kind)) if (Array.isArray(x[k]) && x[k].length) out[k] = x[k];
  for (const k of flagFields(kind)) if (x[k] === true) out[k] = true;
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

/** A shared record with the band's notes laid over it. List fields are always there (empty when the band has none). */
export function withBandNote<T extends object>(kind: NotedKind, d: T, note: object | null | undefined): T & BandNoteFields {
  const lists = Object.fromEntries(listFields(kind).map((k) => [k, []]));
  return { ...d, ...lists, ...noteFieldsOf(kind, note) } as T & BandNoteFields;
}
