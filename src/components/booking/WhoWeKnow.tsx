"use client";
/**
 * Networking (#82 S10): "We know them" on a contact or an act (a band-private flag, weKnow on contactNotes / actNotes), and what it
 * buys: the venue page's Network tab and the Venues list's "We know someone" chip. The paths come from src/lib/whoWeKnow.ts.
 */
import { Fragment, useMemo } from "react";
import Link, { useArtist } from "@/lib/artist";
import { useArrayContainsAny, useCollection } from "@/lib/firestore-hooks";
import { useCommand, ErrorBox } from "@/components/ui";
import { DetailCard } from "@/components/booking/DetailCards";
import { hrefFor, useBooking } from "@/components/booking/common";
import { knownActIds, venueNetwork, venuesWeKnow, type NetworkAct, type Named, type PlayedShow, type TraceData, type TraceVenue, type VenueNetwork } from "@/lib/whoWeKnow";
import { fmtEventYear } from "@/lib/venueEvents";
import { dateInBandZone } from "@/lib/timezone";
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

const ROLE_WORD = { books: "books", dayOf: "day-of" } as const;
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
  const today = dateInBandZone();
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
