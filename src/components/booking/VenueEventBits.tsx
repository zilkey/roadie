"use client";
/**
 * The pieces of a venue-calendar show (issue #60) that the venue's Events tab and Booking's Venue calendars tab both draw:
 * the badges, the act line, the ticket link and this band's take.
 */
import { useArtist } from "@/lib/artist";
import { useCommand } from "@/components/ui";
import { billParts, openSlot } from "@/lib/venueEvents";
import { EVENT_TAKES, TAKE_LABEL, venueEventNoteId, type VenueEvent, type VenueEventNote } from "@/schema";

export type Ev = VenueEvent & { id: string };

/** Open slot?, Sold out, Cancelled. */
export function EventBadges({ e }: { e: Ev }) {
  return (<>
    {openSlot(e) && <span className="chip a" data-testid="venue-event-open" title={e.supportTba ? "Support still to be announced" : "No support act listed"}>Open slot?</span>}
    {e.status === "soldout" && <span className="chip m">Sold out</span>}
    {e.status === "cancelled" && <span className="chip m">Cancelled</span>}
  </>);
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
