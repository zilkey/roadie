"use client";
import Link from "@/lib/artist";
import { useParams } from "next/navigation";
import { useProfile } from "@/lib/auth";
import { useCollection, useDoc, useDocs } from "@/lib/firestore-hooks";
import { daySheet, dayTown, dayLabel, driveText, mapsUrl, byPosition } from "@/lib/tours";
import { fmtTime, showName, showCity } from "@/lib/shows";
import { todayStr } from "@/lib/booking";
import { townOf } from "@/components/tours/common";
import type { Musician, Show, Tour, TourEntry } from "@/schema";

export default function TourDayPage() {
  const { id, date } = useParams<{ id: string; date: string }>();
  const tour = useDoc<Tour>("tours", id);
  if (tour.loading) return null;
  if (!tour.doc) return <div className="card" data-testid="not-found">That tour isn&apos;t here any more. <Link href="/tours" className="font-bold">Back to Tours</Link></div>;
  return <DaySheet tour={tour.doc} date={date} />;
}

const LABEL = "text-[0.6875rem] font-bold uppercase tracking-wider text-muted";

/**
 * The member's day sheet (#46), phone first: which day of the tour, the day's drives (leave by, Maps), show times and links, where
 * we sleep, notes, a peek at tomorrow, and the two buttons. Members read band entries only; admins read the same page.
 */
function DaySheet({ tour, date }: { tour: Tour & { id: string }; date: string }) {
  const profile = useProfile();
  const admin = profile.role === "admin";
  const entries = useCollection<TourEntry>(`tours/${tour.id}/entries`, { skip: admin, where: [["visibility", "==", "band"]] }).rows;
  const adminEntries = useCollection<TourEntry>(`tours/${tour.id}/entries`, { skip: !admin }).rows;
  const musicians = useCollection<Musician>("musicians").rows ?? [];
  const all = ((admin ? adminEntries : entries) ?? []).filter((e) => !e.deletedAt);
  const sheet = daySheet(tour, all, date);
  const showIds = [...sheet.shows, ...(sheet.tomorrow?.show ? [sheet.tomorrow.show] : [])].map((e) => e.showId).filter((x): x is string => !!x);
  const shows = useDocs<Show>("shows", showIds).byId;
  const today = todayStr();
  const first = profile.name.split(" ")[0];
  const town = dayTown(sheet, (sid) => { const s = shows.get(sid); return s ? showCity(s) : undefined; });
  const van = (tour.personnel ?? []).filter((m) => m !== profile.musicianId).map((m) => musicians.find((x) => x.id === m)?.name.split(" ")[0]).filter(Boolean) as string[];
  const withText = van.length ? `in the van with ${van.length > 1 ? `${van.slice(0, -1).join(", ")} and ${van[van.length - 1]}` : van[0]}` : "";
  const empty = !sheet.drives.length && !sheet.shows.length && !sheet.stays.length && !sheet.notes.length;
  // + Add an expense, pinned to this day's drive, else stay, else show (as on the tour page).
  const pin = sheet.drives[0] ?? sheet.stays[0] ?? sheet.shows[0];
  const tomorrowShow = sheet.tomorrow?.show?.showId ? shows.get(sheet.tomorrow.show.showId) : undefined;
  const nextDrive = sheet.tomorrow?.drive;

  return (
    <div className="mx-auto grid w-full max-w-[430px] gap-3" data-testid="day-sheet">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <Link href={`/tours/${tour.id}`} className="font-bold text-accent" data-testid="day-sheet-tour">{tour.name}{sheet.day ? ` · Day ${sheet.day.n} of ${sheet.day.of}` : ""}</Link>
        <span className="text-muted">{first}</span>
      </div>
      <div>
        <h1 className="m-0 text-[1.75rem] font-bold leading-tight" data-testid="day-sheet-title">{date === today ? "Today, " : ""}{dayLabel(date)}</h1>
        {town && <div className="text-sm text-muted" data-testid="day-sheet-town">{town}</div>}
      </div>

      {sheet.drives.map((d) => (
        <div className="d-card" key={d.id} data-testid="day-sheet-drive">
          <div className={LABEL}>{d.leaveBy ? `Leave by ${fmtTime(d.leaveBy)}` : "Drive"}</div>
          <div>
            <div className="text-lg font-bold">{d.from || d.to ? `${townOf(d.from) ?? "…"} → ${townOf(d.to) ?? "…"}` : "Drive"}</div>
            {(d.minutes !== undefined || withText) && <div className="text-sm text-muted">{[driveText(d.minutes), withText].filter(Boolean).join(" · ")}</div>}
          </div>
          {d.to && <a href={mapsUrl(d.from, d.to)} target="_blank" rel="noreferrer" className="link text-sm font-semibold" data-testid="day-sheet-maps">Open in Maps</a>}
        </div>
      ))}

      {sheet.shows.map((e) => {
        const s = e.showId ? shows.get(e.showId) : undefined;
        if (!s) return null;
        const times = [["Load in", s.times?.loadIn], ["Doors", s.times?.doors], ["Set", s.times?.set]].filter(([, t]) => t);
        return (
          <div className="d-card" key={e.id} data-testid="day-sheet-show">
            <div className={LABEL}>Show</div>
            <div className="text-lg font-bold">{showName(s)}</div>
            {times.length > 0 && <div className="grid grid-cols-3 gap-2">{times.map(([l, t]) => <div key={l}><div className="text-xs text-muted">{l}</div><div className="font-semibold">{fmtTime(t)}</div></div>)}</div>}
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold">
              <Link href={`/shows/${s.id}?tab=setlist`} className="link" data-testid="day-sheet-setlist">Setlist</Link>
              {s.stagePlotId && <Link href={`/stage-plots/${s.stagePlotId}`} className="link" data-testid="day-sheet-stage-plot">Stage plot</Link>}
              <Link href={`/shows/${s.id}`} className="link" data-testid="day-sheet-show-page">Show page</Link>
            </div>
          </div>
        );
      })}

      {sheet.stays.map((e) => {
        const sub = [e.address?.address, e.checkIn ? `check-in after ${fmtTime(e.checkIn)}` : ""].filter(Boolean).join(" · ");
        return (
          <div className="d-card" key={e.id} data-testid="day-sheet-stay">
            <div className={LABEL}>Sleeping</div>
            <div>
              <div className="text-lg font-bold">{[e.name || "Stay", town].filter(Boolean).join(" · ")}</div>
              {sub && <div className="text-sm text-muted">{sub}</div>}
            </div>
          </div>
        );
      })}

      {sheet.notes.length > 0 && (
        <div className="d-card" data-testid="day-sheet-notes">
          <div className={LABEL}>Notes</div>
          {byPosition(sheet.notes).map((n) => <div key={n.id} className="whitespace-pre-wrap" data-testid="day-sheet-note">{n.text}</div>)}
        </div>
      )}

      {empty && <div className="text-muted" data-testid="day-sheet-empty">Nothing planned for this day.</div>}

      {sheet.tomorrow && (
        <div className="grid gap-1 rounded-2xl bg-soft px-[22px] py-4" data-testid="day-sheet-tomorrow">
          <div className={LABEL}>Tomorrow</div>
          <div className="text-sm">
            {[nextDrive?.leaveBy && <b key="l">Leave {fmtTime(nextDrive.leaveBy)}</b>,
              nextDrive?.minutes !== undefined && `${driveText(nextDrive.minutes)}${nextDrive.to ? ` to ${townOf(nextDrive.to)}` : ""}`,
              tomorrowShow && showName(tomorrowShow)].filter(Boolean).flatMap((x, i) => (i ? [" · ", x] : [x]))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href={`/money/expense?tourId=${tour.id}${pin ? `&tourEntryId=${pin.id}` : ""}`} className="btn acc justify-center" data-testid="day-sheet-expense">+ Add an expense</Link>
        <Link href={`/tours/${tour.id}`} className="btn outline justify-center" data-testid="day-sheet-whole-tour">Whole tour</Link>
      </div>
    </div>
  );
}
