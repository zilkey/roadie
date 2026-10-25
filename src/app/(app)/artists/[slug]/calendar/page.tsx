"use client";
import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageTitle } from "@/components/ui";
import { Tabs } from "@/components/booking/common";
import { todayStr } from "@/lib/booking";
import { itemsByDay, layerFilter, type CalendarLayer } from "@/lib/calendar";
import { useCalendarItems } from "@/lib/calendarData";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { DayPanel } from "@/components/calendar/DayPanel";
import { ComingUp } from "@/components/calendar/ComingUp";
import { Legend } from "@/components/calendar/Legend";
import s from "@/components/calendar/calendar.module.css";

const LABEL: Record<CalendarLayer, string> = { all: "All", shows: "Shows", rehearsals: "Rehearsals", booking: "Booking" };

/** Shifts "YYYY-MM" by n months, in UTC. */
function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
const monthTitle = (ym: string) => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export default function CalendarPage() {
  return <Suspense fallback={<div className="s">Loading…</div>}><Calendar /></Suspense>;
}

function Calendar() {
  const router = useRouter();
  const pathname = usePathname();
  const param = useSearchParams().get("m") ?? "";
  const today = todayStr();
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(param) ? param : today.slice(0, 7);
  const { items, comingUp, loading, admin } = useCalendarItems();
  const [layer, setLayer] = useState<CalendarLayer>("all");
  // The picked day belongs to the month it was picked in; a different month falls back to the default.
  const [pick, setPick] = useState<{ ym: string; date: string } | null>(null);
  const selected = pick && pick.ym === ym ? pick.date : today.startsWith(ym) ? today : `${ym}-01`;

  const allByDay = useMemo(() => itemsByDay(items), [items]);
  const shownByDay = useMemo(() => itemsByDay(items.filter((i) => layerFilter(i, layer))), [items, layer]);
  const go = (m: string) => router.push(`${pathname}?m=${m}`);
  const layers: CalendarLayer[] = admin ? ["all", "shows", "rehearsals", "booking"] : ["all", "shows", "rehearsals"];
  const active = layers.includes(layer) ? layer : "all";

  return (
    <div className="grid gap-5" data-testid="calendar-page">
      <PageTitle title="Calendar" actions={<>
        <button type="button" className={`btn ghost ${s.nav}`} aria-label="Previous month" onClick={() => go(shiftMonth(ym, -1))}>‹</button>
        <span className={s.month} data-testid="calendar-month" aria-live="polite">{monthTitle(ym)}</span>
        <button type="button" className={`btn ghost ${s.nav}`} aria-label="Next month" onClick={() => go(shiftMonth(ym, 1))}>›</button>
        <button type="button" className="btn ghost" style={{ minHeight: 44 }} onClick={() => go(today.slice(0, 7))}>Today</button>
      </>} />
      <Tabs<CalendarLayer> testid="calendar-filter" value={active} onChange={setLayer} options={layers.map((l) => [l, LABEL[l]])} />
      <div className={s.layout}>
        <div className={s.main}>
          <MonthGrid ym={ym} allByDay={allByDay} shownByDay={shownByDay} today={today} selected={selected}
            onSelect={(d) => setPick({ ym, date: d })} />
          {loading && <p className="s">Loading…</p>}
        </div>
        <aside className={s.side}>
          <Legend admin={admin} />
          <DayPanel date={selected} allItems={allByDay.get(selected) ?? []} items={shownByDay.get(selected) ?? []} />
          {admin && <ComingUp items={comingUp} today={today} />}
        </aside>
      </div>
    </div>
  );
}
