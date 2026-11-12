/**
 * Networking (#82 S10): every path from a venue to someone the band knows, from links Roadie already has. Nothing here is stored.
 * A contact or an act is "known" when its band note has the `weKnow` flag (contactNotes, actNotes).
 *
 * - works: a known contact on this band's venue notes (contactIds, bookingContactIds, dayOfContactIds);
 * - books: a known contact of a promoter that books the venue (the venue's promoterIds, or the promoter's venueIds);
 * - played: an act on the venue's calendar (venueEvents) that we know, or whose people (actNotes.contactIds) include a known contact.
 */

export interface Named { id: string; name: string }
export type ActRole = "headliner" | "support" | "unknown";
export interface PlayedShow { eventId: string; date: string; role: ActRole }

export type KnownPath =
  | { kind: "works"; contact: Named; roles: ("books" | "dayOf")[] }
  | { kind: "books"; contact: Named; promoter: Named }
  /** `actKnown`: we know the act itself; `contacts`: its people we know. `shows` newest first. */
  | { kind: "played"; act: Named; actKnown: boolean; contacts: Named[]; shows: PlayedShow[] };

export interface TraceVenue { id: string; contactIds?: string[]; bookingContactIds?: string[]; dayOfContactIds?: string[]; promoterIds?: string[] }
export interface TraceData {
  contacts: readonly { id: string; name: string; weKnow?: boolean; deletedAt?: unknown }[];
  promoters: readonly { id: string; name: string; contactIds?: string[]; venueIds?: string[]; deletedAt?: unknown }[];
  actNotes: readonly { actId: string; weKnow?: boolean; contactIds?: string[]; deletedAt?: unknown }[];
  /** venueEvents; cancelled and gone ones are skipped (they didn't happen, or left the calendar). */
  events: readonly { id: string; venueId: string; date: string; status?: string; acts: readonly { name: string; role: ActRole; actId?: string }[] }[];
}

const SKIP_STATUS = new Set(["cancelled", "gone"]);

/** The known contacts by id, and each act we can reach: whether we know it, and its known people. */
function knownSets(d: TraceData) {
  const known = new Map<string, Named>();
  for (const c of d.contacts) if (c.weKnow && !c.deletedAt) known.set(c.id, { id: c.id, name: c.name });
  const acts = new Map<string, { actKnown: boolean; contacts: Named[] }>();
  for (const n of d.actNotes) {
    if (n.deletedAt) continue;
    const people = (n.contactIds ?? []).flatMap((id) => known.get(id) ?? []);
    if (n.weKnow || people.length) acts.set(n.actId, { actKnown: !!n.weKnow, contacts: people });
  }
  return { known, acts };
}

function trace(v: TraceVenue, d: TraceData, { known, acts }: ReturnType<typeof knownSets>, events: TraceData["events"]): KnownPath[] {
  const out: KnownPath[] = [];
  for (const id of new Set(v.contactIds ?? [])) {
    const c = known.get(id);
    if (!c) continue;
    const roles: ("books" | "dayOf")[] = [];
    if (v.bookingContactIds?.includes(id)) roles.push("books");
    if (v.dayOfContactIds?.includes(id)) roles.push("dayOf");
    out.push({ kind: "works", contact: c, roles });
  }
  for (const p of d.promoters) {
    if (p.deletedAt || !(v.promoterIds?.includes(p.id) || p.venueIds?.includes(v.id))) continue;
    for (const id of new Set(p.contactIds ?? [])) {
      const c = known.get(id);
      if (c) out.push({ kind: "books", contact: c, promoter: { id: p.id, name: p.name } });
    }
  }
  const played = new Map<string, Extract<KnownPath, { kind: "played" }>>();
  for (const e of events) {
    if (e.venueId !== v.id || (e.status && SKIP_STATUS.has(e.status))) continue;
    for (const a of e.acts) {
      const k = a.actId ? acts.get(a.actId) : undefined;
      if (!a.actId || !k) continue;
      const p = played.get(a.actId) ?? { kind: "played" as const, act: { id: a.actId, name: a.name }, ...k, shows: [] };
      if (!p.shows.some((s) => s.eventId === e.id)) p.shows.push({ eventId: e.id, date: e.date, role: a.role });
      played.set(a.actId, p);
    }
  }
  for (const p of played.values()) p.shows.sort((x, y) => y.date.localeCompare(x.date));
  out.push(...[...played.values()].sort((x, y) => y.shows[0].date.localeCompare(x.shows[0].date) || x.act.name.localeCompare(y.act.name)));
  return out;
}

/** Every path from one venue to someone we know: works there, then books there, then played there (latest show first). */
export function traceWhoWeKnow(v: TraceVenue, d: TraceData): KnownPath[] {
  return trace(v, d, knownSets(d), d.events);
}

/** The venues (of `venues`) with at least one path, for the Venues list's "We know someone" chip. */
export function venuesWeKnow(venues: readonly TraceVenue[], d: TraceData): Set<string> {
  const sets = knownSets(d);
  const byVenue = new Map<string, TraceData["events"][number][]>();
  for (const e of d.events) byVenue.set(e.venueId, [...(byVenue.get(e.venueId) ?? []), e]);
  return new Set(venues.filter((v) => trace(v, d, sets, byVenue.get(v.id) ?? []).length > 0).map((v) => v.id));
}

/** The act ids worth asking venueEvents about: the ones we know, or whose people we know. */
export function knownActIds(d: Pick<TraceData, "contacts" | "actNotes">): string[] {
  return [...knownSets({ ...d, promoters: [], events: [] }).acts.keys()].sort();
}
