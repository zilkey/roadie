"use client";
/**
 * The pieces of a venue-calendar show (issue #60) that the venue's Events tab and Booking's Venue calendars tab both draw:
 * the badges (the opener-chance guess), the poster, the act line, the ticket link and this band's take.
 */
import { useArtist } from "@/lib/artist";
import { useCommand } from "@/components/ui";
import { useState } from "react";
import { billParts, openerChance } from "@/lib/venueEvents";
import { EVENT_TAKES, TAKE_LABEL, venueEventNoteId, type VenueEvent, type VenueEventNote, type VenueEventSource } from "@/schema";

export type Ev = VenueEvent & { id: string };
export type RoomRecord = Pick<VenueEventSource, "supportShare" | "billsSeen"> | null | undefined;

export const OPENER_DISCLAIMER = "A guess from the listing, not perfect.";

/** Likely opener slot / Maybe (the reasons and the disclaimer as its title), Sold out, Cancelled. */
export function EventBadges({ e, stats, today }: { e: Ev; stats?: RoomRecord; today?: string }) {
  const o = openerChance(e, stats, today);
  return (<>
    {o.chance !== "unlikely" && (
      <span className={`chip${o.chance === "likely" ? " a" : ""}`} data-testid="venue-event-chance" data-chance={o.chance}
        title={`${o.reasons.join(". ")}. ${OPENER_DISCLAIMER}`}>
        {o.chance === "likely" ? "Likely opener slot" : "Maybe"}
      </span>
    )}
    {e.status === "soldout" && <span className="chip m">Sold out</span>}
    {e.status === "cancelled" && <span className="chip m">Cancelled</span>}
  </>);
}

/** Under a list that shows the opener badges: how far to trust them. */
export const OpenerNote = () => <span className="s" data-testid="opener-disclaimer">&ldquo;Likely opener slot&rdquo; and &ldquo;Maybe&rdquo; are {OPENER_DISCLAIMER.charAt(0).toLowerCase() + OPENER_DISCLAIMER.slice(1)} Hover one for why.</span>;

/** A show's poster, or a plain square when it has none or it won't load. Remote hosts are arbitrary (every venue's own CDN), so a plain img. */
export function EventPoster({ src, alt, size = 64, testid = "venue-event" }: { src?: string; alt: string; size?: number; testid?: string }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };
  if (!src || failed) return <div className="shrink-0 rounded-lg bg-[var(--soft)]" style={box} aria-hidden data-testid={`${testid}-noimage`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="shrink-0 rounded-lg object-cover" style={box} data-testid={`${testid}-image`} />;
}

/** "Headliner with Support, Support", or the listed title when the source named no acts. */
export function EventActs({ e, className = "font-semibold" }: { e: Ev; className?: string }) {
  const { head, rest } = billParts(e.acts);
  return (
    <div className={className} data-testid="venue-event-acts">
      {e.acts.length ? <>{head.join(", ")}{rest.length > 0 && <span className="font-normal"> with {rest.join(", ")}</span>}</> : e.title}
    </div>
  );
}

export function TicketLink({ e }: { e: Ev }) {
  return e.ticketUrl ? <a className="text-sm underline" href={e.ticketUrl} target="_blank" rel="noreferrer">Tickets and details ↗</a> : null;
}

/** This band's take: private (venueEventNotes), so the control says who sees it. */
export function TakePicker({ e, take, artistId, label = true }: { e: Ev; take?: VenueEventNote; artistId: string; /** false: no visible "Our take" (a table column header says it) */ label?: boolean }) {
  const { call, error } = useCommand();
  const { name } = useArtist();
  const id = venueEventNoteId(artistId, e.id);
  return (
    <label className="flex items-center gap-1 text-sm" title={`Only ${name} sees this`}>
      {label && <span className="s">Our take</span>}
      <select className="select !min-h-8 !w-auto !py-1 text-sm" value={take?.take ?? ""} aria-label="Our take" data-testid={`venue-event-take-${e.id}`} data-note-id={id}
        onChange={(ev) => void call("venueEvents.setTake", { eventId: e.id, take: ev.target.value || null })}>
        <option value="">—</option>
        {EVENT_TAKES.map((t) => <option key={t} value={t}>{TAKE_LABEL[t]}</option>)}
      </select>
      {error && <span className="text-sm text-[var(--danger)]">{error}</span>}
    </label>
  );
}
