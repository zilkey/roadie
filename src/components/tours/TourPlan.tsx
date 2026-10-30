"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "@/lib/artist";
import { ErrorBox } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { PlusButton } from "@/components/InlineValue";
import { PickDialog } from "@/components/booking/PickDialog";
import { useBooking } from "@/components/booking/common";
import { toast, UNDO_MS } from "@/components/Toasts";
import { CommandError, newMutationId, runCommand, runCommandFull } from "@/lib/commands";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { STATUS_LABEL, isActive, todayStr } from "@/lib/booking";
import { addDays, fmtTime, showCity, showName } from "@/lib/shows";
import { dayLabel, driveText, planStats, routeTowns, tourDays, type EntryLike, type TourWarning } from "@/lib/tours";
import type { Show, TourEntry } from "@/schema";
import { townOf, type TourRow } from "./common";
import { BookDialog, type BookTarget } from "./BookDialog";
import { EntryModal, type EntryKind, type EntryTarget } from "./EntryModal";
import { GripIcon, TourTray, type Drag } from "./TourTray";
import { AddSheet } from "./AddSheet";

type Entry = Row<TourEntry>;
type Slot = { after?: string; before?: string };
/** Where a drag is over: a day (its end, or above / below one entry), or the No date yet bucket. */
type Over = { date: string | null; id?: string; side?: "above" | "below" };
/** A modal while it is open: new at a slot, or an existing entry by id (read live from the entries). */
type Open = { kind: EntryKind; date: string; slot: Slot } | { id: string };

/**
 * The Plan tab (the "Tour page · Plan tab" board): stat pills, the "Add to tour" tray, the "No date yet" bucket, and the days.
 * Each day lists its entries by position; a + between two entries (or on an empty day) offers Drive… / Stay… / Note… / Pitch
 * a venue for this date…, and a drive, stay or note opens its modal (EntryModal). Gaps from tours.summary show where they bite:
 * "No stay tonight" is the unfinished box with "Add a stay". Admins drag tray rows, chips and entries onto days
 * (tours.addPitch / addShow / entries.move); every change has an Undo toast. Members see the band's entries only: no bucket,
 * no options, no tray, nothing to change. A Done tour is history: no tray, no bucket and no phone + sheet (`planning`), the days full width.
 */
export function TourPlan({ tour, admin, extend }: { tour: TourRow; admin: boolean; extend(patch: { startDate?: string; endDate?: string }): Promise<boolean> }) {
  const entriesQ = useCollection<TourEntry>(`tours/${tour.id}/entries`, admin ? {} : { where: [["visibility", "==", "band"]] });
  const entries = useMemo(() => entriesQ.rows ?? [], [entriesQ.rows]);
  const showsQ = useCollection<Show>("shows");
  const shows = useMemo(() => new Map((showsQ.rows ?? []).map((s) => [s.id, s])), [showsQ.rows]);
  const booking = useBooking();
  const pitches = useMemo(() => new Map(booking.pitches.map((p) => [p.id, p])), [booking.pitches]);
  const venues = useMemo(() => new Map(booking.venues.map((v) => [v.id, v])), [booking.venues]);
  const planning = admin && tour.status !== "done";
  const { days, bucket } = useMemo(() => tourDays(tour, entries as unknown as (EntryLike & Entry)[]), [tour, entries]);

  // Warnings are the server's (tours.summary), fetched again whenever the plan or a show's date or times change.
  const [warnings, setWarnings] = useState<TourWarning[]>([]);
  const key = JSON.stringify([tour.startDate, tour.endDate, entries.map((e) => [e.id, e.date, e.position, e.nights, e.minutes, e.leaveBy, e.roundTrip]),
    entries.filter((e) => e.showId).map((e) => [shows.get(e.showId!)?.date, shows.get(e.showId!)?.times?.loadIn])]);
  useEffect(() => {
    if (entriesQ.loading) return;
    let live = true;
    runCommand<{ warnings: TourWarning[] }>("tours.summary", { id: tour.id }).then((s) => live && setWarnings(s.warnings), () => undefined);
    return () => { live = false; };
  }, [key, tour.id, entriesQ.loading]);

  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [book, setBook] = useState<BookTarget | null>(null);
  const [pick, setPick] = useState<{ date: string | null } | null>(null);
  const [sheet, setSheet] = useState<string | null>(null); // phone: the day whose + sheet is open
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  const endDrag = () => { setDrag(null); setOver(null); };

  /** One change: a command with an Undo toast; errors show over the plan. */
  async function act<T>(name: string, input: unknown, text: string): Promise<T | undefined> {
    setError(null);
    try {
      const out = await runCommandFull<T>(name, input, { clientMutationId: newMutationId() });
      toast({ key: `${name}:${out.runId}`, text, undoRunId: out.runId, ms: UNDO_MS });
      return out.result;
    } catch (e) { setError((e as CommandError).message); }
  }

  const entryName = (e: Entry) => e.kind === "show" ? (shows.get(e.showId!) ? showName(shows.get(e.showId!)!) : "the show")
    : e.kind === "option" ? pitches.get(e.pitchId!)?.target.name ?? "the pitch" : e.kind === "stay" ? e.name ?? "the stay" : e.kind === "drive" ? "the drive" : "the note";
  function remove(e: Entry) {
    const what = entryName(e);
    if (e.kind === "show") return act("tours.removeItem", { tourId: tour.id, showId: e.showId }, `Took ${what} off the tour`);
    if (e.kind === "option" && !e.date) return act("tours.removeItem", { tourId: tour.id, pitchId: e.pitchId }, `Took ${what} off the tour`);
    if (e.kind === "option") return act("tours.entries.remove", { tourId: tour.id, id: e.id }, `Took ${dayLabel(e.date!)} off ${what}'s dates`);
    return act("tours.entries.remove", { tourId: tour.id, id: e.id }, `Removed ${what}`);
  }

  /** Where the last drive before this slot ended (else the tour's start): a new drive starts there. */
  function lastPlace(date: string, slot: Slot) {
    const day = (days.find((d) => d.date === date)?.entries ?? []) as Entry[];
    const cut = slot.before ? day.findIndex((x) => x.id === slot.before) : slot.after ? day.findIndex((x) => x.id === slot.after) + 1 : day.length;
    const earlier = [...days.filter((d) => d.date < date).flatMap((d) => d.entries as Entry[]), ...day.slice(0, cut)];
    return [...earlier].reverse().find((e) => e.kind === "drive" && e.to)?.to ?? tour.leavingFrom;
  }

  function startNew(kind: EntryKind | "pitch", date: string, slot: Slot) {
    if (kind === "pitch") setPick({ date });
    else setOpen({ kind, date, slot });
  }

  async function drop(date: string | null, slot: Slot) {
    const d = drag;
    endDrag();
    if (!d) return;
    if (d.type === "entry") {
      if (slot.after === d.id || slot.before === d.id) return;
      if (d.kind === "show" && date !== d.date) { setError("A show's date is the show's: change it on the show."); return; }
      if (!date && d.kind !== "option") return;
      await act("tours.entries.move", { tourId: tour.id, id: d.id, date, ...slot }, "Moved it");
    } else if (d.type === "chip") {
      if (date) setOpen({ kind: d.kind, date, slot });
    } else await add(d, date);
  }

  /** A venue, pitch or show onto the tour: a venue or pitch offering `date` (none: as it is, or No date yet), a show on its own date. */
  function add(d: Extract<Drag, { type: "venue" | "pitch" | "show" }>, date: string | null) {
    if (d.type === "show") return act("tours.addShow", { tourId: tour.id, showId: d.id }, `Put ${d.name} on the tour`);
    return act("tours.addPitch", { tourId: tour.id, [d.type === "venue" ? "venueId" : "pitchId"]: d.id, dates: date ? [date] : [] },
      date ? `Pitching ${d.name} for ${dayLabel(date)}` : `Put ${d.name} on the tour`);
  }

  // Drag targets. A row splits at its middle: the top half drops above it, the bottom half below.
  const rowDrop = (date: string, e: Entry) => !admin ? {} : {
    "data-drag-row": "",
    "data-drag": drag?.type === "entry" && drag.id === e.id ? "from" : over?.id === e.id ? over.side : undefined,
    onDragOver: (ev: React.DragEvent<HTMLElement>) => {
      if (!drag) return;
      ev.preventDefault(); ev.stopPropagation();
      const r = ev.currentTarget.getBoundingClientRect();
      const side = ev.clientY < r.top + r.height / 2 ? "above" : "below";
      if (over?.id !== e.id || over.side !== side) setOver({ date, id: e.id, side });
    },
    onDrop: (ev: React.DragEvent<HTMLElement>) => { ev.preventDefault(); ev.stopPropagation(); void drop(date, over?.id === e.id && over.side === "above" ? { before: e.id } : { after: e.id }); },
  };
  const areaDrop = (date: string | null) => !admin ? {} : {
    "data-over": over && over.date === date && !over.id ? "" : undefined,
    onDragOver: (ev: React.DragEvent<HTMLElement>) => {
      if (!drag || (date === null && !(drag.type === "venue" || drag.type === "pitch" || (drag.type === "entry" && drag.kind === "option")))) return;
      ev.preventDefault();
      if (over?.date !== date || over.id) setOver({ date });
    },
    onDragLeave: (ev: React.DragEvent<HTMLElement>) => { if (!ev.currentTarget.contains(ev.relatedTarget as Node)) setOver(null); },
    onDrop: (ev: React.DragEvent<HTMLElement>) => { ev.preventDefault(); void drop(date, {}); },
  };
  const entryDrag = (e: Entry) => !admin ? {} : {
    draggable: true,
    onDragStart: (ev: React.DragEvent<HTMLElement>) => { ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", e.id); setDrag({ type: "entry", id: e.id, kind: e.kind, date: e.date }); },
    onDragEnd: endDrag,
  };

  const stats = planStats(entries as unknown as EntryLike[], warnings);
  const noStay = new Set(warnings.filter((w) => w.kind === "noStay").map((w) => w.date));
  const openDate = new Set(warnings.filter((w) => w.kind === "openDate").map((w) => w.date));
  const longDrive = new Set(warnings.filter((w) => w.kind === "longDrive").map((w) => w.entryId));
  const towns = useMemo(() => routeTowns(
    [tour.leavingFrom, ...entries.flatMap((e) => [e.from, e.to, e.address])],
    entries.flatMap((e) => [e.showId ? (shows.get(e.showId) ? showCity(shows.get(e.showId)!) : undefined) : undefined, e.pitchId ? cityOfPitch(e.pitchId) : undefined]),
  ), [tour.leavingFrom, entries, shows, pitches, venues]); // eslint-disable-line react-hooks/exhaustive-deps
  function cityOfPitch(pitchId: string) {
    const t = pitches.get(pitchId)?.target;
    return t?.kind === "venue" ? venues.get(t.id)?.address.city : undefined;
  }
  /** The town a day ends in: its last show, drive or stay. */
  function townOfDay(es: Entry[]) {
    for (const e of [...es].reverse()) {
      if (e.kind === "show" && shows.get(e.showId!)) return showCity(shows.get(e.showId!)!);
      if (e.kind === "drive" && e.to) return townOf(e.to);
      if (e.kind === "stay" && e.address) return townOf(e.address);
    }
    return undefined;
  }

  const first = days[0]?.date, last = days[days.length - 1]?.date;
  const modalTarget: EntryTarget | null = !open ? null
    : "id" in open ? (() => { const e = entries.find((x) => x.id === open.id); return e ? { kind: e.kind as EntryKind, tourId: tour.id, entry: e } : null; })()
    : { kind: open.kind, tourId: tour.id, date: open.date, ...open.slot, ...(open.kind === "drive" ? { from: lastPlace(open.date, open.slot) } : {}) };
  const tourPitchIds = new Set(entries.filter((e) => e.pitchId).map((e) => e.pitchId));

  return (
    <div className="grid gap-5" data-testid="tour-plan">
      <div className="flex flex-wrap gap-2" data-testid="plan-stats">
        <span className="tp-stat" data-testid="plan-stat-shows">{stats.shows} {stats.shows === 1 ? "show" : "shows"} booked</span>
        {admin && <span className="tp-stat" data-testid="plan-stat-open">{stats.openDates} open {stats.openDates === 1 ? "date" : "dates"} · {stats.options} {stats.options === 1 ? "option" : "options"}</span>}
        {stats.attention.map((a) => (
          <a key={a.kind} href={a.date ? `#day-${a.date}` : undefined} className="tp-stat warn" data-testid={`plan-stat-${a.kind}`}>{a.text}</a>
        ))}
        {stats.driving && <span className="tp-stat" data-testid="plan-stat-driving">{stats.driving}</span>}
      </div>
      <ErrorBox error={error} />

      <div className="tp-cols">
        {planning && (
          <TourTray tourId={tour.id} venues={booking.venues} pitches={booking.pitches} shows={showsQ.rows ?? []} towns={towns} today={todayStr()}
            onDrag={(d) => (d ? setDrag(d) : endDrag())} onAdd={(d) => void add(d, null)} />
        )}

        <div className="grid min-w-0 flex-[999_1_480px] content-start gap-5">
          {planning && (
            <section className="d-card" aria-labelledby="bucket-h" data-testid="plan-bucket" {...areaDrop(null)}>
              <div className="d-ch">
                <h2 id="bucket-h" className="d-ct">No date yet <span className="font-medium text-muted">· {bucket.length}</span></h2>
                <PlusButton label="Add a pitch with no date" onClick={() => setPick({ date: null })} testid="plan-bucket-add" />
              </div>
              {bucket.length === 0
                ? <span className="text-[0.875rem] text-muted">Pitches with no date land here. Drag one onto a day to offer that date.</span>
                : <div className="grid gap-2">
                  {bucket.map((e) => {
                    const p = pitches.get(e.pitchId!);
                    const city = cityOfPitch(e.pitchId!);
                    return (
                      <div key={e.id} className="tp-ent opt" data-testid="plan-bucket-row" {...entryDrag(e)}>
                        <Link href={`/booking/pitches/${e.pitchId}`} className="tp-open">
                          <span className="tp-main"><span className="tp-nm">{p?.target.name ?? "Pitch"}</span><span className="tp-sub">{[city, p ? STATUS_LABEL[p.status] : ""].filter(Boolean).join(" · ")}</span></span>
                          <span className="tp-chev" aria-hidden>›</span>
                        </Link>
                        <XButton label={`Take ${p?.target.name ?? "the pitch"} off the tour`} onClick={() => void remove(e)} />
                      </div>
                    );
                  })}
                </div>}
            </section>
          )}

          <section className="d-card" aria-labelledby="days-h" data-testid="plan-days">
            <div className="d-ch">
              <h2 id="days-h" className="d-ct">Days{first && <span className="font-medium text-muted">· {first === last ? dayLabel(first) : `${dayLabel(first)} – ${dayLabel(last!)}`}</span>}</h2>
              {admin && first && <button type="button" className="btn ghost sm" onClick={() => void extend({ startDate: addDays(first, -1), ...(tour.endDate ? {} : { endDate: last }) })} data-testid="plan-day-before">+ Day before</button>}
            </div>
            {days.length === 0 && (
              <div className="empty" data-testid="plan-no-days">
                <span>No days yet. Set the tour&apos;s dates on the Info tab{admin ? ", or drag a pitch or show here" : ""}.</span>
              </div>
            )}
            {days.map((d) => {
              const es = d.entries as Entry[];
              const options = es.filter((e) => e.kind === "option");
              const town = townOfDay(es);
              const sub = [town, openDate.has(d.date) && admin ? "open" : ""].filter(Boolean).join(" · ");
              const plus = (i: number) => admin && (
                <PlusSlot key={`plus-${i}`} testid={`plan-plus-${d.date}-${i}`} date={d.date} after={es[i - 1]} before={es[i]} name={entryName} onPick={(k) => startNew(k, d.date, { after: es[i - 1]?.id, before: es[i]?.id })} />
              );
              return (
                <div key={d.date} id={`day-${d.date}`} className="tp-day" data-testid={`plan-day-${d.date}`}>
                  <div className="tp-dlab"><div><b>{dayLabel(d.date)}</b>{sub && <span>{sub}</span>}</div>
                    {planning && <button type="button" className="tp-dadd tp-phone" aria-label={`Add to ${dayLabel(d.date)}`} onClick={() => setSheet(d.date)} data-testid={`plan-day-add-${d.date}`}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg></button>}</div>
                  <div className="tp-dlist" {...areaDrop(d.date)}>
                    {es.length === 0 && (
                      <div className="tp-empty">
                        Nothing yet.{admin && <span className="tp-desk"> Drag something here, or <PlusMenu testid={`plan-plus-${d.date}-0`} label={`Add on ${dayLabel(d.date)}`} onPick={(k) => startNew(k, d.date, {})}
                          trigger={<span className="text-[0.8125rem] font-bold">+ Add</span>} triggerClass="btn ghost sm" /></span>}
                      </div>
                    )}
                    {es.length > 0 && plus(0)}
                    {es.map((e, i) => [
                      <EntryRow key={e.id} e={e} admin={admin} show={e.showId ? shows.get(e.showId) : undefined} pitch={e.pitchId ? pitches.get(e.pitchId) : undefined}
                        city={e.pitchId ? cityOfPitch(e.pitchId) : undefined} rank={options.indexOf(e) + 1} long={longDrive.has(e.id)}
                        onOpen={() => setOpen({ id: e.id })} onBook={() => setBook({ tourId: tour.id, entry: e })} onRemove={() => void remove(e)} drag={{ ...entryDrag(e), ...rowDrop(d.date, e) }} />,
                      plus(i + 1),
                    ])}
                    {noStay.has(d.date) && (
                      <div className="todo row tp-gap-box" data-testid="plan-no-stay">
                        <b>No stay tonight.</b>
                        {admin && <button type="button" className="btn ghost sm" onClick={() => setOpen({ kind: "stay", date: d.date, slot: { after: es[es.length - 1]?.id } })} data-testid="plan-add-stay">Add a stay</button>}
                      </div>
                    )}
                    {admin && over?.date === d.date && drag && (drag.type === "venue" || drag.type === "pitch") && (
                      <div className="tp-drop-hint" data-testid="plan-drop-hint"><b>{drag.name}</b><span className="text-muted">{drag.type === "venue" ? "Drop to start a pitch offering" : "Drop to offer"} {dayLabel(d.date)}</span></div>
                    )}
                  </div>
                </div>
              );
            })}
            {admin && last && (
              <div className="border-t border-divider pt-3">
                <button type="button" className="btn ghost sm" onClick={() => void extend({ endDate: addDays(last, 1), ...(tour.startDate ? {} : { startDate: first }) })} data-testid="plan-day-after">+ Day after</button>
              </div>
            )}
          </section>
        </div>
      </div>

      {planning && <AddSheet date={sheet} town={sheet ? townOfDay((days.find((x) => x.date === sheet)?.entries ?? []) as Entry[]) : undefined} towns={towns}
        venues={booking.venues} pitches={booking.pitches} tourId={tour.id} onAdd={(d, date) => void add(d, date)} onClose={() => setSheet(null)}
        onTravel={(kind, date) => { const es = (days.find((x) => x.date === date)?.entries ?? []) as Entry[]; setSheet(null); setOpen({ kind, date, slot: { after: es[es.length - 1]?.id } }); }} />}
      <EntryModal target={modalTarget} admin={admin} onClose={() => setOpen(null)} />
      {admin && <BookDialog target={book} entries={entries} nameOf={(id) => pitches.get(id)?.target.name ?? "the pitch"} cityOf={cityOfPitch} onClose={() => setBook(null)} />}
      {admin && (
        <PickDialog open={!!pick} onClose={() => setPick(null)} testid="plan-pick"
          title={pick?.date ? `Pitch a venue for ${dayLabel(pick.date)}` : "Add a pitch with no date"}
          subtitle={pick?.date ? "Uses the band's open pitch for the room, or starts one." : "Its own dates come along; with none, it waits in No date yet."}
          findLabel={pick?.date ? "Find a venue" : "Find a pitch"} placeholder="Name or city" busy={false} error={error}
          addLabel={pick?.date ? "Pitch it" : "Add pitch"}
          items={pick?.date
            ? booking.venues.map((v) => ({ id: v.id, name: v.name, sub: `${v.address.city}, ${v.address.state}` }))
            : booking.pitches.filter((p) => isActive(p.status) && !tourPitchIds.has(p.id)).map((p) => ({ id: p.id, name: p.target.name, sub: [cityOfPitch(p.id), STATUS_LABEL[p.status]].filter(Boolean).join(" · ") }))}
          onPick={async (id) => {
            const name = pick?.date ? venues.get(id)?.name ?? "the venue" : pitches.get(id)?.target.name ?? "the pitch";
            return !!(await add({ type: pick?.date ? "venue" : "pitch", id, name }, pick?.date ?? null));
          }} />
      )}
    </div>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  drive: <path d="M5 17h14M6 17l1.5-6h9L18 17M7.5 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM16.5 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />,
  stay: <path d="M3 18V8M3 14h18v4M21 14v-2a3 3 0 00-3-3h-7v5" />,
  note: <path d="M5 4h14v16H5zM9 9h6M9 13h6" />,
  show: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
};

/** One entry on a day. Shows open the show page and options the pitch; drives, stays and notes open their modal (members just read them). */
function EntryRow({ e, admin, show, pitch, city, rank, long, onOpen, onBook, onRemove, drag }: {
  e: Entry; admin: boolean; show?: Row<Show>; pitch?: { target: { name: string }; status: string; dates?: string[] }; city?: string; rank: number; long: boolean;
  onOpen(): void; onBook(): void; onRemove(): void; drag: Record<string, unknown>;
}) {
  const icon = ICONS[e.kind] && <span className={`tp-ico${e.kind === "show" ? " show" : ""}`}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{ICONS[e.kind]}</svg></span>;
  const grip = admin && <GripIcon />;
  if (e.kind === "show") {
    const t = show?.times;
    const times = [t?.loadIn && `Load in ${fmtTime(t.loadIn)}`, t?.doors && `doors ${fmtTime(t.doors)}`, t?.set && `set ${fmtTime(t.set)}`].filter(Boolean).join(" · ");
    const name = show ? showName(show) : "Show";
    return (
      <div className="tp-ent" data-testid="plan-entry" data-kind="show" {...drag}>
        {grip}
        <Link href={`/shows/${e.showId}`} className="tp-open">{icon}<span className="tp-main"><span className="tp-nm">{name}</span><span className="tp-sub">{times || "Times not set"}</span></span><span className="tp-chev" aria-hidden>›</span></Link>
        {admin && <XButton label={`Take ${name} off the tour`} onClick={onRemove} />}
      </div>
    );
  }
  if (e.kind === "option") {
    const name = pitch?.target.name ?? "Pitch";
    const also = (pitch?.dates ?? []).filter((x) => x !== e.date).map((x) => dayLabel(x));
    return (
      <div className="tp-ent opt" data-testid="plan-entry" data-kind="option" {...drag}>
        {grip}
        <Link href={`/booking/pitches/${e.pitchId}`} className="tp-open">
          <span className="tp-rank" aria-label={`Option ${rank}`}>{rank}</span>
          <span className="tp-main"><span className="tp-nm">{name}</span><span className="tp-sub">{[city, pitch ? STATUS_LABEL[pitch.status as keyof typeof STATUS_LABEL] : "", also.length ? `also ${also.join(", ")}` : ""].filter(Boolean).join(" · ")}</span></span>
        </Link>
        {admin && <button type="button" className="btn ghost sm" style={{ minHeight: 44 }} onClick={onBook} data-testid="plan-book">Book</button>}
        <XButton label={`Take ${dayLabel(e.date!)} off ${name}'s dates`} onClick={onRemove} />
      </div>
    );
  }
  const name = e.kind === "drive" ? `Drive ${[e.from && townOf(e.from), e.to && townOf(e.to)].filter(Boolean).join(" → ") || ""}`.trim()
    : e.kind === "stay" ? `Stay${e.name ? ` · ${e.name}` : ""}` : e.text ?? "Note";
  const sub = e.kind === "drive" ? [driveText(e.minutes, e.miles), e.leaveBy && `leave by ${fmtTime(e.leaveBy)}`].filter(Boolean).join(" · ")
    : e.kind === "stay" ? [e.address && townOf(e.address), `${e.nights ?? 1} ${(e.nights ?? 1) === 1 ? "night" : "nights"}`, e.checkIn && `check in ${fmtTime(e.checkIn)}`].filter(Boolean).join(" · ") : "";
  const body = <>{icon}<span className="tp-main"><span className="tp-nm">{name}</span>{sub && <span className="tp-sub">{sub}</span>}</span>
    {long && <span className="pill tp-long">Long drive</span>}{admin && <span className="tp-chev" aria-hidden>›</span>}</>;
  return (
    <div className="tp-ent" data-testid="plan-entry" data-kind={e.kind} {...drag}>
      {grip}
      {admin ? <button type="button" className="tp-open" onClick={onOpen} data-testid="plan-entry-open">{body}</button> : <span className="tp-open">{body}</span>}
      {admin && <XButton label={`Remove the ${e.kind}`} onClick={onRemove} />}
    </div>
  );
}

function XButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button type="button" className="tp-x" aria-label={label} title={label} onClick={onClick} data-testid="plan-entry-x">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
    </button>
  );
}

const MENU_KINDS: [EntryKind | "pitch", string][] = [["drive", "Drive…"], ["stay", "Stay…"], ["note", "Note…"], ["pitch", "Pitch a venue for this date…"]];

function PlusMenu({ testid, label, onPick, trigger, triggerClass }: { testid: string; label: string; onPick(k: EntryKind | "pitch"): void; trigger: React.ReactNode; triggerClass: string }) {
  return <Menu label={label} testid={testid} trigger={trigger} triggerClass={triggerClass} items={MENU_KINDS.map(([k, l]) => ({ key: k, label: l, onSelect: () => onPick(k) }))} />;
}

/** The + between two entries (or before the first, after the last): a dashed line with a round + that opens the add menu. */
function PlusSlot({ testid, date, after, before, name, onPick }: { testid: string; date: string; after?: Entry; before?: Entry; name(e: Entry): string; onPick(k: EntryKind | "pitch"): void }) {
  const where = after && before ? `between ${name(after)} and ${name(before)}` : after ? `after ${name(after)}` : before ? `before ${name(before)}` : "";
  return (
    <div className="tp-plusline tp-desk">
      <i />
      <PlusMenu testid={testid} label={`Add on ${dayLabel(date)} ${where}`.trim()} onPick={onPick} triggerClass="tp-plus"
        trigger={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>} />
      <i />
    </div>
  );
}
