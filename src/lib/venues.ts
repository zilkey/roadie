/**
 * Pure helpers for the two-document venue (docs/venue-access-proposal.md), shared by the server and the pages:
 * the shared `venues/{id}` and one band's private `venueNotes/{artistId}__{venueId}`.
 * Until `npm run migrate:venue-notes` has run, a venue doc can still carry the private fields itself (the legacy shape): `privateOf` reads either.
 */
import { VENUE_PRIVATE_FIELDS, VENUE_ROLE_FIELDS } from "@/schema/venues";

export interface NoteFields {
  loadInNotes?: string; notes?: string; contactIds: string[]; promoterIds: string[];
  /** Subsets of contactIds: who handles booking, who to call on the day. */
  bookingContactIds: string[]; dayOfContactIds: string[];
}

/** A venue contact's roles, as the checkboxes and contacts.setRoles name them, and the note field each lives in. */
export const CONTACT_ROLES = ["booking", "dayOf"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];
export const ROLE_FIELD = { booking: "bookingContactIds", dayOf: "dayOfContactIds" } as const satisfies Record<ContactRole, keyof NoteFields>;
export const ROLE_LABEL: Record<ContactRole, string> = { booking: "Booking", dayOf: "Day-of" };
export const rolesOf = (f: Pick<NoteFields, "bookingContactIds" | "dayOfContactIds">, contactId: string): ContactRole[] =>
  CONTACT_ROLES.filter((r) => f[ROLE_FIELD[r]].includes(contactId));
/** The venue's contacts with one role first (in the order they were ticked), then the rest. */
export function roleFirst<C extends { id: string }>(contacts: C[], ids: string[]): C[] {
  const rank = (c: C) => (ids.includes(c.id) ? ids.indexOf(c.id) : ids.length);
  return contacts.map((c, i) => [c, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([c]) => c);
}

/** `+13035551212` -> `(303) 555-1212`; anything else as stored. */
export function fmtPhone(p: string) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p;
}
/** A show's dayOfContact copied from a contact: name, first phone, and the link. */
export const dayOfContactOf = (c: { id: string; name: string; phones: string[] }) =>
  ({ name: c.name, ...(c.phones[0] ? { phone: fmtPhone(c.phones[0]) } : {}), contactId: c.id });

/** The fields of the shared venue record (what `venues` keeps after the split). */
export const SHARED_VENUE_FIELDS = ["name", "type", "address", "region", "capacity", "ages", "sound", "website", "instagram", "sources"] as const;
export const isPrivateField = (k: string) => ([...VENUE_PRIVATE_FIELDS, ...VENUE_ROLE_FIELDS] as readonly string[]).includes(k);

/** The private fields of a venueNotes doc, or of a not-yet-migrated venue doc. */
export function privateOf(d: object | null | undefined): NoteFields {
  const x = (d ?? {}) as Record<string, unknown>;
  const contactIds = [...((x.contactIds as string[] | undefined) ?? [])];
  // A role only counts while the person is still linked to the room.
  const linked = (k: string) => ((x[k] as string[] | undefined) ?? []).filter((id) => contactIds.includes(id));
  const o: NoteFields = {
    contactIds, promoterIds: [...((x.promoterIds as string[] | undefined) ?? [])],
    bookingContactIds: linked("bookingContactIds"), dayOfContactIds: linked("dayOfContactIds"),
  };
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
  const { loadInNotes: _l, notes: _n, contactIds: _c, promoterIds: _p, bookingContactIds: _b, dayOfContactIds: _d, ...shared } = v as Record<string, unknown>;
  void _l; void _n; void _c; void _p; void _b; void _d;
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
