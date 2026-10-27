import { isActive } from "@/lib/booking";
import type { PitchRow, useBooking } from "@/components/booking/common";

export type ListSeg = "all" | "pitches" | "venues" | "festivals" | "promoters" | "contacts";
type Booking = ReturnType<typeof useBooking>;
export type Ref = { kind: "venue" | "promoter" | "festival" | "edition" | "contact"; id: string; name: string };

/** One table row on a Booking tab. `to` is what the name links to; flags exist on venue, edition and promoter rows only. */
export interface ListRow {
  kind: Ref["kind"]; id: string; to: Ref; type: "Venue" | "Festival" | "Promoter" | "Contact";
  /** What the Name column shows (All / Pitch List): editions read "UMS 2027". */
  name: string;
  /** Venue rows: "promoted by ..." */
  promoters: Ref[];
  festival?: Ref; edition?: Ref; addEdition?: boolean;
  /** Promoter rows: the first contact's name. */
  person?: string; organization?: Ref;
  city: string; email?: string; phone?: string;
  /** Where it is, for the Pitch List's place filter: a venue's or festival's town, every town a promoter's venues are in. */
  places: Place[];
  /** Edition rows: the application deadline and the dates it runs. */
  deadline?: { date: string; sure: string }; startDate?: string; endDate?: string;
  /** Venue rows: the venue type key (venueTypes). */
  venueType?: string;
  pitch?: PitchRow; flag: boolean;
}

export type Place = { city: string; state: string };

export const REGION_LABEL: Record<string, string> = { boulder: "Boulder", denver: "Denver", north: "North", south: "South", mountains: "Mountains", southwest: "Southwest", out: "Out of state" };

export { fmtPhone } from "@/lib/venues";

/**
 * The rows for one tab. `hit` is the set of `kind:id` the search matched (null = no search); editions follow their festival.
 * `ours` = venue ids this band has something on; they come first.
 * `status` (Pitch List filter): rows carry the pitch in that status instead of the active one, so closed pitches can be listed too.
 */
export function listRows(b: Booking, seg: ListSeg, ours: Set<string>, hit: Set<string> | null, status?: string): ListRow[] {
  const byName = <T extends { name: string }>(x: T[]) => [...x].sort((a, c) => a.name.localeCompare(c.name));
  const contact = (id?: string) => b.contacts.find((c) => c.id === id);
  const reach = (id?: string) => { const c = contact(id); return { email: c?.emails[0], phone: c?.phones[0] }; };
  const active = (kind: string, id: string) =>
    b.pitches.find((p) => p.target.kind === kind && p.target.id === id && (status ? p.status === status : isActive(p.status)));
  const placesOf = (venueIds: string[]) => venueIds.flatMap((id) => { const a = b.venues.find((v) => v.id === id)?.address; return a ? [{ city: a.city, state: a.state }] : []; });
  const cityOfVenue = (venueIds: string[]) => [...new Set(placesOf(venueIds).map((p) => p.city))].join(", ");
  // A festival from before the festival-where migration has no town yet: its old region stands in.
  const festCity = (f: (typeof b.festivals)[number]) => f.address?.city ?? (f.region ? REGION_LABEL[f.region] ?? f.region : "");
  const festPlaces = (f: (typeof b.festivals)[number]): Place[] => (f.address ? [f.address] : []);
  const base = { promoters: [] as Ref[], places: [] as Place[], flag: false };

  const venues: ListRow[] = [...byName(b.venues)].sort((x, y) => Number(ours.has(y.id)) - Number(ours.has(x.id))).map((v) => {
    const pitch = active("venue", v.id);
    const to: Ref = { kind: "venue", id: v.id, name: v.name };
    return { ...base, kind: "venue", id: v.id, to, type: "Venue", name: v.name, city: v.address.city, places: [{ city: v.address.city, state: v.address.state }], venueType: v.type,
      promoters: v.promoterIds.flatMap((id) => { const p = b.promoters.find((x) => x.id === id); return p ? [{ kind: "promoter" as const, id: p.id, name: p.name }] : []; }),
      ...reach(v.contactIds[0]), pitch, flag: true };
  });

  const festivals: ListRow[] = byName(b.festivals).flatMap((f): ListRow[] => {
    const city = festCity(f), places = festPlaces(f), fest: Ref = { kind: "festival", id: f.id, name: f.name }, r = reach(f.contactIds[0]);
    const eds = b.editions.filter((e) => e.festivalId === f.id).sort((x, y) => y.year - x.year);
    if (!eds.length) return [{ ...base, kind: "festival", id: f.id, to: fest, type: "Festival", name: f.name, festival: fest, addEdition: true, city, places, ...r }];
    return eds.map((e) => {
      const edition: Ref = { kind: "edition", id: e.id, name: `${f.name} ${e.label}` };
      return { ...base, kind: "edition", id: e.id, to: edition, type: "Festival", name: edition.name, festival: fest, edition: { ...edition, name: e.label },
        city, places, ...r, pitch: active("edition", e.id), flag: true, deadline: e.appDeadline, startDate: e.startDate, endDate: e.endDate };
    });
  });

  const promoters: ListRow[] = byName(b.promoters).map((p) => {
    const person = contact(p.contactIds[0]);
    return { ...base, kind: "promoter", id: p.id, to: { kind: "promoter", id: p.id, name: p.name }, type: "Promoter", name: p.name, person: person?.name,
      city: cityOfVenue(p.venueIds), places: placesOf(p.venueIds), ...reach(p.contactIds[0]), pitch: active("promoter", p.id), flag: true };
  });

  const contacts: ListRow[] = byName(b.contacts).map((c) => {
    const v = b.venues.find((x) => x.contactIds.includes(c.id)), p = b.promoters.find((x) => x.contactIds.includes(c.id)), f = b.festivals.find((x) => x.contactIds.includes(c.id));
    const organization: Ref | undefined = v ? { kind: "venue", id: v.id, name: v.name } : p ? { kind: "promoter", id: p.id, name: p.name } : f ? { kind: "festival", id: f.id, name: f.name } : undefined;
    const city = v ? v.address.city : p ? cityOfVenue(p.venueIds) : f ? festCity(f) : "";
    return { ...base, kind: "contact", id: c.id, to: { kind: "contact", id: c.id, name: c.name }, type: "Contact", name: c.name, organization, city, email: c.emails[0], phone: c.phones[0] };
  });

  const searching = hit !== null;
  const matches = (r: ListRow) => !hit || hit.has(`${r.kind === "edition" ? "festival" : r.kind}:${r.kind === "edition" ? r.festival!.id : r.id}`);
  const rows = seg === "venues" ? venues : seg === "festivals" ? festivals : seg === "promoters" ? promoters : seg === "contacts" ? contacts
    : [...venues, ...festivals, ...promoters, ...(searching ? contacts : [])];
  return rows.filter((r) => matches(r) && (seg !== "pitches" || r.pitch));
}
