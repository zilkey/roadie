/**
 * Pure helpers for the two-document venue (docs/venue-access-proposal.md), shared by the server and the pages:
 * the shared `venues/{id}` and one band's private `venueNotes/{artistId}__{venueId}`.
 * Until `npm run migrate:venue-notes` has run, a venue doc can still carry the private fields itself (the legacy shape): `privateOf` reads either.
 */
import { VENUE_PRIVATE_FIELDS } from "@/schema/venues";

export interface NoteFields { loadInNotes?: string; notes?: string; contactIds: string[]; promoterIds: string[] }

/** The fields of the shared venue record (what `venues` keeps after the split). */
export const SHARED_VENUE_FIELDS = ["name", "type", "address", "region", "capacity", "ages", "sound", "website", "instagram", "sources"] as const;
export const isPrivateField = (k: string) => (VENUE_PRIVATE_FIELDS as readonly string[]).includes(k);

/** The private fields of a venueNotes doc, or of a not-yet-migrated venue doc. */
export function privateOf(d: object | null | undefined): NoteFields {
  const x = (d ?? {}) as Record<string, unknown>;
  const o: NoteFields = { contactIds: [...((x.contactIds as string[] | undefined) ?? [])], promoterIds: [...((x.promoterIds as string[] | undefined) ?? [])] };
  if (typeof x.loadInNotes === "string" && x.loadInNotes) o.loadInNotes = x.loadInNotes;
  if (typeof x.notes === "string" && x.notes) o.notes = x.notes;
  return o;
}
export const hasPrivate = (f: NoteFields) => !!(f.loadInNotes || f.notes || f.contactIds.length || f.promoterIds.length);

/** Only the shared fields of a venue doc. */
export function sharedOf(v: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(SHARED_VENUE_FIELDS.filter((k) => v[k] !== undefined).map((k) => [k, v[k]]));
}

/** A venue with the band's notes laid over it, and the private fields of the venue doc itself (the legacy ones) taken off. */
export function withNotes<V extends object>(v: V, note: object | null | undefined): V & NoteFields {
  const { loadInNotes: _l, notes: _n, contactIds: _c, promoterIds: _p, ...shared } = v as Record<string, unknown>;
  void _l; void _n; void _c; void _p;
  return { ...shared, ...privateOf(note ?? v) } as V & NoteFields;
}

const emptyValue = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
/**
 * A history diff of a venue that carries a band's private content (the old value of its notes or contacts). Such an entry must not be
 * readable by every band's admins: it is stamped with the band's artistId. Empty private fields (every old venue had `contactIds: []`) do not count.
 */
export function diffHasPrivateContent(diff: Record<string, unknown>): boolean {
  return Object.entries(diff).some(([k, d]) => {
    if (!isPrivateField(k)) return false;
    const x = d as { before?: unknown; after?: unknown };
    return !emptyValue(x.before) || !emptyValue(x.after);
  });
}
