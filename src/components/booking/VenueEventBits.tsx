"use client";
/**
 * The pieces of a venue-calendar show (issue #60) that the venue's Events tab and Booking's Venue calendars tab both draw:
 * the badges (the stored opener slot, with its x and + buttons), the poster, the act line, the ticket link, and the pitch flag and Not a fit (ShowActions).
 */
import { Fragment, useState } from "react";
import Link, { useArtist } from "@/lib/artist";
import { Dialog, useCommand } from "@/components/ui";
import { billParts, fmtEventDay, TOUR_WINDOW_DAYS, type ShowActLinks } from "@/lib/venueEvents";
import { InlineValue } from "@/components/InlineValue";
import { isActive } from "@/lib/booking";
import { XIcon } from "@/components/booking/ActsTab";
import { FlagIcon } from "@/components/booking/common";
import { LinkIcons } from "@/components/booking/LinkIcons";
import { campaignArg, useFlagCampaign } from "@/components/booking/FlagCampaign";
import { ONGOING } from "@/lib/campaigns";
import { LINEUP_LABEL, nextLineup, venueEventNoteId, type Act, type ActDoc, type VenueEvent, type VenueEventNote, type VenueEventSource } from "@/schema";
import { useCanEditShared } from "@/lib/sharedEdit";
import { useProfile } from "@/lib/auth";

export type Ev = VenueEvent & { id: string };
export type RoomRecord = Pick<VenueEventSource, "supportShare" | "billsSeen"> | null | undefined;

/** Likely opener slot (the stored openerSlot, with an x; "+ Opener slot" when it's off), On tour, New, Sold out, Cancelled. */
export function EventBadges({ e, today, isNew }: { e: Ev; today: string; /** New since the viewer last looked (Venue calendars only) */ isNew?: boolean }) {
  return (<>
    {(e.tourStops ?? 0) >= 2 && (
      <span className="chip y" data-testid="venue-event-tour" title={`The headliner plays ${e.tourStops} Colorado rooms within ${TOUR_WINDOW_DAYS / 7} weeks of this show: a run like that usually needs a local opener in each town.`}>On tour</span>
    )}
    {isNew && <span className="chip a" data-testid="venue-event-new" title="New on the venue's calendar since you last looked">New</span>}
    {e.date >= today && e.status !== "cancelled" && e.status !== "gone" && <OpenerSlotChip e={e} />}
    {e.status === "soldout" && <span className="chip m">Sold out</span>}
    {e.status === "cancelled" && <span className="chip m">Cancelled</span>}
  </>);
}

/**
 * The show's opener slot (state: VenueEvent.openerSlot). On: "Likely opener slot" with an x that turns it off. Off: a quiet
 * "+ Opener slot" that turns it on (admins; the row shows it on hover). Both are venueEvents.setOpenerSlot, shared with every band.
 */
export function OpenerSlotChip({ e }: { e: Ev }) {
  const { role } = useArtist();
  const { call, busy, error } = useCommand();
  const s = e.openerSlot;
  const admin = role === "admin";
  const set = (open: boolean) => void call("venueEvents.setOpenerSlot", { eventId: e.id, open });
  const why = s ? (s.by === "person" ? "Set by hand" : `Roadie\u2019s guess at import${s.why ? `: ${s.why}` : ""}`) : "";
  if (s?.open) return (
    <span className="chip a inline-flex items-center gap-1" data-testid="venue-event-chance" data-by={s.by} title={why}>
      Likely opener slot
      {admin && <button type="button" className="-mr-1 inline-flex rounded-full p-0.5 opacity-60 hover:opacity-100" disabled={busy}
        aria-label="Not an opener slot" title="Not an opener slot" onClick={() => set(false)} data-testid={`opener-slot-off-${e.id}`}><XIcon size={12} /></button>}
      {error && <span className="text-[var(--danger)]">{error}</span>}
    </span>
  );
  if (!admin) return null;
  return (<>
    <button type="button" className="opener-add text-sm text-[var(--muted)] hover:text-[var(--ink)]" disabled={busy} title={why ? `Off: ${why}. Click if it has one.` : "Mark this show as having an opener slot"}
      onClick={() => set(true)} data-testid={`opener-slot-on-${e.id}`}>+ Opener slot</button>
    {error && <span className="text-sm text-[var(--danger)]">{error}</span>}
  </>);
}

/** Under a list that shows the opener badges: where they come from and how to fix one. */
export const OpenerNote = () => (
  <p className="s" data-testid="opener-disclaimer">&ldquo;Likely opener slot&rdquo; is Roadie&apos;s best guess when a show first lands on the calendar. Hover one for why; x it when it&apos;s wrong, or use + Opener slot on a show it missed.</p>
);

/** A show's poster, or a plain square when it has none or it won't load. Remote hosts are arbitrary (every venue's own CDN), so a plain img. */
export function EventPoster({ src, alt, size = 64, testid = "venue-event" }: { src?: string; alt: string; size?: number; testid?: string }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };
  if (!src || failed) return <div className="shrink-0 rounded-lg bg-[var(--soft)]" style={box} aria-hidden data-testid={`${testid}-noimage`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="shrink-0 rounded-lg object-cover" style={box} data-testid={`${testid}-image`} />;
}

/** An act's name, linked to its act page (#77) for admins when it is a linked act. */
export function ActName({ a }: { a: Act }) {
  const { role } = useArtist();
  return role === "admin" && a.actId ? <Link href={`/booking/acts/${a.actId}`} className="underline decoration-[var(--divider)] underline-offset-2 hover:decoration-current" data-testid={`act-name-${a.actId}`}>{a.name}</Link> : <>{a.name}</>;
}
const names = (acts: Act[]) => acts.map((a, i) => <Fragment key={`${i}-${a.name}`}>{i > 0 && ", "}<ActName a={a} /></Fragment>);

/** "Headliner with Support, Support", or the listed title when the source named no acts. */
export function EventActs({ e, className = "font-semibold" }: { e: Ev; className?: string }) {
  const { rest } = billParts(e.acts);
  const byRole = (headliner: boolean) => e.acts.filter((a) => (a.role === "headliner") === headliner);
  return (
    <div className={className} data-testid="venue-event-acts">
      {e.acts.length ? <>{names(byRole(true))}{rest.length > 0 && <span className="font-normal"> with {names(byRole(false))}</span>}</> : e.title}
    </div>
  );
}

/**
 * Under the ticket link: every website and social link of the acts on the bill (showActLinks), each in a new tab, so the act's
 * page needn't be opened. The act's name leads its links when the bill has more than one act.
 */
export function ActLinksLine({ groups, eventId }: { groups: ShowActLinks[]; eventId: string }) {
  if (!groups.length) return null;
  return (
    <span className="sub" data-testid={`calendar-show-links-${eventId}`}>
      {/* Icons, not words (Jeff, 2026-11-12): the Acts table's LinkIcons. */}
      {groups.map((g) => (
        <span key={g.actId} className="mr-3 inline-flex items-center gap-1.5" data-testid={`calendar-act-links-${g.actId}`}>
          {groups.length > 1 && <>{g.name}:</>}
          <LinkIcons links={Object.fromEntries(g.links.map((l) => [l.key, l.url]))} name={g.name} testid={`calendar-act-link-${g.actId}`} />
        </span>
      ))}
    </span>
  );
}

/**
 * The band's note on a show (venueEventNotes.note, the same note as its take; venueEvents.setTake saves it), click to edit in a
 * table cell. The cell keeps its size: resting, the note is one line with an ellipsis; editing, the textarea lies over the cell
 * at the same width and grows down over the rows below as it fills. Blur or Enter saves (Shift+Enter is a new line), Escape puts it back.
 */
export function ShowNote({ e, take }: { e: Ev; take?: VenueEventNote }) {
  const { call, error } = useCommand();
  const value = take?.note ?? "";
  return (
    <div className="note-cell" title={value || undefined} data-testid={`calendar-show-note-${e.id}`}>
      <InlineValue testid={`show-note-${e.id}`} label="Note" kind="textarea" value={value} emptyLabel="Add a note" canEdit enterSaves error={error}
        onSave={async (v) => !!(await call("venueEvents.setTake", { eventId: e.id, note: v || null }))} />
    </div>
  );
}

export function TicketLink({ e }: { e: Ev }) {
  return e.ticketUrl ? <a className="text-sm underline" href={e.ticketUrl} target="_blank" rel="noopener noreferrer">Tickets and details ↗</a> : null;
}

/**
 * A show's pitch flag and Not a fit, admins only (venueEventNotes is private to the band). The flag is the Booking lists' flag:
 * hollow until the show is on the venue's open pitch. A click adds it (venueEvents.pitch: puts the venue on the Pitch List when it
 * isn't, adds the show's date); on a filled flag it asks whether to take this show off the pitch or the venue off the Pitch List.
 * The X marks the show Not a fit, again clears it. The wrapper carries data-pitched and data-take for tests.
 */
export function ShowActions({ e, take, pitches, venueName }: { e: Ev; take?: VenueEventNote; pitches: readonly { id: string; status: string; campaignId?: string | null; target?: { kind: string; id: string } }[]; venueName: string }) {
  const { call, error, busy } = useCommand();
  const fc = useFlagCampaign();
  /**
   * Pitch this (#82 S6): new pitches go in the page's campaign (asked on the first flag). A venue already pitched in another
   * campaign asks every time: keep the pitch there, or move it here (Q2).
   */
  async function pitchThis() {
    const into = await fc.ask();
    if (!into) return;
    const open = pitches.find((p) => p.target?.kind === "venue" && p.target.id === e.venueId && isActive(p.status));
    const keep = open ? await fc.keepOrMove(open, into, venueName) : "keep";
    if (!keep) return;
    const r = await call<{ pitchId: string }>("venueEvents.pitch", { eventId: e.id, ...campaignArg(into) });
    if (r && open && keep === "move") await call("pitches.setCampaign", { ids: [open.id], campaignId: into === ONGOING ? null : into });
  }
  const { name, artistId } = useArtist();
  const [asking, setAsking] = useState(false);
  const pitch = take?.pitchId ? pitches.find((p) => p.id === take.pitchId && isActive(p.status)) : undefined;
  const notFit = take?.take === "notFit";
  const done = (ok: unknown) => { if (ok) setAsking(false); };
  return (
    <span className="inline-flex items-center" title={`Only ${name} sees this`} data-testid={`venue-event-take-${e.id}`} data-pitched={pitch ? "1" : "0"} data-take={notFit ? "notFit" : ""}
      data-note-id={venueEventNoteId(artistId, e.id)}>
      <button type="button" className="flag-ic" data-flagged={pitch ? "1" : "0"} aria-pressed={!!pitch} disabled={busy}
        aria-label={pitch ? `On the Pitch List: ${venueName}` : "Pitch this"} title={pitch ? "On the pitch: click to remove" : `Pitch this: add it to ${venueName}'s pitch`}
        onClick={() => (pitch ? setAsking(true) : void pitchThis())} data-testid={`pitch-this-${e.id}`}><FlagIcon filled={!!pitch} /></button>
      <button type="button" className="flag-ic dismiss-ic" aria-pressed={notFit} data-on={notFit ? "1" : "0"} disabled={busy}
        aria-label={notFit ? "Not a fit (click to clear)" : "Not a fit"} title={notFit ? "Not a fit (click to clear)" : "Not a fit"}
        onClick={() => void call("venueEvents.setTake", { eventId: e.id, take: notFit ? null : "notFit" })} data-testid={`venue-event-notfit-${e.id}`}><XIcon size={16} /></button>
      {error && !asking && <span className="text-sm text-[var(--danger)]">{error}</span>}
      {asking && <Dialog open onClose={() => setAsking(false)} title="Remove from the pitch?" testid="unpitch-dialog">
        <p className="s m-0">{venueName}&apos;s pitch has this show ({fmtEventDay(e.date)}).</p>
        <div className="grid gap-2">
          <button type="button" className="btn ghost justify-start" disabled={busy} onClick={async () => done(await call("venueEvents.unpitch", { eventId: e.id }))} data-testid="unpitch-show">
            Remove this show from the pitch
          </button>
          <button type="button" className="btn ghost justify-start" disabled={busy} onClick={async () => done(pitch && await call("pitches.remove", { id: pitch.id }))} data-testid="unpitch-venue">
            Remove {venueName} from the Pitch List
          </button>
        </div>
        {error && <span className="text-sm text-[var(--danger)]">{error}</span>}
        <div className="flex flex-wrap justify-between gap-2">
          {pitch && <Link href={`/booking/pitches/${pitch.id}`} className="btn ghost" data-testid="unpitch-open">Open the pitch</Link>}
          <button type="button" className="btn acc" onClick={() => setAsking(false)} data-testid="unpitch-cancel">Keep it</button>
        </div>
      </Dialog>}
    </span>
  );
}

/** What a show's lineup line needs to know about each act: its Solo/Band tag and who may change it (the shared-edit rule). */
export type LineupAct = Pick<ActDoc, "lineup" | "createdBy"> & { adoptedAt?: unknown };

/**
 * An act's Solo / Band tag as a tiny pill. Clicking it steps unset → Band → Solo → unset (acts.update: the shared record), for
 * people who may edit the act; for anyone else it only shows a set value. Unset and editable, it reads "Solo or band?".
 */
export function LineupPill({ actId, act, testid }: { actId: string; act: LineupAct | undefined; testid?: string }) {
  const { call, busy, error } = useCommand();
  const can = useCanEditShared(act);
  const v = act?.lineup;
  const id = testid ?? `act-lineup-${actId}`;
  if (!can) return v ? <span className="chip" data-testid={id} data-lineup={v}>{LINEUP_LABEL[v]}</span> : null;
  return (
    <button type="button" className={`chip${v ? "" : " ghost"}`} disabled={busy} data-testid={id} data-lineup={v ?? ""}
      title={error ?? "Click to change: Band, Solo, or not set"} aria-label={`Solo or band: ${v ? LINEUP_LABEL[v] : "not set"}. Click to change.`}
      onClick={() => void call("acts.update", { id: actId, patch: { lineup: nextLineup(v) } })}>
      {v ? LINEUP_LABEL[v] : "Solo or band?"}
    </button>
  );
}

/** Above a show's note: each linked act on the bill with its Solo / Band pill (the act's name too when the bill has more than one). */
export function ShowLineups({ e, acts }: { e: Ev; acts: ReadonlyMap<string, LineupAct | undefined> }) {
  const linked = e.acts.filter((a): a is Act & { actId: string } => !!a.actId);
  const p = useProfile();
  // Platform admins and approved editors may set any act; anyone else sees only the tags already set (and their own acts' pills).
  const shown = linked.filter((a) => p.sharedEditor || p.platformAdmin || acts.get(a.actId)?.lineup || acts.get(a.actId)?.createdBy === p.uid);
  if (!shown.length) return null;
  return (
    <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid={`calendar-show-lineups-${e.id}`}>
      {shown.map((a) => (
        <span key={a.actId} className="inline-flex items-center gap-1">
          {linked.length > 1 && <span className="s">{a.name}</span>}
          <LineupPill actId={a.actId} act={acts.get(a.actId)} testid={`calendar-lineup-${e.id}-${a.actId}`} />
        </span>
      ))}
    </div>
  );
}
