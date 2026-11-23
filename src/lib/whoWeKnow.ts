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

type PlayedPath = Extract<KnownPath, { kind: "played" }>;
/** An act we can reach on the venue's calendar, its shows split at today: `upcoming` soonest first, `past` newest first. */
export type NetworkAct = Omit<PlayedPath, "shows"> & { upcoming: PlayedShow[]; past: PlayedShow[] };
export interface VenueNetwork {
  /** Known acts (or acts with people we know) with a show here today or later, soonest first. */
  booked: NetworkAct[];
  /** The rest that have played here, most recent first. */
  played: NetworkAct[];
  /** Known people who work at the room or book it through a promoter. */
  around: Exclude<KnownPath, { kind: "played" }>[];
}

/** The venue's Network tab: who we know that's booked to play here, who has played here, and who works or books here. */
export function venueNetwork(v: TraceVenue, d: TraceData, today: string): VenueNetwork {
  const out: VenueNetwork = { booked: [], played: [], around: [] };
  for (const p of traceWhoWeKnow(v, d)) {
    if (p.kind !== "played") { out.around.push(p); continue; }
    const { shows, ...rest } = p;
    const upcoming = shows.filter((s) => s.date >= today).reverse();
    const past = shows.filter((s) => s.date < today);
    (upcoming.length ? out.booked : out.played).push({ ...rest, upcoming, past });
  }
  out.booked.sort((x, y) => x.upcoming[0].date.localeCompare(y.upcoming[0].date) || x.act.name.localeCompare(y.act.name));
  return out;
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

/** A link in a promoter's network diagram: who we know, and the venue (or the promoter itself) they get us to. */
export interface NetworkLink {
  from: string;
  /** A venue id, or "promoter" for someone who works for the promoter. */
  to: string;
  /** What the link means, in a few words ("works here", "plays here Mar 4", "played here 3 times"). */
  label: string;
  /** Upcoming (booked to play) links are drawn strongest. */
  strength: "booked" | "works" | "played";
}
export interface NetworkPerson {
  key: string;
  kind: "contact" | "act";
  id: string;
  name: string;
  /** An act: the people we know in it, and whether we know the band itself. */
  via?: Named[];
  actKnown?: boolean;
}
export interface PromoterNetwork {
  /** Everyone we know that reaches one of the promoter's rooms (or the promoter), in an order that keeps the links from crossing much. */
  people: NetworkPerson[];
  /** The promoter's venues someone reaches, then (`unreached`) the rest. */
  venues: Named[];
  unreached: Named[];
  links: NetworkLink[];
  /** Each reached venue's own Network breakdown, for the list under the diagram. */
  byVenue: Map<string, VenueNetwork>;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * A promoter's Network tab: how we can get to each of its venues through people we know. People who work for the promoter link
 * straight to it; everyone else links to the room they work at, are booked at or have played. `fmt` formats a show date.
 */
export function promoterNetwork(
  promoter: { id: string; contactIds?: string[] },
  venues: readonly (TraceVenue & { name: string })[],
  d: TraceData,
  today: string,
  fmt: (date: string) => string = (x) => x,
): PromoterNetwork {
  const { known } = knownSets(d);
  const people = new Map<string, NetworkPerson>();
  const links: NetworkLink[] = [];
  const seen = new Set<string>();
  const link = (p: NetworkPerson, l: Omit<NetworkLink, "from">) => {
    if (!people.has(p.key)) people.set(p.key, p);
    const k = `${p.key}>${l.to}`;
    if (seen.has(k)) return;
    seen.add(k);
    links.push({ from: p.key, ...l });
  };
  const contactNode = (c: Named): NetworkPerson => ({ key: `c:${c.id}`, kind: "contact", id: c.id, name: c.name });

  for (const id of new Set(promoter.contactIds ?? [])) {
    const c = known.get(id);
    if (c) link(contactNode(c), { to: "promoter", label: "works for them", strength: "works" });
  }
  const byVenue = new Map<string, VenueNetwork>();
  const reached: Named[] = [], unreached: Named[] = [];
  for (const v of [...venues].sort((x, y) => x.name.localeCompare(y.name))) {
    const net = venueNetwork(v, d, today);
    // Someone who books for this promoter is already linked to it; booking for another promoter still gets us to the room.
    const around = net.around.filter((p) => !(p.kind === "books" && p.promoter.id === promoter.id));
    const vn = { ...net, around };
    const any = vn.booked.length + vn.played.length + around.length > 0;
    (any ? reached : unreached).push({ id: v.id, name: v.name });
    if (!any) continue;
    byVenue.set(v.id, vn);
    for (const a of vn.booked) {
      link({ key: `a:${a.act.id}`, kind: "act", id: a.act.id, name: a.act.name, via: a.contacts, actKnown: a.actKnown },
        { to: v.id, label: `plays here ${fmt(a.upcoming[0].date)}`, strength: "booked" });
    }
    for (const p of around) {
      link(contactNode(p.contact), { to: v.id, label: p.kind === "works" ? "works here" : `books it for ${p.promoter.name}`, strength: "works" });
    }
    for (const a of vn.played) {
      link({ key: `a:${a.act.id}`, kind: "act", id: a.act.id, name: a.act.name, via: a.contacts, actKnown: a.actKnown },
        { to: v.id, label: a.past.length > 1 ? `played here ${plural(a.past.length, "time")}` : `played here ${fmt(a.past[0].date)}`, strength: "played" });
    }
  }
  // Order people by the average row of what they link to (the promoter sits below every venue), so lines mostly run straight across.
  const row = new Map<string, number>(reached.map((v, i) => [v.id, i]));
  row.set("promoter", reached.length);
  const order = (key: string) => { const xs = links.filter((l) => l.from === key).map((l) => row.get(l.to) ?? 0); return xs.reduce((s, x) => s + x, 0) / xs.length; };
  const sorted = [...people.values()].sort((x, y) => order(x.key) - order(y.key) || x.name.localeCompare(y.name));
  return { people: sorted, venues: reached, unreached, links, byVenue };
}
