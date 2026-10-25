import { conflictOf, monthGrid, type CalendarItem } from "@/lib/calendar";
import s from "./calendar.module.css";
import { DayCell } from "./DayCell";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthGrid({ ym, allByDay, shownByDay, today, selected, onSelect }: {
  ym: string; allByDay: Map<string, CalendarItem[]>; shownByDay: Map<string, CalendarItem[]>; today: string; selected: string; onSelect(d: string): void;
}) {
  return (
    <div className={s.grid} data-testid="calendar-grid">
      {DOW.map((d) => <div key={d} className={s.dow}>{d}</div>)}
      {monthGrid(ym).map((d) => (
        <DayCell key={d} date={d} inMonth={d.startsWith(ym)} today={d === today} selected={d === selected}
          items={shownByDay.get(d) ?? []}
          // Conflicts and festival shading always use the unfiltered day.
          conflict={!!conflictOf(allByDay.get(d) ?? [])}
          festival={(allByDay.get(d) ?? []).some((i) => i.kind === "festivalDay")}
          onSelect={onSelect} />
      ))}
    </div>
  );
}
