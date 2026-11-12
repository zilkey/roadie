"use client";
/**
 * A venue's Events tab (issue #60): the room's upcoming shows as its own calendar lists them, with the bill, a badge when it
 * might need an opener (a guess: openerChance in src/lib/venueEvents.ts), and this band's take on each; past shows collapsed
 * below (who plays the room); the calendar source, when it last refreshed, the room's record ("Books openers: often"), and Refresh. No design-canvas board exists for this tab yet: it follows the venue page's cards.
 * Each show has the same pitch flag and Not a fit as Booking's Venue calendars (ShowActions). The upcoming shows are furthest out
 * first, under the same filters as Venue calendars (ShowFilterBar), remembered on their own.
 */
import { useMemo, useState } from "react";
import { useArtist } from "@/lib/artist";
import { useCollection, useDoc, useDocs } from "@/lib/firestore-hooks";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";
import { CardGroup, DetailCard } from "@/components/booking/DetailCards";
import { BOOKS_OPENERS_LABEL, CALENDAR_LABEL, booksOpeners, byWhen, calendarHref, eventTime, fmtClock, fmtEventDay, fmtEventYear, genreOptions, isUpcoming, latestFirst, openerChance, showListed, titleSaysMore, whenFrom, type OpenerCtx, type ShowFilter } from "@/lib/venueEvents";
import { ShowFilterBar, useShowFilter } from "@/components/booking/ShowFilters";
import { CalendarShowsTable } from "@/components/booking/CalendarShowsTable";
import { useOurGenres } from "@/components/booking/useOurGenres";
import { ActName, EventActs, EventBadges, EventPoster, OpenerNote, ShowActions, TicketLink, type Ev, type RoomRecord } from "@/components/booking/VenueEventBits";
import { dateInBandZone } from "@/lib/timezone";
import { CALENDAR_TYPES, PRESETS, type CalendarType, type ActDoc, type Venue, type VenueCalendar, type VenueEvent, type VenueEventNote, type VenueEventSource } from "@/schema";

function ago(iso?: string) {
  if (!iso) return "never";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function VenueEventsTab({ venue, admin }: { venue: Venue & { id: string }; admin: boolean }) {
  const { artistId } = useArtist();
  const events = useCollection<VenueEvent>("venueEvents", { where: [["venueId", "==", venue.id]], includeDeleted: true });
  const { doc: health } = useDoc<VenueEventSource>("venueEventSources", venue.id, { includeDeleted: true });
  const notes = useCollection<VenueEventNote>("venueEventNotes", { where: [["artistId", "==", artistId], ["venueId", "==", venue.id]], skip: !admin });
  const takes = useMemo(() => new Map((notes.rows ?? []).map((n) => [n.eventId, n])), [notes.rows]);
  const today = dateInBandZone();
  const all = useMemo(() => [...(events.rows ?? [])].sort(byWhen), [events.rows]);
  // Furthest out first, as Venue calendars sorts.
  const upcoming = useMemo(() => all.filter((e) => isUpcoming(e, today)).sort(latestFirst), [all, today]);
  const past = all.filter((e) => e.date < today).reverse();
  const [setup, setSetup] = useState(false);
  const cal = venue.calendar;
  const openers = useMemo(() => whoOpens(all), [all]);
  const pitches = useCollection<{ status: string; campaignId?: string; target: { kind: string; id: string } }>("pitches", { where: [["artistId", "==", artistId]], skip: !admin });
  // The headliners' looked-up genres: the genre filter, and genre fit when the band has genres of its own.
  const ours = useOurGenres();
  // Every act on the upcoming bills: the headliners' genres (filter, fit) and every act's link icons, as on Venue calendars.
  const actIds = useMemo(() => [...new Set(upcoming.flatMap((e) => e.acts.filter((a) => a.actId).map((a) => a.actId!)))], [upcoming]);
  const acts = useDocs<ActDoc>("acts", actIds);
  const actGenres = useMemo(() => new Map(acts.rows.map((a) => [a.id, a.genres])), [acts.rows]);
  const actLinks = useMemo(() => new Map(acts.rows.map((a) => [a.id, a.links])), [acts.rows]);
  const genres = useMemo(() => (ours.length ? { ours, acts: actGenres } : null), [ours, actGenres]);
  const genreChoices = useMemo(() => genreOptions(ours, actGenres.values()), [ours, actGenres]);
  const [f, setF] = useShowFilter("venueEventsShows", {});
  const change = (patch: Partial<ShowFilter>) => setF({ ...f, ...patch });
  const from = whenFrom(today, f.when);
  const shown = upcoming.filter((e) => showListed(e, { ...f, hideNotFit: admin && f.hideNotFit }, { from, take: takes.get(e.id)?.take, acts: actGenres, chance: () => openerChance(e, health, today, genres).chance }));

  return (
    <>
      <CardGroup kind="shared">
        <SourceCard venue={venue} cal={cal} health={health} admin={admin} onSetup={() => setSetup(true)} />
        {cal?.type !== "manual" && (
          <DetailCard title={`Upcoming shows${events.rows ? ` (${shown.length === upcoming.length ? upcoming.length : `${shown.length} of ${upcoming.length}`})` : ""}`} testid="venue-events-upcoming">
            {!!upcoming.length && <div className="mb-3"><ShowFilterBar f={f} onChange={change} genres={genreChoices} canTake={admin} testid="venue-events-filter" /></div>}
            {!events.rows ? <div className="s">Loading…</div>
              : upcoming.length === 0 ? <div className="empty" data-testid="venue-events-empty">{cal ? "No upcoming shows on the venue's calendar." : "Shows appear here once the venue's calendar is set up."}</div>
              : shown.length === 0 ? <div className="empty" data-testid="venue-events-none">No upcoming shows here match these filters.</div>
              : <div data-testid="venue-events-list"><CalendarShowsTable shows={shown} venues={new Map([[venue.id, venue]])} takes={takes} pitches={pitches.rows ?? []} records={new Map([[venue.id, health]])}
                  today={today} genres={genres} actGenres={actGenres} actLinks={actLinks} showVenue={false} admin={admin} /></div>}
            {!!upcoming.length && <div className="mt-3"><OpenerNote /></div>}
          </DetailCard>
        )}
        {openers.length > 0 && (
          <DetailCard title="Who opens here" testid="venue-openers" headerExtra={<span className="s">Support acts on the calendar</span>}>
            <div className="grid gap-1">
              {openers.map((o) => (
                <div key={o.key} className="flex flex-wrap items-baseline gap-x-2 text-sm" data-testid={`venue-opener-${o.key}`}>
                  <b><ActName a={o.act} /></b>
                  <span className="s">{o.count} show{o.count === 1 ? "" : "s"} · {o.last >= today ? "next" : "last"} {o.last >= today ? fmtEventDay(o.last) : fmtEventYear(o.last)}</span>
                </div>
              ))}
            </div>
          </DetailCard>
        )}
        {past.length > 0 && (
          <DetailCard title={`Past shows (${past.length})`} testid="venue-events-past">
            <details>
              <summary className="cursor-pointer text-sm font-semibold" data-testid="venue-events-past-toggle">Who has played here</summary>
              <div className="mt-2 grid gap-1">
                {past.map((e) => (
                  <div key={e.id} className="flex flex-wrap items-baseline gap-x-3 text-sm" data-testid={`venue-event-past-${e.id}`}>
                    <b className="whitespace-nowrap">{fmtEventYear(e.date)}</b>
                    <span>{e.acts.length ? e.acts.map((a, i) => <span key={`${i}-${a.name}`}>{i > 0 && ", "}<ActName a={a} /></span>) : e.title}</span>
                  </div>
                ))}
              </div>
            </details>
          </DetailCard>
        )}
      </CardGroup>
      {admin && <CalendarSetup venue={venue} open={setup} onClose={() => setSetup(false)} />}
    </>
  );
}

/**
 * "Who opens here" (#77): the acts seen in support slots at this room, most often first. Each with how many shows and its next one
 * (or, with none coming, its last). Gone shows don't count.
 */
function whoOpens(events: Ev[]) {
  const today = dateInBandZone();
  const by = new Map<string, { key: string; act: Ev["acts"][number]; count: number; next?: string; latest: string }>();
  for (const e of events) {
    if (e.status === "gone") continue;
    for (const a of e.acts) {
      if (a.role !== "support" || !a.actId) continue; // acts only: not "with", "& More!"
      const key = a.actId;
      const o = by.get(key) ?? { key, act: a, count: 0, latest: e.date };
      o.count++;
      if (e.date >= today && (!o.next || e.date < o.next)) o.next = e.date;
      if (e.date > o.latest) o.latest = e.date;
      by.set(key, o);
    }
  }
  return [...by.values()].map((o) => ({ ...o, last: o.next ?? o.latest }))
    .sort((x, y) => y.count - x.count || y.latest.localeCompare(x.latest) || x.act.name.localeCompare(y.act.name));
}

function SourceCard({ venue, cal, health, admin, onSetup }: { venue: Venue & { id: string }; cal?: VenueCalendar; health: VenueEventSource | null; admin: boolean; onSetup(): void }) {
  const { call, error, busy } = useCommand();
  const href = cal ? calendarHref(cal) : undefined;
  const broken = !!health?.lastError;
  const zero = !broken && health?.lastSuccessAt && health.lastCount === 0;
  return (
    <DetailCard title="Calendar" testid="venue-calendar-card" headerExtra={admin ? <button type="button" className="btn ghost sm" onClick={onSetup} data-testid="venue-calendar-setup">{cal ? "Change source" : "Set up"}</button> : undefined}>
      <ErrorBox error={error} />
      {!cal ? <div className="s" data-testid="venue-calendar-none">No calendar set up for this venue.</div>
        : cal.type === "manual" ? <div data-testid="venue-calendar-manual">{cal.note}</div>
        : (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span data-testid="venue-calendar-type">{CALENDAR_LABEL[cal.type]}</span>
              {href && <a className="underline text-sm" href={href} target="_blank" rel="noreferrer">Open the calendar ↗</a>}
            </div>
            <div className="s" data-testid="venue-calendar-health">
              {health ? <>Refreshed {ago(health.lastSuccessAt ?? health.lastRunAt)}{health.lastCount !== undefined ? ` · found ${health.lastCount} show${health.lastCount === 1 ? "" : "s"}` : ""}</> : "Not refreshed yet."}
            </div>
            {health?.lastSuccessAt && <div className="s" data-testid="venue-calendar-openers" title="From the shows on its calendar whose bill is settled (past, under 2 weeks out, or a calendar that lists support acts)">Books openers: {BOOKS_OPENERS_LABEL[booksOpeners(health)]}{booksOpeners(health) !== "unknown" ? ` (${Math.round((health.supportShare ?? 0) * 100)}% of ${health.billsSeen} show${health.billsSeen === 1 ? "" : "s"})` : ""}</div>}
            {broken && <div className="d-warn" role="note" data-testid="venue-calendar-error"><span><b>The calendar didn&apos;t load last time.</b> {health!.lastError}</span></div>}
            {zero && <div className="d-warn" role="note" data-testid="venue-calendar-zero"><span>The calendar answered but no shows came through. It may have changed; check the source.</span></div>}
            {!!health?.lastUnparsed && <div className="s" data-testid="venue-calendar-unparsed">{health.lastUnparsed} listing{health.lastUnparsed === 1 ? "" : "s"} had a date Roadie couldn&apos;t read.</div>}
            <div><button type="button" className="btn ghost sm" disabled={busy} data-testid="venue-calendar-refresh" onClick={() => call("venueEvents.refresh", { venueId: venue.id })}>{busy ? "Refreshing…" : "Refresh"}</button></div>
          </div>
        )}
    </DetailCard>
  );
}

// ---------- setting a calendar up ----------

type Preview = { count: number; unparsed: number; dropped: number; raw: number; events: Omit<VenueEvent, "id" | "venueId" | "source" | "firstSeenAt" | "lastSeenAt">[]; notes?: string; calendar?: VenueCalendar };

const URL_FIELD: Partial<Record<CalendarType, "url" | "baseUrl" | "siteId" | "slug" | "organizerId" | "note">> = {
  squarespace: "url", ics: "url", jsonld: "url", plot: "url", wix: "url", selectors: "url", tribe: "baseUrl", aeg: "siteId", "venue-network": "slug", eventbrite: "organizerId", manual: "note",
};
const FIELD_LABEL = { url: "Calendar URL", baseUrl: "Site address", siteId: "AEG site id", slug: "venue.network slug", organizerId: "Eventbrite organizer id", note: "What the venue has instead" };

/** Pick how the calendar is read, try it (Gemini proposes selectors for a plain page), look at the rows, then Save. */
function CalendarSetup({ venue, open, onClose }: { venue: Venue & { id: string }; open: boolean; onClose(): void }) {
  const start = venue.calendar;
  const [type, setType] = useState<CalendarType>(start?.type ?? "selectors");
  const [main, setMain] = useState<string>(() => (start ? String((start as Record<string, unknown>)[URL_FIELD[start.type]!] ?? "") : venue.website ?? ""));
  const [category, setCategory] = useState(start?.type === "tribe" ? start.category ?? "" : "");
  const sel = start?.type === "selectors" ? start : undefined;
  const [preset, setPreset] = useState<string>(sel?.preset ?? "");
  const [selectors, setSelectors] = useState(sel?.item ? JSON.stringify({ item: sel.item, fields: sel.fields, ...(sel.dateFormat ? { dateFormat: sel.dateFormat } : {}) }, null, 1) : "");
  const f = start && "filter" in start ? start.filter : undefined;
  const [venueName, setVenueName] = useState(f?.venueName ?? "");
  const [include, setInclude] = useState(f?.include ?? "");
  const [exclude, setExclude] = useState(f?.exclude ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const { call, error, busy } = useCommand();

  function build(): VenueCalendar | null {
    setParseError(null);
    const filter = { ...(venueName.trim() ? { venueName: venueName.trim() } : {}), ...(include.trim() ? { include: include.trim() } : {}), ...(exclude.trim() ? { exclude: exclude.trim() } : {}) };
    const fl = Object.keys(filter).length ? { filter } : {};
    const v = main.trim();
    switch (type) {
      case "manual": return { type, note: v };
      case "tribe": return { type, baseUrl: v, ...(category.trim() ? { category: category.trim() } : {}), ...fl };
      case "aeg": return { type, siteId: v, ...fl };
      case "venue-network": return { type, slug: v, ...fl };
      case "eventbrite": return { type, organizerId: v, ...fl };
      case "selectors": {
        let s: Record<string, unknown> = {};
        if (selectors.trim()) { try { s = JSON.parse(selectors); } catch { setParseError("The selectors aren't valid JSON."); return null; } }
        return { type, url: v, ...(preset ? { preset: preset as (typeof PRESETS)[number] } : {}), ...s, ...fl } as VenueCalendar;
      }
      default: return { type, url: v, ...fl } as VenueCalendar;
    }
  }
  async function suggest() {
    const r = await call<Preview>("venueEvents.suggestSelectors", { venueId: venue.id, url: main.trim() });
    if (!r?.calendar || r.calendar.type !== "selectors") return;
    setSelectors(JSON.stringify({ item: r.calendar.item, fields: r.calendar.fields, ...(r.calendar.dateFormat ? { dateFormat: r.calendar.dateFormat } : {}) }, null, 1));
    setPreview(r);
  }
  async function tryIt() { const c = build(); if (c && c.type !== "manual") setPreview((await call<Preview>("venueEvents.preview", { venueId: venue.id, calendar: c })) ?? null); }
  async function save() {
    const c = build();
    if (!c) return;
    if (!(await call("venues.setCalendar", { id: venue.id, calendar: c }))) return;
    if (c.type !== "manual") await call("venueEvents.refresh", { venueId: venue.id });
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title={`${venue.name}'s calendar`} testid="calendar-setup">
      <p className="s">Shared with every band on Roadie. Roadie reads this calendar when someone presses Refresh.</p>
      <label className="grid gap-1"><span className="text-sm font-semibold">How it&apos;s read</span>
        <select className="select" value={type} onChange={(e) => { setType(e.target.value as CalendarType); setPreview(null); }} data-testid="calendar-type">
          {CALENDAR_TYPES.map((t) => <option key={t} value={t}>{CALENDAR_LABEL[t]}</option>)}
        </select>
      </label>
      <label className="grid gap-1"><span className="text-sm font-semibold">{FIELD_LABEL[URL_FIELD[type]!]}</span>
        <input className="input" value={main} onChange={(e) => setMain(e.target.value)} data-testid="calendar-main" />
      </label>
      {type === "tribe" && <label className="grid gap-1"><span className="text-sm font-semibold">Category (optional)</span><input className="input" value={category} onChange={(e) => setCategory(e.target.value)} /></label>}
      {type === "selectors" && (
        <>
          <label className="grid gap-1"><span className="text-sm font-semibold">Shared template</span>
            <select className="select" value={preset} onChange={(e) => setPreset(e.target.value)} data-testid="calendar-preset">
              <option value="">None: this page&apos;s own selectors</option>
              {PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          {!preset && (
            <div className="grid gap-1">
              <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">Selectors</span>
                <button type="button" className="btn ghost sm" disabled={busy || !main.trim()} onClick={suggest} data-testid="calendar-suggest">{busy ? "Asking Gemini…" : "Suggest with Gemini"}</button></div>
              <textarea className="input font-mono text-xs" rows={7} value={selectors} onChange={(e) => setSelectors(e.target.value)} data-testid="calendar-selectors" />
            </div>
          )}
        </>
      )}
      {type !== "manual" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="grid gap-1"><span className="text-sm font-semibold">Room name on the page</span><input className="input" value={venueName} onChange={(e) => setVenueName(e.target.value)} placeholder="Only for shared pages" /></label>
          <label className="grid gap-1"><span className="text-sm font-semibold">Keep titles matching</span><input className="input" value={include} onChange={(e) => setInclude(e.target.value)} placeholder="music|live" /></label>
          <label className="grid gap-1"><span className="text-sm font-semibold">Drop titles matching</span><input className="input" value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="trivia|yoga" /></label>
        </div>
      )}
      <ErrorBox error={parseError ?? error} />
      {preview && (
        <div className="grid gap-1" data-testid="calendar-preview">
          <span className="text-sm font-semibold">{preview.count} show{preview.count === 1 ? "" : "s"} found{preview.unparsed ? `, ${preview.unparsed} with dates Roadie couldn't read` : ""}{preview.dropped ? `, ${preview.dropped} left out (not music, or another room)` : ""}</span>
          {preview.notes && <span className="s">Gemini: {preview.notes}</span>}
          <div className="max-h-64 overflow-auto rounded border border-[var(--divider)] text-sm">
            {preview.events.map((e) => <div key={e.sourceId} className="border-b border-[var(--divider)] px-2 py-1"><b>{fmtEventDay(e.date)}</b> {fmtClock(e.start)} · {e.acts.length ? e.acts.map((a) => `${a.name}${a.role === "support" ? " (support)" : ""}`).join(", ") : e.title}</div>)}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {type !== "manual" && <button type="button" className="btn ghost" disabled={busy || !main.trim()} onClick={tryIt} data-testid="calendar-try">Try it</button>}
        <button type="button" className="btn acc" disabled={busy || !main.trim()} onClick={save} data-testid="calendar-save">Save</button>
        <button type="button" className="btn ghost" onClick={onClose} data-testid="calendar-cancel">Cancel</button>
      </div>
    </Dialog>
  );
}
