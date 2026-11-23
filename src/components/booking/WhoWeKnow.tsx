"use client";
/**
 * Networking (#82 S10): "We know them" on a contact or an act (a band-private flag, weKnow on contactNotes / actNotes), and what it
 * buys: the venue page's Network tab and the Venues list's "We know someone" chip. The paths come from src/lib/whoWeKnow.ts.
 */
import { Fragment, useMemo, useState } from "react";
import Link, { useArtist, useZone } from "@/lib/artist";
import { useArrayContainsAny, useCollection } from "@/lib/firestore-hooks";
import { useCommand, ErrorBox } from "@/components/ui";
import { DetailCard } from "@/components/booking/DetailCards";
import { hrefFor, useBooking } from "@/components/booking/common";
import { knownActIds, promoterNetwork, venueNetwork, venuesWeKnow, type NetworkLink, type NetworkPerson, type PromoterNetwork, type NetworkAct, type Named, type PlayedShow, type TraceData, type TraceVenue, type VenueNetwork } from "@/lib/whoWeKnow";
import { fmtEventYear } from "@/lib/venueEvents";
import { dateInZone } from "@/lib/timezone";
import type { ActNote, VenueEvent } from "@/schema";

/** What the trace needs beyond useBooking: this band's act notes and the calendar shows of the acts we can reach. Admins only. */
export function useWeKnowData(b: ReturnType<typeof useBooking>, skip = false) {
  const { artistId, role } = useArtist();
  const admin = role === "admin" && !skip;
  const actNotes = useCollection<ActNote>("actNotes", { where: [["artistId", "==", artistId]], skip: !admin });
  const actIds = useMemo(() => knownActIds({ contacts: b.contacts, actNotes: actNotes.rows ?? [] }), [b.contacts, actNotes.rows]);
  const events = useArrayContainsAny<VenueEvent>("venueEvents", "actIds", actIds, { skip: !admin });
  return useMemo<TraceData>(() => ({ contacts: b.contacts, promoters: b.promoters, actNotes: actNotes.rows ?? [], events: events.rows }),
    [b.contacts, b.promoters, actNotes.rows, events.rows]);
}

/** The Venues list's chip set: venue ids with someone we know. `skip` (another tab) reads nothing. */
export function useVenuesWeKnow(b: ReturnType<typeof useBooking>, skip = false): Set<string> {
  const data = useWeKnowData(b, skip);
  return useMemo(() => venuesWeKnow(b.venues, data), [b.venues, data]);
}

export function WeKnowChip({ id }: { id: string }) {
  return <span className="chip g" title="Someone we know works here, books it, or played here" data-testid={`we-know-chip-${id}`}>We know someone</span>;
}

/** The "We know them" toggle on a contact's or an act's page. */
export function WeKnowToggle({ kind, id, on }: { kind: "contact" | "act"; id: string; on: boolean }) {
  const { call, busy, error } = useCommand();
  const command = kind === "contact" ? "contacts.update" : "acts.update";
  return (
    <>
      <button type="button" className={on ? "btn soft" : "btn"} aria-pressed={on} data-on={on ? "1" : "0"} disabled={busy}
        title={on ? "Someone in the band knows them. Click to unmark." : "Mark that someone in the band knows them: venues they're linked to show it."}
        onClick={() => void call(command, { id, patch: { weKnow: !on } })} data-testid="we-know">
        {on ? "✓ We know them" : "We know them"}
      </button>
      <ErrorBox error={error} />
    </>
  );
}

/** The same flag as a checkbox, for a table row (the Contacts table, the Acts tab). */
export function WeKnowCheck({ kind, id, name, on }: { kind: "contact" | "act"; id: string; name: string; on: boolean }) {
  const { call, busy, error } = useCommand();
  const command = kind === "contact" ? "contacts.update" : "acts.update";
  // The box flips at once and holds the new value until the record catches up (or the save fails).
  const [want, setWant] = useState<boolean | null>(null);
  if (want !== null && want === on) setWant(null);
  const shown = want ?? on;
  const flip = async () => { setWant(!shown); if (!(await call(command, { id, patch: { weKnow: !shown } }))) setWant(null); };
  return (
    <label className="we-know-check" title={error ?? (shown ? "Someone in the band knows them" : "Mark that someone in the band knows them")}>
      <input type="checkbox" checked={shown} disabled={busy} aria-label={`We know ${name}`} data-testid={`we-know-${id}`} onChange={() => void flip()} />
      {error && <span className="sr-only" role="alert">{error}</span>}
    </label>
  );
}

const ROLE_WORD ={ books: "books", dayOf: "day-of" } as const;
const contactLink = (c: Named) => <Link href={hrefFor("contact", c.id)} className="underline">{c.name}</Link>;
const list = (xs: Named[]) => xs.map((c, i) => <Fragment key={c.id}>{i > 0 && ", "}{contactLink(c)}</Fragment>);

const ROLE_NOTE: Record<PlayedShow["role"], string> = { support: " (support)", headliner: " (headlining)", unknown: "" };
const times = (n: number) => `${n} time${n === 1 ? "" : "s"}`;

/** Someone works at the room, or books it for a promoter. */
function AroundRow({ p }: { p: VenueNetwork["around"][number] }) {
  if (p.kind === "works") {
    return <>{contactLink(p.contact)}<span className="d-muted">works here{p.roles.length ? ` (${p.roles.map((r) => ROLE_WORD[r]).join(", ")})` : ""}</span></>;
  }
  return <>{contactLink(p.contact)}<span className="d-muted">books for</span><Link href={hrefFor("promoter", p.promoter.id)} className="underline">{p.promoter.name}</Link></>;
}

/** An act on the room's calendar: the people we know in it, the act, and its next (or last) show here. */
function ActRow({ a, booked }: { a: NetworkAct; booked: boolean }) {
  const [first, ...more] = booked ? a.upcoming : a.past;
  return (
    <>
      {a.contacts.length > 0 && <>{list(a.contacts)}<span className="d-muted">·</span></>}
      <Link href={hrefFor("act", a.act.id)} className="underline">{a.act.name}</Link>
      {a.actKnown && <span className="d-muted">(we know the band)</span>}
      <span className="d-muted">
        · {booked ? "plays here" : "played here"} {fmtEventYear(first.date)}{ROLE_NOTE[first.role]}
        {more.length > 0 && (booked ? ` and ${times(more.length)} more` : ` and ${times(more.length)} before`)}
        {booked && a.past.length > 0 && `; played here ${times(a.past.length)} before`}
      </span>
    </>
  );
}

function Rows<T>({ items, testid, keyOf, row }: { items: T[]; testid: (t: T) => string; keyOf: (t: T) => string; row: (t: T) => React.ReactNode }) {
  return items.map((t) => (
    <div key={keyOf(t)} className="d-row" data-testid={testid(t)}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">{row(t)}</div>
    </div>
  ));
}

/**
 * The venue's Network tab (admins only): everyone we know who is booked to play this room or has played it (from the venue
 * calendars), then the people we know who work here or book it. Who might put in a word with the promoter.
 */
export function VenueNetworkTab({ b, venue }: { b: ReturnType<typeof useBooking>; venue: TraceVenue }) {
  const data = useWeKnowData(b);
  const zone = useZone();
  const today = dateInZone(zone);
  const net = useMemo(() => venueNetwork(venue, data, today), [venue, data, today]);
  const actKey = (a: NetworkAct) => a.act.id;
  const actTestid = (a: NetworkAct) => `network-act-${a.act.id}`;
  return (
    <div className="grid gap-4" data-testid="venue-network">
      <DetailCard private title={`Booked to play here (${net.booked.length})`} testid="network-booked">
        {net.booked.length === 0 ? <div className="empty"><span>No one we know is on this room&apos;s upcoming calendar.</span></div>
          : <Rows items={net.booked} keyOf={actKey} testid={actTestid} row={(a) => <ActRow a={a} booked />} />}
      </DetailCard>
      <DetailCard private title={`Played here (${net.played.length})`} testid="network-played">
        {net.played.length === 0 ? <div className="empty"><span>No one we know has played here yet, as far as the calendar goes.</span></div>
          : <Rows items={net.played} keyOf={actKey} testid={actTestid} row={(a) => <ActRow a={a} booked={false} />} />}
      </DetailCard>
      {net.around.length > 0 && (
        <DetailCard private title="Works here or books it" testid="network-around">
          <Rows items={net.around} keyOf={(p) => `${p.kind}:${p.contact.id}:${p.kind === "books" ? p.promoter.id : ""}`} testid={(p) => `network-${p.kind}`} row={(p) => <AroundRow p={p} />} />
        </DetailCard>
      )}
      <span className="s" data-testid="network-hint">
        Someone counts when you mark them &ldquo;We know them&rdquo; on their contact or act page. Acts come from the venue calendars (Venue events), so refresh a room&apos;s calendar to bring in its latest bills.
      </span>
    </div>
  );
}

const ROW = 60;
/** Column left edges and width, in % of the diagram's width: People we know | Venues | the promoter. */
const COL = { people: 0, venues: 37, promoter: 74, w: 26 } as const;

/** One column's node centres (px), centred in the diagram's height. */
const centres = (n: number, h: number) => Array.from({ length: n }, (_, i) => (h - n * ROW) / 2 + i * ROW + ROW / 2);

function personSub(p: NetworkPerson, links: NetworkLink[]): string {
  const mine = links.filter((l) => l.from === p.key);
  const via = p.via?.length ? `${p.via.map((c) => c.name).join(", ")}${p.actKnown ? " + the band" : ""}` : "";
  const what = mine.length === 1 ? mine[0].label : `${mine.length} links`;
  return p.kind === "act" ? [via || "we know the band", what].join(" · ") : what;
}

/**
 * The diagram: people (and acts) we know on the left, the promoter's rooms they reach in the middle, the promoter on the right.
 * Booked-to-play links are solid accent, works-here links green, played-here links grey dashes. Hover or focus a node to trace it.
 */
function NetworkDiagram({ net, promoterName }: { net: PromoterNetwork; promoterName: string }) {
  const [hot, setHot] = useState<string | null>(null);
  const h = Math.max(net.people.length, net.venues.length, 1) * ROW;
  const py = centres(net.people.length, h), vy = centres(net.venues.length, h), promY = h / 2;
  const yOfPerson = new Map(net.people.map((p, i) => [p.key, py[i]]));
  const yOfVenue = new Map(net.venues.map((v, i) => [v.id, vy[i]]));
  const toPromoter = new Set(net.links.filter((l) => l.to === "promoter").map((l) => l.from));
  const lit = (l: NetworkLink) => !hot || l.from === hot || l.to === hot || (hot === "promoter" && (l.to === "promoter" || yOfVenue.has(l.to)));
  const nodeLit = (key: string) => !hot || hot === key || net.links.some((l) => lit(l) && (l.from === key || l.to === key)) || (key === "promoter" && hot !== null && yOfVenue.has(hot));
  const curve = (x1: number, y1: number, x2: number, y2: number) => { const m = (x1 + x2) / 2; return `M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2}`; };
  const hover = (key: string) => ({ onMouseEnter: () => setHot(key), onMouseLeave: () => setHot(null), onFocus: () => setHot(key), onBlur: () => setHot(null) });
  const node = (key: string, y: number, left: number, body: React.ReactNode, cls = "") => (
    <div key={key} className={`net-node ${cls}${nodeLit(key) ? "" : " dim"}`} style={{ top: y - (ROW - 12) / 2, left: `${left}%`, width: `${COL.w}%`, height: ROW - 12 }} {...hover(key)}>{body}</div>
  );
  return (
    <div className="net-scroll">
      <div className="net-heads"><span style={{ left: `${COL.people}%` }}>Who we know</span><span style={{ left: `${COL.venues}%` }}>Their venues</span><span style={{ left: `${COL.promoter}%` }}>Promoter</span></div>
      <div className="net-diagram" style={{ height: h }} data-testid="network-diagram">
        <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" width="100%" height={h} aria-hidden>
          {net.links.map((l) => {
            const y1 = yOfPerson.get(l.from)!, x1 = COL.people + COL.w;
            const [x2, y2] = l.to === "promoter" ? [COL.promoter, promY] : [COL.venues, yOfVenue.get(l.to)!];
            return <path key={`${l.from}>${l.to}`} d={curve(x1, y1, x2, y2)} className={`net-link ${l.strength}${lit(l) ? "" : " dim"}`} vectorEffect="non-scaling-stroke"><title>{l.label}</title></path>;
          })}
          {net.venues.map((v) => (
            <path key={`${v.id}>p`} d={curve(COL.venues + COL.w, yOfVenue.get(v.id)!, COL.promoter, promY)} className={`net-link venue${!hot || hot === v.id || hot === "promoter" || net.links.some((l) => l.to === v.id && l.from === hot) ? "" : " dim"}`} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {net.people.map((p) => node(p.key, yOfPerson.get(p.key)!, COL.people, <>
          <Link href={hrefFor(p.kind, p.id)} className="nm" data-testid={`network-node-${p.kind}-${p.id}`}>{p.name}</Link>
          <span className="sub">{personSub(p, net.links)}</span>
        </>, p.kind === "act" ? "act" : toPromoter.has(p.key) ? "works" : ""))}
        {net.venues.map((v) => node(v.id, yOfVenue.get(v.id)!, COL.venues, <>
          <Link href={`${hrefFor("venue", v.id)}?tab=network`} className="nm" data-testid={`network-node-venue-${v.id}`}>{v.name}</Link>
          <span className="sub">{(() => { const n = net.links.filter((l) => l.to === v.id).length; return `${n} ${n === 1 ? "way" : "ways"} in`; })()}</span>
        </>, "venue"))}
        {node("promoter", promY, COL.promoter, <><span className="nm">{promoterName}</span><span className="sub">{net.venues.length} of {net.venues.length + net.unreached.length} rooms reached</span></>, "promoter")}
      </div>
      <div className="net-key s"><span><i className="booked" />booked to play</span><span><i className="works" />works or books there</span><span><i className="played" />played there</span></div>
    </div>
  );
}

/**
 * The promoter's Network tab (admins only): a diagram of how we reach its venues through people we know (contacts marked "We
 * know them", acts we know or whose people we know, from the venue calendars), then the same paths listed room by room.
 */
export function PromoterNetworkTab({ b, promoter, venues }: { b: ReturnType<typeof useBooking>; promoter: { id: string; name: string; contactIds?: string[] }; venues: readonly (TraceVenue & { name: string })[] }) {
  const data = useWeKnowData(b);
  const zone = useZone();
  const today = dateInZone(zone);
  const net = useMemo(() => promoterNetwork(promoter, venues, data, today, fmtEventYear), [promoter, venues, data, today]);
  const direct = net.people.filter((p) => net.links.some((l) => l.from === p.key && l.to === "promoter"));
  const empty = net.people.length === 0;
  return (
    <div className="grid gap-4" data-testid="promoter-network">
      <DetailCard private title="How we get in" testid="network-map">
        {empty ? <div className="empty" data-testid="network-empty"><span>{venues.length === 0 ? "No venues linked to this promoter yet." : "No one we know works here, works at their rooms, or has played them yet."}</span></div>
          : <NetworkDiagram net={net} promoterName={promoter.name} />}
        {!empty && net.unreached.length > 0 && (
          <span className="s" data-testid="network-unreached">No one yet at {net.unreached.map((v, i) => <Fragment key={v.id}>{i > 0 && ", "}<Link href={hrefFor("venue", v.id)} className="underline">{v.name}</Link></Fragment>)}.</span>
        )}
      </DetailCard>
      {direct.length > 0 && (
        <DetailCard private title="Works for them" testid="network-direct">
          <Rows items={direct} keyOf={(p) => p.key} testid={(p) => `network-direct-${p.id}`} row={(p) => <>{contactLink(p)}<span className="d-muted">works for {promoter.name}</span></>} />
        </DetailCard>
      )}
      {net.venues.map((v) => {
        const vn = net.byVenue.get(v.id)!;
        return (
          <DetailCard key={v.id} private title={<Link href={`${hrefFor("venue", v.id)}?tab=network`} className="underline">{v.name}</Link>} testid={`network-venue-${v.id}`}>
            <Rows items={vn.booked} keyOf={(a) => a.act.id} testid={(a) => `network-act-${a.act.id}`} row={(a) => <ActRow a={a} booked />} />
            <Rows items={vn.around} keyOf={(p) => `${p.kind}:${p.contact.id}:${p.kind === "books" ? p.promoter.id : ""}`} testid={(p) => `network-${p.kind}`} row={(p) => <AroundRow p={p} />} />
            <Rows items={vn.played} keyOf={(a) => a.act.id} testid={(a) => `network-act-${a.act.id}`} row={(a) => <ActRow a={a} booked={false} />} />
          </DetailCard>
        );
      })}
      <span className="s" data-testid="network-hint">
        Someone counts when you tick &ldquo;We know&rdquo; on them in Contacts or on the Acts tab (or on their page). Acts come from the venue calendars, so refresh a room&apos;s calendar to bring in its latest bills.
      </span>
    </div>
  );
}
