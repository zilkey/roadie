"use client";
/**
 * Networking (#82 S10): "We know them" on a contact or an act (a band-private flag, weKnow on contactNotes / actNotes), and what it
 * buys: the venue page's "Who we know" card and the Venues list's "We know someone" chip. The paths come from src/lib/whoWeKnow.ts.
 */
import { Fragment, useMemo } from "react";
import Link, { useArtist } from "@/lib/artist";
import { useArrayContainsAny, useCollection } from "@/lib/firestore-hooks";
import { useCommand, ErrorBox } from "@/components/ui";
import { DetailCard } from "@/components/booking/DetailCards";
import { hrefFor, useBooking } from "@/components/booking/common";
import { knownActIds, traceWhoWeKnow, venuesWeKnow, type KnownPath, type Named, type TraceData, type TraceVenue } from "@/lib/whoWeKnow";
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

function PathRow({ p, today }: { p: KnownPath; today: string }) {
  if (p.kind === "works") {
    return <>{contactLink(p.contact)}<span className="d-muted">works here{p.roles.length ? ` (${p.roles.map((r) => ROLE_WORD[r]).join(", ")})` : ""}</span></>;
  }
  if (p.kind === "books") {
    return <>{contactLink(p.contact)}<span className="d-muted">books for</span><Link href={hrefFor("promoter", p.promoter.id)} className="underline">{p.promoter.name}</Link></>;
  }
  const [last, ...more] = p.shows;
  return (
    <>
      {p.contacts.length > 0 && <>{list(p.contacts)}<span className="d-muted">·</span></>}
      <Link href={hrefFor("act", p.act.id)} className="underline">{p.act.name}</Link>
      {p.actKnown && <span className="d-muted">(we know the band)</span>}
      <span className="d-muted">
        · {last.date >= today ? "plays here" : "played here"} {fmtEventYear(last.date)}{last.role === "support" ? " (support)" : last.role === "headliner" ? " (headlining)" : ""}
        {more.length > 0 && ` and ${more.length} more time${more.length === 1 ? "" : "s"}`}
      </span>
    </>
  );
}

/** The venue page's band-private "Who we know" card: every path from this room to someone the band knows. */
export function WhoWeKnowCard({ b, venue }: { b: ReturnType<typeof useBooking>; venue: TraceVenue }) {
  const data = useWeKnowData(b);
  const paths = useMemo(() => traceWhoWeKnow(venue, data), [venue, data]);
  const today = dateInBandZone();
  return (
    <DetailCard private title="Who we know" testid="who-we-know">
      {paths.length === 0
        ? <div className="empty"><span>No one we know yet. Mark a contact or an act &ldquo;We know them&rdquo; on their page, and anyone linked to this room shows up here.</span></div>
        : paths.map((p) => (
          <div key={p.kind === "played" ? `played:${p.act.id}` : `${p.kind}:${p.contact.id}:${p.kind === "books" ? p.promoter.id : ""}`}
            className="d-row" data-testid={`who-we-know-${p.kind}`}>
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2"><PathRow p={p} today={today} /></div>
          </div>
        ))}
    </DetailCard>
  );
}
